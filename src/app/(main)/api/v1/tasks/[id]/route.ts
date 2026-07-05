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
import { NotificationTypes, createNotificationsExcept } from "@/lib/notifications";

const TASK_STATUSES = ["todo", "in_progress", "done"];
const TASK_PRIORITIES = ["low", "normal", "high", "urgent"];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)) return apiForbidden();

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
  if (!getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  // Validate new fields inline (nullable UUID + nullable ISO date + array)
  const validationErrors: Record<string, string[]> = {};

  const { valid, errors } = validate(body, {
    title: [maxLength(255)],
    description: [optionalMaxLength(2000)],
    status: [isIn(TASK_STATUSES)],
    priority: [isIn(TASK_PRIORITIES)],
  });
  Object.assign(validationErrors, errors);

  if (body.assignee_id !== undefined && body.assignee_id !== null) {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof body.assignee_id !== "string" || !uuidRe.test(body.assignee_id)) {
      validationErrors.assignee_id = ["Must be a valid UUID or null"];
    }
  }

  if (body.due_date !== undefined && body.due_date !== null) {
    if (typeof body.due_date !== "string" || !ISO_DATE_RE.test(body.due_date)) {
      validationErrors.due_date = ["Must be a valid ISO date YYYY-MM-DD or null"];
    }
  }

  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || !(body.tags as unknown[]).every((t) => typeof t === "string")) {
      validationErrors.tags = ["Must be an array of strings"];
    }
  }

  if (!valid || Object.keys(validationErrors).length > 0) {
    return apiValidationError(validationErrors);
  }

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("tasks")
    .select("id, title, assignee_id, project_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Task");
  const existingTask = existing as unknown as {
    id: string;
    title: string;
    assignee_id: string | null;
    project_id: string | null;
  };

  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = String(body.title).trim();
  if (body.description !== undefined)
    patch.description = body.description ? String(body.description).trim() : null;
  if (body.status !== undefined) patch.status = String(body.status);
  if (body.estimated_minutes !== undefined)
    patch.estimated_minutes = body.estimated_minutes != null ? Number(body.estimated_minutes) : null;
  if (body.is_billable !== undefined) patch.is_billable = Boolean(body.is_billable);
  if (body.position !== undefined) patch.position = Number(body.position);
  if (body.priority !== undefined) patch.priority = String(body.priority);
  if (body.tags !== undefined) patch.tags = body.tags as string[];
  if ("due_date" in body) patch.due_date = body.due_date ? String(body.due_date) : null;

  let newAssigneeId: string | null = existingTask.assignee_id;
  const reassigning = "assignee_id" in body;
  if (reassigning) {
    newAssigneeId = body.assignee_id ? String(body.assignee_id) : null;
    if (newAssigneeId && newAssigneeId !== existingTask.assignee_id) {
      const { data: member } = await db
        .from("tenant_users")
        .select("user_id")
        .eq("user_id", newAssigneeId)
        .maybeSingle();
      if (!member) return apiValidationError({ assignee_id: ["Not a member of this tenant"] });
    }
    patch.assignee_id = newAssigneeId;
    patch.assigned_by_id = newAssigneeId && newAssigneeId !== auth.userId ? auth.userId : null;
  }

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

  if (reassigning && newAssigneeId && newAssigneeId !== existingTask.assignee_id && newAssigneeId !== auth.userId) {
    createNotificationsExcept(auth.userId, [
      {
        tenantId: auth.tenantId,
        userId: newAssigneeId,
        type: NotificationTypes.TASK_ASSIGNED,
        title: "New task assigned",
        message: existingTask.title,
        link: existingTask.project_id ? `/time-tracking/projects/${existingTask.project_id}` : "/home",
      },
    ]);
  }

  log.info({ taskId: id }, "Task updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/tasks/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)) return apiForbidden();
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
