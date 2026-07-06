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
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

interface Props {
  params: Promise<{ id: string }>;
}

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

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.RESOURCING)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("project_allocations")
    .select("*, projects!project_allocations_project_id_fkey(id, name, status)")
    .eq("id", id)
    .maybeSingle();

  if (error) return apiError("DB_ERROR", "Failed to fetch project allocation", 500);
  if (!data) return apiNotFound("Project allocation");
  return apiSuccess(data);
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/project-allocations/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.RESOURCING)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("project_allocations")
    .select("id, project_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Project allocation");

  const existingRow = existing as unknown as { id: string; project_id: string };
  if (!(await canAllocate(db, auth, existingRow.project_id))) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  if (
    body.hours_per_week !== undefined &&
    (typeof body.hours_per_week !== "number" || body.hours_per_week <= 0)
  ) {
    return apiValidationError({ hours_per_week: ["Must be a positive number"] });
  }

  const patch: Record<string, unknown> = {};
  const assignable = ["hours_per_week", "role_on_project", "start_date", "end_date"];
  for (const key of assignable) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  if (Object.keys(patch).length === 0) return apiNotFound("Project allocation");

  const { data: updated, error } = await db
    .from("project_allocations")
    .update(patch)
    .eq("id", id)
    .select("*, projects!project_allocations_project_id_fkey(id, name, status)")
    .single();

  if (error) {
    log.error({ error }, "Failed to update project allocation");
    return apiError("DB_ERROR", "Failed to update project allocation", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "project_allocation.updated",
      entityType: "project_allocation",
      entityId: id,
      changes: { patch: { old: null, new: patch } },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "project_allocation.updated",
      entityType: "project_allocation",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ allocationId: id }, "Project allocation updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/project-allocations/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.RESOURCING)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("project_allocations")
    .select("id, project_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Project allocation");

  const existingRow = existing as unknown as { id: string; project_id: string };
  if (!(await canAllocate(db, auth, existingRow.project_id))) return apiForbidden();

  const { error } = await db.from("project_allocations").delete().eq("id", id);
  if (error) {
    log.error({ error }, "Failed to delete project allocation");
    return apiError("DB_ERROR", "Failed to delete project allocation", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "project_allocation.deleted",
      entityType: "project_allocation",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "project_allocation.deleted",
      entityType: "project_allocation",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ allocationId: id }, "Project allocation deleted");
  return apiSuccess({ id });
}
