import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { canManageHR } from "@/lib/api/permissions";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, isIn } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { getSelfTenantUserId, canReadEmployee, canWriteEmployee } from "@/lib/api/hr-scope";

const EMPLOYMENT_TYPES = ["full_time", "part_time", "contractor", "intern"];
const EMPLOYMENT_STATUSES = ["active", "on_leave", "notice", "terminated"];

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const hasManageHR = canManageHR(auth.permissions);
  const selfId = await getSelfTenantUserId(db, auth);

  const { data: memberRow } = await db
    .from("tenant_users")
    .select("id, user_id, role, position_id, branch_id")
    .eq("id", id)
    .maybeSingle();
  if (!memberRow) return apiNotFound("Employee");

  if (!(await canReadEmployee(db, selfId, hasManageHR, id))) return apiForbidden();

  const { data: profile, error } = await db
    .from("employee_profiles")
    .select("*, departments(id, name)")
    .eq("tenant_user_id", id)
    .maybeSingle();
  if (error) return apiError("DB_ERROR", "Failed to fetch employee profile", 500);

  const member = memberRow as unknown as {
    id: string;
    user_id: string;
    role: string;
    position_id: string | null;
    branch_id: string | null;
  };

  const { data: authData } = await db.raw().auth.admin.getUserById(member.user_id);
  const meta = authData?.user?.user_metadata as Record<string, unknown> | undefined;

  return apiSuccess({
    tenant_user_id: member.id,
    user_id: member.user_id,
    role: member.role,
    position_id: member.position_id,
    branch_id: member.branch_id,
    name: (meta?.name ?? meta?.full_name ?? null) as string | null,
    email: authData?.user?.email ?? "Unknown",
    profile: profile ?? null,
  });
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/employees/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const hasManageHR = canManageHR(auth.permissions);
  const selfId = await getSelfTenantUserId(db, auth);

  const { data: memberRow } = await db.from("tenant_users").select("id").eq("id", id).maybeSingle();
  if (!memberRow) return apiNotFound("Employee");

  if (!canWriteEmployee(selfId, hasManageHR, id)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    employment_type: body.employment_type !== undefined ? [isIn(EMPLOYMENT_TYPES)] : [],
    employment_status: body.employment_status !== undefined ? [isIn(EMPLOYMENT_STATUSES)] : [],
  });
  if (!valid) return apiValidationError(errors);

  // Only canManageHR may change employment status/type/billability/manager/department —
  // self-service covers personal-info fields only.
  const hrOnlyFields = ["employment_type", "employment_status", "billable", "weekly_capacity_hours", "department_id", "manager_tenant_user_id"];
  if (!hasManageHR) {
    for (const key of hrOnlyFields) {
      if (body[key] !== undefined) return apiForbidden();
    }
  }

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

  // photo_url must point into this employee's own signed-upload folder
  // (see photo-upload-url/route.ts) — otherwise a caller could set it to an
  // arbitrary storage path and read a coworker's photo via GET /photo, which
  // only re-checks access against THIS profile, not the path's true owner.
  if (body.photo_url !== undefined && body.photo_url !== null) {
    const expectedPrefix = `${auth.tenantId}/${id}/photo.`;
    if (!String(body.photo_url).startsWith(expectedPrefix)) {
      return apiValidationError({ photo_url: ["Must be a path returned by /photo-upload-url for this employee"] });
    }
  }

  const { data: existing } = await db
    .from("employee_profiles")
    .select("id")
    .eq("tenant_user_id", id)
    .maybeSingle();

  const assignable = [
    "employment_type", "employment_status", "billable", "weekly_capacity_hours",
    "job_title", "hire_date", "date_of_birth", "phone", "address",
    "photo_url", "emergency_contact", "department_id", "manager_tenant_user_id",
  ];
  const patch: Record<string, unknown> = {};
  for (const key of assignable) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  if (Object.keys(patch).length === 0) return apiNotFound("Employee profile");

  let result;
  if (existing) {
    result = await db
      .from("employee_profiles")
      .update(patch)
      .eq("tenant_user_id", id)
      .select("*, departments(id, name)")
      .single();
  } else {
    result = await db
      .from("employee_profiles")
      .insert({ tenant_user_id: id, ...patch })
      .select("*, departments(id, name)")
      .single();
  }

  if (result.error) {
    log.error({ error: result.error }, "Failed to update employee profile");
    return apiError("DB_ERROR", "Failed to update employee profile", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "employee_profile.updated",
      entityType: "employee_profile",
      entityId: id,
      changes: { patch: { old: null, new: patch } },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "employee_profile.updated",
      entityType: "employee_profile",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ tenantUserId: id }, "Employee profile updated");
  return apiSuccess(result.data);
}
