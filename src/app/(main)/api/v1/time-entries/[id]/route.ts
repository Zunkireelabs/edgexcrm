import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin, type AuthContext } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, isUUID, isPositiveInt } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Props {
  params: Promise<{ id: string }>;
}

interface EntryRow {
  id: string;
  user_id: string;
  approval_status: string;
  project_id: string;
}

function canEdit(auth: AuthContext, entry: EntryRow): boolean {
  if (requireAdmin(auth)) return true;
  return entry.user_id === auth.userId && entry.approval_status === "pending";
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: entry, error } = await db
    .from("time_entries")
    .select("*, projects(id, name, account_id), tasks(id, title)")
    .eq("id", id)
    .maybeSingle();

  if (error) return apiError("DB_ERROR", "Failed to fetch time entry", 500);
  if (!entry) return apiNotFound("Time entry");

  // Non-admins can only view their own entries
  const isAdmin = requireAdmin(auth);
  const row = entry as unknown as EntryRow;
  if (!isAdmin && row.user_id !== auth.userId) return apiForbidden();

  return apiSuccess(entry);
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "PATCH",
    path: `/api/v1/time-entries/${id}`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    minutes: [isPositiveInt()],
    task_id: [isUUID()],
    project_id: [isUUID()],
  });
  if (!valid) return apiValidationError(errors);

  if (body.entry_date !== undefined && !DATE_RE.test(String(body.entry_date))) {
    return apiValidationError({ entry_date: ["Must be a valid date (YYYY-MM-DD)"] });
  }

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("time_entries")
    .select("id, user_id, approval_status, project_id")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return apiNotFound("Time entry");
  const row = existing as unknown as EntryRow;

  if (!canEdit(auth, row)) {
    return apiForbidden();
  }

  const patch: Record<string, unknown> = {};
  if (body.entry_date !== undefined) patch.entry_date = String(body.entry_date);
  if (body.minutes !== undefined) patch.minutes = Number(body.minutes);
  if (body.notes !== undefined) patch.notes = body.notes ? String(body.notes).trim() : null;
  if (body.project_id !== undefined) {
    // Verify project belongs to this tenant
    const { data: proj } = await db
      .from("projects")
      .select("id")
      .eq("id", String(body.project_id))
      .maybeSingle();
    if (!proj) return apiNotFound("Project");
    patch.project_id = String(body.project_id);
    // Clear task_id when project changes (unless caller also supplies a new task_id)
    if (body.task_id === undefined) patch.task_id = null;
  }
  if (body.task_id !== undefined) {
    if (body.task_id === null) {
      patch.task_id = null;
    } else {
      const targetProjectId = patch.project_id
        ? String(patch.project_id)
        : row.project_id;
      const { data: task } = await db
        .from("tasks")
        .select("id, project_id")
        .eq("id", String(body.task_id))
        .maybeSingle();
      if (!task) return apiNotFound("Task");
      if ((task as unknown as { project_id: string }).project_id !== targetProjectId) {
        return apiValidationError({ task_id: ["Task does not belong to the specified project"] });
      }
      patch.task_id = String(body.task_id);
    }
  }

  const { data: updated, error } = await db
    .from("time_entries")
    .update(patch)
    .eq("id", id)
    .select("*, projects(id, name, account_id), tasks(id, title)")
    .single();

  if (error) {
    log.error({ error }, "Failed to update time entry");
    return apiError("DB_ERROR", "Failed to update time entry", 500);
  }

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "time_entry.updated",
    entityType: "time_entry",
    entityId: id,
    changes: { patch: { old: existing, new: patch } },
    requestId,
  });

  log.info({ entryId: id }, "Time entry updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "DELETE",
    path: `/api/v1/time-entries/${id}`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("time_entries")
    .select("id, user_id, approval_status")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return apiNotFound("Time entry");
  const row = existing as unknown as EntryRow;

  if (!canEdit(auth, row)) {
    return apiForbidden();
  }

  const { error } = await db.from("time_entries").delete().eq("id", id);
  if (error) {
    log.error({ error }, "Failed to delete time entry");
    return apiError("DB_ERROR", "Failed to delete time entry", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "time_entry.deleted",
      entityType: "time_entry",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "time_entry.deleted",
      entityType: "time_entry",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ entryId: id }, "Time entry deleted");
  return apiSuccess({ id });
}
