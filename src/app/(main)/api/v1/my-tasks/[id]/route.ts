import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
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
import { createAuditLog, emitEvent } from "@/lib/api/audit";

const TASK_STATUSES = ["todo", "in_progress", "done"];
const TASK_PRIORITIES = ["low", "normal", "high", "urgent"];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type TaskOwner = { id: string; assignee_id: string | null };

interface Props {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/my-tasks/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const validationErrors: Record<string, string[]> = {};

  const { valid, errors } = validate(body, {
    title: [maxLength(255)],
    description: [optionalMaxLength(2000)],
    status: [isIn(TASK_STATUSES)],
    priority: [isIn(TASK_PRIORITIES)],
  });
  Object.assign(validationErrors, errors);

  if (body.due_date !== undefined && body.due_date !== null) {
    if (typeof body.due_date !== "string" || !ISO_DATE_RE.test(body.due_date)) {
      validationErrors.due_date = ["Must be a valid ISO date YYYY-MM-DD or null"];
    }
  }

  if (!valid || Object.keys(validationErrors).length > 0) {
    return apiValidationError(validationErrors);
  }

  const db = await scopedClient(auth);

  // scopedClient drops column inference — cast at call site per scoped.ts comment.
  const fetchResult = await db
    .from("tasks")
    .select("id, assignee_id")
    .eq("id", id)
    .maybeSingle();
  const existing = fetchResult.data as TaskOwner | null;

  if (!existing) return apiNotFound("Task");
  if (existing.assignee_id !== auth.userId) return apiForbidden();

  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = String(body.title).trim();
  if (body.description !== undefined)
    patch.description = body.description ? String(body.description).trim() : null;
  if (body.status !== undefined) patch.status = String(body.status);
  if (body.priority !== undefined) patch.priority = String(body.priority);
  if ("due_date" in body) patch.due_date = body.due_date ? String(body.due_date) : null;

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

  log.info({ taskId: id }, "Personal task updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/my-tasks/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);

  // scopedClient drops column inference — cast at call site per scoped.ts comment.
  const fetchResult = await db
    .from("tasks")
    .select("id, assignee_id")
    .eq("id", id)
    .maybeSingle();
  const existing = fetchResult.data as TaskOwner | null;

  if (!existing) return apiNotFound("Task");
  if (existing.assignee_id !== auth.userId) return apiForbidden();

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

  log.info({ taskId: id }, "Personal task deleted");
  return apiSuccess({ id });
}
