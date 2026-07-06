import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { canManageHR } from "@/lib/api/permissions";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, isIn } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { getSelfTenantUserId, getDirectReportIds, canWriteEmployee } from "@/lib/api/hr-scope";

const EMPLOYMENT_TYPES = ["full_time", "part_time", "contractor", "intern"];
const EMPLOYMENT_STATUSES = ["active", "on_leave", "notice", "terminated"];

interface TenantUserRow {
  id: string;
  user_id: string;
  role: string;
  position_id: string | null;
  branch_id: string | null;
  employee_profiles: Record<string, unknown> | Record<string, unknown>[] | null;
}

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const hasManageHR = canManageHR(auth.permissions);
  const selfId = await getSelfTenantUserId(db, auth);

  let query = db
    .from("tenant_users")
    .select(
      "id, user_id, role, position_id, branch_id, employee_profiles(*, departments(id, name))"
    );

  if (!hasManageHR) {
    const directReportIds = selfId ? await getDirectReportIds(db, selfId) : [];
    const allowedIds = [selfId, ...directReportIds].filter((v): v is string => !!v);
    if (allowedIds.length === 0) return apiSuccess([]);
    query = query.in("id", allowedIds);
  }

  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) return apiError("DB_ERROR", "Failed to fetch employees", 500);

  const rows = (data ?? []) as unknown as TenantUserRow[];

  // Stitch name/email from auth.users (same pattern as /api/v1/team).
  const { data: authData } = await db.raw().auth.admin.listUsers({ perPage: 1000 });
  const emailMap = new Map<string, string>();
  const nameMap = new Map<string, string | null>();
  for (const u of authData?.users || []) {
    emailMap.set(u.id, u.email || "");
    const meta = u.user_metadata as Record<string, unknown> | undefined;
    nameMap.set(u.id, (meta?.name ?? meta?.full_name ?? null) as string | null);
  }

  const result = rows.map((row) => {
    const profile = Array.isArray(row.employee_profiles)
      ? row.employee_profiles[0] ?? null
      : row.employee_profiles;
    return {
      tenant_user_id: row.id,
      user_id: row.user_id,
      role: row.role,
      position_id: row.position_id,
      branch_id: row.branch_id,
      name: nameMap.get(row.user_id) ?? null,
      email: emailMap.get(row.user_id) || "Unknown",
      profile,
    };
  });

  return apiSuccess(result);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/employees" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const hasManageHR = canManageHR(auth.permissions);
  const selfId = await getSelfTenantUserId(db, auth);
  if (!selfId) return apiError("NOT_FOUND", "No tenant membership found for the current user", 404);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const targetTenantUserId = body.tenant_user_id ? String(body.tenant_user_id) : selfId;
  if (!canWriteEmployee(selfId, hasManageHR, targetTenantUserId)) return apiForbidden();

  if (targetTenantUserId !== selfId) {
    const { data: targetCheck } = await db
      .from("tenant_users")
      .select("id")
      .eq("id", targetTenantUserId)
      .maybeSingle();
    if (!targetCheck) return apiError("NOT_FOUND", "tenant_user_id not found in this tenant", 404);
  }

  const { valid, errors } = validate(body, {
    employment_type: body.employment_type !== undefined ? [isIn(EMPLOYMENT_TYPES)] : [],
    employment_status: body.employment_status !== undefined ? [isIn(EMPLOYMENT_STATUSES)] : [],
  });
  if (!valid) return apiValidationError(errors);

  const { data: existing } = await db
    .from("employee_profiles")
    .select("id")
    .eq("tenant_user_id", targetTenantUserId)
    .maybeSingle();
  if (existing) return apiError("CONFLICT", "Employee profile already exists — use PATCH /api/v1/employees/[id]", 409);

  if (body.department_id) {
    const { data: deptCheck } = await db
      .from("departments")
      .select("id")
      .eq("id", String(body.department_id))
      .maybeSingle();
    if (!deptCheck) return apiError("NOT_FOUND", "department_id not found", 404);
  }
  if (body.manager_tenant_user_id) {
    const { data: managerCheck } = await db
      .from("tenant_users")
      .select("id")
      .eq("id", String(body.manager_tenant_user_id))
      .maybeSingle();
    if (!managerCheck) return apiError("NOT_FOUND", "manager_tenant_user_id not found", 404);
  }

  const insert: Record<string, unknown> = { tenant_user_id: targetTenantUserId };
  const assignable = [
    "employment_type", "employment_status", "billable", "weekly_capacity_hours",
    "job_title", "hire_date", "date_of_birth", "phone", "address",
    "emergency_contact", "department_id", "manager_tenant_user_id",
  ];
  for (const key of assignable) {
    if (body[key] !== undefined) insert[key] = body[key];
  }

  const { data: created, error } = await db
    .from("employee_profiles")
    .insert(insert)
    .select("*, departments(id, name)")
    .single();

  if (error) {
    log.error({ error }, "Failed to create employee profile");
    return apiError("DB_ERROR", "Failed to create employee profile", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "employee_profile.created",
      entityType: "employee_profile",
      entityId: targetTenantUserId,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "employee_profile.created",
      entityType: "employee_profile",
      entityId: targetTenantUserId,
      requestId,
    }),
  ]);

  log.info({ tenantUserId: targetTenantUserId }, "Employee profile created");
  return apiSuccess(created, 201);
}
