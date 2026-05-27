import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, maxLength, optionalMaxLength, isIn } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

const PROJECT_STATUSES = ["planning", "active", "in_review", "delivered", "on_hold", "cancelled"];

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: project, error } = await db
    .from("projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return apiError("DB_ERROR", "Failed to fetch project", 500);
  if (!project) return apiNotFound("Project");
  return apiSuccess(project);
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/projects/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    name: [maxLength(255)],
    status: [isIn(PROJECT_STATUSES)],
    expected_status: [isIn(PROJECT_STATUSES)],
    notes: [optionalMaxLength(2000)],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("projects")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Project");

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.status !== undefined) patch.status = String(body.status);
  if (body.owner_id !== undefined) patch.owner_id = body.owner_id ?? null;
  if (body.default_rate !== undefined)
    patch.default_rate = body.default_rate != null ? Number(body.default_rate) : null;
  if (body.is_billable !== undefined) patch.is_billable = Boolean(body.is_billable);
  if (body.notes !== undefined) patch.notes = body.notes ? String(body.notes).trim() : null;

  const expectedStatus = body.expected_status !== undefined ? String(body.expected_status) : undefined;

  // No-op: nothing to update — satisfy precondition trivially
  if (Object.keys(patch).length === 0) {
    const { data: current } = await db.from("projects").select("*").eq("id", id).maybeSingle();
    return apiSuccess(current ?? existing);
  }

  let updateQuery = db.from("projects").update(patch).eq("id", id);
  if (expectedStatus !== undefined) {
    updateQuery = updateQuery.eq("status", expectedStatus);
  }

  const { data: updated, error } = expectedStatus !== undefined
    ? await updateQuery.select().maybeSingle()
    : await updateQuery.select().single();

  if (error) {
    log.error({ error }, "Failed to update project");
    return apiError("DB_ERROR", "Failed to update project", 500);
  }

  if (expectedStatus !== undefined && updated === null) {
    const { data: current } = await db
      .from("projects")
      .select("status")
      .eq("id", id)
      .maybeSingle() as { data: { status: string } | null; error: unknown };
    const currentStatus = current?.status ?? "unknown";
    return apiError("INVALID_STATE", `Expected status '${expectedStatus}' but current status is '${currentStatus}'`, 409);
  }

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "project.updated",
    entityType: "project",
    entityId: id,
    changes: { patch: { old: existing, new: patch } },
    requestId,
  });

  log.info({ projectId: id }, "Project updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/projects/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("projects")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Project");

  const { error } = await db.from("projects").delete().eq("id", id);
  if (error) {
    log.error({ error }, "Failed to delete project");
    return apiError("DB_ERROR", "Failed to delete project", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "project.deleted",
      entityType: "project",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "project.deleted",
      entityType: "project",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ projectId: id }, "Project deleted");
  return apiSuccess({ id });
}
