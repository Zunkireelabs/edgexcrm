import { validate, required, maxLength, optionalMaxLength, isIn } from "@/lib/api/validation";
import { canManageBilling } from "@/lib/api/permissions";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { NotificationTypes, createNotificationsExcept } from "@/lib/notifications";
import { notifyTaskAssigned } from "@/lib/tasks/dispatch-notify";
import { TASK_PRIORITIES } from "@/lib/tasks/create-task";
import { logger } from "@/lib/logger";
import type { AuthContext } from "@/lib/api/auth";
import type { ScopedClient } from "@/lib/supabase/scoped";

// Extracted out of POST /api/v1/projects/[id]/tasks (Round 2 slice E,
// docs/IT-AGENCY-ROUND2-SLICE-E-CAPTURE-BRIEF.md §3.4) so the new bulk
// endpoint can create project-linked tasks through the exact same
// validation/side-effects as the interactive route, with notifications
// suppressed per-task and batched by the caller instead. Kept
// behavior-identical to the pre-extraction inline implementation — see
// route.test.ts's 10 pre-existing tests for the parity gate.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface CreateProjectTaskInput {
  title?: unknown;
  description?: unknown;
  priority?: unknown;
  due_date?: unknown;
  assignee_id?: unknown;
  estimated_minutes?: unknown;
  is_billable?: unknown;
}

export interface CreateProjectTaskValidationError {
  kind: "validation";
  errors: Record<string, string[]>;
}

export interface CreateProjectTaskNotFound {
  kind: "not_found";
}

export interface CreateProjectTaskDbError {
  kind: "db_error";
  error: unknown;
}

export interface CreateProjectTaskOk {
  kind: "ok";
  task: Record<string, unknown>;
  notified: boolean;
}

export type CreateProjectTaskOutcome =
  | CreateProjectTaskOk
  | CreateProjectTaskValidationError
  | CreateProjectTaskNotFound
  | CreateProjectTaskDbError;

interface MiniLogger {
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

export async function createProjectTaskCore(
  db: ScopedClient,
  auth: AuthContext,
  projectId: string,
  input: CreateProjectTaskInput,
  opts: { requestId?: string; notify?: boolean; log?: MiniLogger } = {},
): Promise<CreateProjectTaskOutcome> {
  const requestId = opts.requestId ?? crypto.randomUUID();
  const log = opts.log ?? logger;
  const body = input as Record<string, unknown>;

  const { valid, errors } = validate(body, {
    title: [required("title"), maxLength(255)],
    description: [optionalMaxLength(2000)],
    priority: [isIn([...TASK_PRIORITIES])],
  });
  const validationErrors: Record<string, string[]> = { ...errors };

  if (body.assignee_id !== undefined && body.assignee_id !== null) {
    if (typeof body.assignee_id !== "string" || !UUID_RE.test(body.assignee_id)) {
      validationErrors.assignee_id = ["Must be a valid UUID or null"];
    }
  }

  if (body.due_date !== undefined && body.due_date !== null) {
    if (typeof body.due_date !== "string" || !ISO_DATE_RE.test(body.due_date)) {
      validationErrors.due_date = ["Must be a valid ISO date YYYY-MM-DD or null"];
    }
  }

  if (!valid || Object.keys(validationErrors).length > 0) {
    return { kind: "validation", errors: validationErrors };
  }

  // Verify project belongs to this tenant
  const { data: project } = await db
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { kind: "not_found" };

  const assigneeId = body.assignee_id ? String(body.assignee_id) : null;
  const assigneeIsOther = !!assigneeId && assigneeId !== auth.userId;
  if (assigneeIsOther) {
    const { data: member } = await db
      .from("tenant_users")
      .select("user_id")
      .eq("user_id", assigneeId)
      .maybeSingle();
    if (!member) return { kind: "validation", errors: { assignee_id: ["Not a member of this tenant"] } };
  }
  // Always stamp the creator so they can edit their own task later
  // (own-vs-admin rule in tasks/[id]/route.ts keys off assignee_id OR
  // assigned_by_id). Never taken from the body.
  const assignedById = auth.userId;

  // Get next position
  const { data: posResult } = await db
    .raw()
    .from("tasks")
    .select("position")
    .eq("tenant_id", auth.tenantId)
    .eq("project_id", projectId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = posResult ? (posResult.position as number) + 1 : 0;

  const { data: created, error } = await db
    .from("tasks")
    .insert({
      project_id: projectId,
      title: String(body.title).trim(),
      description: body.description ? String(body.description).trim() : null,
      status: "todo",
      estimated_minutes:
        body.estimated_minutes != null ? Number(body.estimated_minutes) : null,
      // is_billable is budget-bearing — only callers with billing capability
      // (owner/admin, or a position granting canManageBilling) can set it;
      // otherwise the task defaults to billable (matches PATCH handling).
      is_billable: canManageBilling(auth.permissions) ? body.is_billable !== false : true,
      position: nextPosition,
      assignee_id: assigneeId,
      assigned_by_id: assignedById,
      priority: body.priority ? String(body.priority) : "normal",
      due_date: body.due_date ? String(body.due_date) : null,
    })
    .select()
    .single();

  if (error) {
    return { kind: "db_error", error };
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "task.created",
      entityType: "task",
      entityId: created.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "task.created",
      entityType: "task",
      entityId: created.id,
      requestId,
    }),
  ]);

  const shouldNotify = opts.notify !== false;
  let notified = false;
  if (assigneeIsOther && shouldNotify) {
    // Round 2 slice B: link straight at the task, not the project fallback —
    // matches every other dispatch path (see tasks/[id]/route.ts, create-task.ts).
    const taskPath = `/tasks/${created.id}`;
    createNotificationsExcept(auth.userId, [
      {
        tenantId: auth.tenantId,
        userId: assigneeId!,
        type: NotificationTypes.TASK_ASSIGNED,
        title: "New task assigned",
        message: created.title,
        link: taskPath,
      },
    ]);
    notifyTaskAssigned(
      {
        db,
        log,
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        actorEmail: auth.email ?? null,
        industryId: auth.industryId,
      },
      { taskId: created.id, taskTitle: created.title, assigneeUserId: assigneeId!, taskPath },
    );
    notified = true;
  }

  return { kind: "ok", task: created, notified };
}
