import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { canManageHR } from "@/lib/api/permissions";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiValidationError,
  apiNotFound,
} from "@/lib/api/response";
import { validate, required, isUUID } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

async function canAllocate(
  db: Awaited<ReturnType<typeof scopedClient>>,
  auth: Awaited<ReturnType<typeof authenticateRequest>>,
  projectId: string,
): Promise<boolean> {
  if (!auth) return false;
  if (canManageHR(auth.permissions)) return true;
  const { data } = await db.from("projects").select("owner_id").eq("id", projectId).maybeSingle();
  return (data as { owner_id: string | null } | null)?.owner_id === auth.userId;
}

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.RESOURCING)) return apiForbidden();

  const db = await scopedClient(auth);
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("project_id");
  const tenantUserId = searchParams.get("tenant_user_id");

  let query = db
    .from("project_allocations")
    .select("*, projects!project_allocations_project_id_fkey(id, name, status)");
  if (projectId) query = query.eq("project_id", projectId);
  if (tenantUserId) query = query.eq("tenant_user_id", tenantUserId);

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return apiError("DB_ERROR", "Failed to fetch project allocations", 500);
  return apiSuccess(data ?? []);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/project-allocations" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.RESOURCING)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    project_id: [required("project_id"), isUUID()],
    tenant_user_id: [required("tenant_user_id"), isUUID()],
  });
  if (!valid) return apiValidationError(errors);

  if (typeof body.hours_per_week !== "number" || body.hours_per_week <= 0) {
    return apiValidationError({ hours_per_week: ["Must be a positive number"] });
  }

  const db = await scopedClient(auth);

  const { data: projectCheck } = await db.from("projects").select("id").eq("id", String(body.project_id)).maybeSingle();
  if (!projectCheck) return apiNotFound("Project");

  if (!(await canAllocate(db, auth, String(body.project_id)))) return apiForbidden();

  const { data: memberCheck } = await db.from("tenant_users").select("id").eq("id", String(body.tenant_user_id)).maybeSingle();
  if (!memberCheck) return apiNotFound("Employee");

  const { data: created, error } = await db
    .from("project_allocations")
    .insert({
      project_id: String(body.project_id),
      tenant_user_id: String(body.tenant_user_id),
      hours_per_week: body.hours_per_week,
      role_on_project: body.role_on_project ? String(body.role_on_project) : null,
      start_date: body.start_date ? String(body.start_date) : null,
      end_date: body.end_date ? String(body.end_date) : null,
    })
    .select("*, projects!project_allocations_project_id_fkey(id, name, status)")
    .single();

  if (error) {
    log.error({ error }, "Failed to create project allocation");
    return apiError("DB_ERROR", "Failed to create project allocation", 500);
  }

  const createdRow = created as unknown as { id: string };
  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "project_allocation.created",
      entityType: "project_allocation",
      entityId: createdRow.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "project_allocation.created",
      entityType: "project_allocation",
      entityId: createdRow.id,
      requestId,
    }),
  ]);

  log.info({ allocationId: createdRow.id }, "Project allocation created");
  return apiSuccess(created, 201);
}
