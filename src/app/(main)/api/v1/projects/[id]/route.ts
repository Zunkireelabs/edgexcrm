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
import { recordProjectEvent } from "@/lib/projects/events";
import { computeProjectHealth, computePctComplete } from "@/lib/projects/health";

const PROJECT_STATUSES = ["planning", "active", "in_review", "delivered", "on_hold", "cancelled"];
const ENGAGEMENT_MODELS = ["fixed_bid", "time_materials", "retainer", "staff_aug"];
const HEALTH_VALUES = ["green", "amber", "red"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  const projectRow = project as unknown as {
    health_override: string | null;
    current_estimate_minutes: number | null;
    target_end_date: string | null;
  };

  const [{ data: tasks }, { data: timeEntries }] = await Promise.all([
    db.from("tasks").select("status, estimated_minutes").eq("project_id", id),
    db.from("time_entries").select("minutes").eq("project_id", id),
  ]);

  const taskRows = (tasks ?? []) as unknown as Array<{ status: string; estimated_minutes: number | null }>;
  const pctComplete = computePctComplete(
    taskRows.map((t) => ({ status: t.status, estimatedMinutes: t.estimated_minutes }))
  );
  const actualMinutes = ((timeEntries ?? []) as unknown as Array<{ minutes: number }>).reduce(
    (sum, e) => sum + e.minutes,
    0
  );
  const health = computeProjectHealth({
    healthOverride: (projectRow.health_override as "green" | "amber" | "red" | null) ?? null,
    actualMinutes,
    currentEstimateMinutes: projectRow.current_estimate_minutes,
    targetEndDate: projectRow.target_end_date,
    pctComplete,
  });

  return apiSuccess({
    ...(project as unknown as Record<string, unknown>),
    pct_complete: pctComplete,
    health,
    actual_minutes: actualMinutes,
  });
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
    brief: [optionalMaxLength(10000)],
    engagement_model: [isIn(ENGAGEMENT_MODELS)],
    health_override: [isIn(HEALTH_VALUES)],
    health_note: [optionalMaxLength(2000)],
  });
  const validationErrors: Record<string, string[]> = { ...errors };

  if (body.start_date !== undefined && body.start_date !== null && !DATE_RE.test(String(body.start_date))) {
    validationErrors.start_date = ["Must be an ISO date (YYYY-MM-DD)"];
  }
  if (
    body.target_end_date !== undefined &&
    body.target_end_date !== null &&
    !DATE_RE.test(String(body.target_end_date))
  ) {
    validationErrors.target_end_date = ["Must be an ISO date (YYYY-MM-DD)"];
  }
  if (!valid || Object.keys(validationErrors).length > 0) return apiValidationError(validationErrors);

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("projects")
    .select("id, status, account_id, owner_id, name, brief")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Project");
  const existingRow = existing as unknown as { account_id: string | null; brief: string | null };

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.status !== undefined) patch.status = String(body.status);
  if (body.owner_id !== undefined) patch.owner_id = body.owner_id ?? null;
  if (body.default_rate !== undefined)
    patch.default_rate = body.default_rate != null ? Number(body.default_rate) : null;
  if (body.is_billable !== undefined) patch.is_billable = Boolean(body.is_billable);
  if (body.notes !== undefined) patch.notes = body.notes ? String(body.notes).trim() : null;
  if (body.brief !== undefined) patch.brief = body.brief ? String(body.brief).trim() : null;
  if (body.engagement_model !== undefined)
    patch.engagement_model = body.engagement_model ? String(body.engagement_model) : null;
  if (body.budget_amount !== undefined)
    patch.budget_amount = body.budget_amount != null ? Number(body.budget_amount) : null;
  if (body.start_date !== undefined) patch.start_date = body.start_date ?? null;
  if (body.target_end_date !== undefined) patch.target_end_date = body.target_end_date ?? null;
  if (body.health_override !== undefined)
    patch.health_override = body.health_override ? String(body.health_override) : null;
  if (body.health_note !== undefined)
    patch.health_note = body.health_note ? String(body.health_note).trim() : null;

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

  const changedFields = Object.keys(patch);
  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "project.updated",
      entityType: "project",
      entityId: id,
      changes: { patch: { old: existing, new: patch } },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "project.updated",
      entityType: "project",
      entityId: id,
      requestId,
      payload: { changed_fields: changedFields, old: existing, new: patch, account_id: existingRow.account_id },
    }),
  ]);

  const briefCaptured = "brief" in patch && !existingRow.brief && patch.brief;
  if (briefCaptured) {
    await recordProjectEvent(db, {
      projectId: id,
      eventType: "brief_captured",
      actorId: auth.userId,
      summary: "Brief captured",
      payload: { brief_length: String(patch.brief).length },
    });
  }

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
