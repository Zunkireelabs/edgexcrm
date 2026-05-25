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

const TASK_STATUSES = ["todo", "in_progress", "done"];

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: task, error } = await db
    .from("tasks")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return apiError("DB_ERROR", "Failed to fetch task", 500);
  if (!task) return apiNotFound("Task");
  return apiSuccess(task);
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/tasks/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    title: [maxLength(255)],
    description: [optionalMaxLength(2000)],
    status: [isIn(TASK_STATUSES)],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("tasks")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Task");

  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = String(body.title).trim();
  if (body.description !== undefined)
    patch.description = body.description ? String(body.description).trim() : null;
  if (body.status !== undefined) patch.status = String(body.status);
  if (body.estimated_minutes !== undefined)
    patch.estimated_minutes = body.estimated_minutes != null ? Number(body.estimated_minutes) : null;
  if (body.is_billable !== undefined) patch.is_billable = Boolean(body.is_billable);
  if (body.position !== undefined) patch.position = Number(body.position);

  const { data: updated, error } = await db
    .from("tasks")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to update task");
    return apiError("DB_ERROR", "Failed to update task", 500);
  }

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "task.updated",
    entityType: "task",
    entityId: id,
    changes: { patch: { old: existing, new: patch } },
    requestId,
  });

  log.info({ taskId: id }, "Task updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/tasks/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("tasks")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Task");

  const { error } = await db.from("tasks").delete().eq("id", id);
  if (error) {
    log.error({ error }, "Failed to delete task");
    return apiError("DB_ERROR", "Failed to delete task", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "task.deleted",
      entityType: "task",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "task.deleted",
      entityType: "task",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ taskId: id }, "Task deleted");
  return apiSuccess({ id });
}
