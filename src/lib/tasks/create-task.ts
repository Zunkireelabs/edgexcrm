import { validate, required, maxLength, optionalMaxLength, isIn } from "@/lib/api/validation";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { NotificationTypes, createNotificationsExcept } from "@/lib/notifications";
import type { AuthContext } from "@/lib/api/auth";
import type { ScopedClient } from "@/lib/supabase/scoped";

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Loose input shape — same as the REST route's raw request body. Callers
 * (the REST route, the create_task AI tool) are each responsible for their
 * own upstream shaping (JSON body parsing / zod schema respectively); this
 * function re-validates everything regardless, so neither caller can skip it.
 */
export interface CreateTaskInput {
  title?: unknown;
  description?: unknown;
  priority?: unknown;
  due_date?: unknown;
  lead_id?: unknown;
  deal_id?: unknown;
  assignee_id?: unknown;
}

export interface CreateTaskValidationError {
  kind: "validation";
  errors: Record<string, string[]>;
}

export interface CreateTaskDbError {
  kind: "db_error";
  error: unknown;
}

export interface CreateTaskOk {
  kind: "ok";
  task: Record<string, unknown>;
  /** Whether TASK_ASSIGNED was notified (i.e. delegated to someone other than auth.userId). */
  notified: boolean;
}

export type CreateTaskOutcome = CreateTaskOk | CreateTaskValidationError | CreateTaskDbError;

/**
 * The core of `POST /api/v1/my-tasks` (previously inline in the route),
 * extracted so the create_task AI tool (Phase 4A) can call the exact same
 * validation/side-effects instead of reimplementing them. Kept
 * behavior-identical to the pre-extraction route — see my-tasks route
 * tests for the REST-parity gate.
 */
export async function createTaskForUser(
  db: ScopedClient,
  auth: AuthContext,
  input: CreateTaskInput,
  opts: { requestId?: string } = {},
): Promise<CreateTaskOutcome> {
  const requestId = opts.requestId ?? crypto.randomUUID();
  const body = input as Record<string, unknown>;

  const validationErrors: Record<string, string[]> = {};

  const { valid, errors } = validate(body, {
    title: [required("title"), maxLength(255)],
    description: [optionalMaxLength(2000)],
    priority: [isIn([...TASK_PRIORITIES])],
  });
  Object.assign(validationErrors, errors);

  if (body.due_date !== undefined && body.due_date !== null) {
    if (typeof body.due_date !== "string" || !ISO_DATE_RE.test(body.due_date)) {
      validationErrors.due_date = ["Must be a valid ISO date YYYY-MM-DD or null"];
    }
  }

  if (body.lead_id !== undefined && body.lead_id !== null) {
    if (typeof body.lead_id !== "string" || !UUID_RE.test(body.lead_id)) {
      validationErrors.lead_id = ["Must be a valid UUID or null"];
    }
  }

  if (body.deal_id !== undefined && body.deal_id !== null) {
    if (typeof body.deal_id !== "string" || !UUID_RE.test(body.deal_id)) {
      validationErrors.deal_id = ["Must be a valid UUID or null"];
    }
  }

  if (body.assignee_id !== undefined && body.assignee_id !== null) {
    if (typeof body.assignee_id !== "string" || !UUID_RE.test(body.assignee_id)) {
      validationErrors.assignee_id = ["Must be a valid UUID or null"];
    }
  }

  if (!valid || Object.keys(validationErrors).length > 0) {
    return { kind: "validation", errors: validationErrors };
  }

  if (body.lead_id) {
    const { data: lead } = await db
      .from("leads")
      .select("id")
      .eq("id", body.lead_id as string)
      .maybeSingle();
    if (!lead) {
      return { kind: "validation", errors: { lead_id: ["Lead not found in this tenant"] } };
    }
  }

  if (body.deal_id) {
    const { data: deal } = await db
      .from("deals")
      .select("id")
      .eq("id", body.deal_id as string)
      .maybeSingle();
    if (!deal) {
      return { kind: "validation", errors: { deal_id: ["Deal not found in this tenant"] } };
    }
  }

  const assigneeId = body.assignee_id ? String(body.assignee_id) : auth.userId;
  if (assigneeId !== auth.userId) {
    const { data: member } = await db
      .from("tenant_users")
      .select("user_id")
      .eq("user_id", assigneeId)
      .maybeSingle();
    if (!member) {
      return { kind: "validation", errors: { assignee_id: ["Not a member of this tenant"] } };
    }
  }
  const assignedById = assigneeId !== auth.userId ? auth.userId : null;

  const insert = {
    title: String(body.title).trim(),
    description: body.description ? String(body.description).trim() : null,
    priority: body.priority ? String(body.priority) : "normal",
    due_date: body.due_date ? String(body.due_date) : null,
    lead_id: body.lead_id ? String(body.lead_id) : null,
    deal_id: body.deal_id ? String(body.deal_id) : null,
    project_id: null,
    status: "todo",
    assignee_id: assigneeId,
    assigned_by_id: assignedById,
    is_billable: false,
    position: 0,
  };

  const { data: task, error } = await db
    .from("tasks")
    .insert(insert)
    .select()
    .single();

  if (error) {
    return { kind: "db_error", error };
  }

  await Promise.all([
    emitEvent({
      tenantId: auth.tenantId,
      type: "task.created",
      entityType: "task",
      entityId: task.id,
      requestId,
    }),
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "task.created",
      entityType: "task",
      entityId: task.id,
      requestId,
    }),
  ]);

  let notified = false;
  if (assignedById) {
    const link = task.lead_id
      ? `/leads/${task.lead_id}`
      : task.deal_id
        ? `/deals/${task.deal_id}`
        : "/home";
    createNotificationsExcept(auth.userId, [
      {
        tenantId: auth.tenantId,
        userId: assigneeId,
        type: NotificationTypes.TASK_ASSIGNED,
        title: "New task assigned",
        message: task.title,
        link,
      },
    ]);
    notified = true;
  }

  return { kind: "ok", task, notified };
}
