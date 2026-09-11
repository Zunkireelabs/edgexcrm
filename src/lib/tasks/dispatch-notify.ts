import { createNotificationsExcept, NotificationTypes } from "@/lib/notifications";
import { isTaskEmailEnabled } from "@/lib/email/task-email-gate";
import { sendTaskAssignedEmail, sendTaskCompletedEmail } from "@/lib/email/send-task-assigned";
import type { ScopedClient } from "@/lib/supabase/scoped";

// Round 1 — the Dispatch Loop (docs/IT-AGENCY-DELIVERY-ADOPTION-PLAN.md §3).
// Shared side-effects for task assignment + completion, so every surface that
// mutates a task stays in lock-step. The brief named only PATCH
// /api/v1/tasks/[id], but assignment also flows through create-task.ts and
// PATCH /api/v1/my-tasks/[id], and completion also through my-tasks — see the
// Round 1 report for why all three are wired here rather than one.

interface MiniLogger {
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

export interface TaskNotifyCtx {
  db: ScopedClient;
  log: MiniLogger;
  tenantId: string;
  actorUserId: string;
  actorEmail: string | null;
  industryId: string | null | undefined;
}

// Fire-and-forget transactional email. NEVER throws to the caller and never
// blocks the response — email failure must not fail the API request (brief §2
// Slice B). Mirrors the fire-and-forget shape in src/lib/leads/apply-lead-patch.ts.
function fireEmail(
  ctx: TaskNotifyCtx,
  kind: "assigned" | "completed",
  recipientUserId: string,
  taskId: string,
  taskTitle: string,
  taskPath: string,
): void {
  if (!isTaskEmailEnabled(ctx.industryId)) return;
  if (recipientUserId === ctx.actorUserId) return; // never email yourself
  void (async () => {
    try {
      const raw = ctx.db.raw();
      const [{ data: recipient }, { data: tenant }] = await Promise.all([
        raw.auth.admin.getUserById(recipientUserId),
        raw.from("tenants").select("name, primary_color").eq("id", ctx.tenantId).single(),
      ]);
      const to = recipient?.user?.email;
      if (!to || !tenant) return;
      const params = {
        to,
        actorEmail: ctx.actorEmail || "a teammate",
        tenantName: (tenant as { name: string }).name,
        taskId,
        taskTitle,
        taskPath,
        primaryColor: (tenant as { primary_color: string | null }).primary_color || undefined,
      };
      const res =
        kind === "assigned"
          ? await sendTaskAssignedEmail(params)
          : await sendTaskCompletedEmail(params);
      if (!res.success) ctx.log.warn({ taskId, kind, err: res.error }, "task email not sent");
    } catch (err) {
      ctx.log.error({ err, taskId, kind }, "error firing task email");
    }
  })();
}

/**
 * A task was assigned/delegated to someone other than the actor. The in-app
 * TASK_ASSIGNED notification stays in each caller (the link differs per
 * surface); this adds the transactional email alongside it.
 */
export function notifyTaskAssigned(
  ctx: TaskNotifyCtx,
  opts: { taskId: string; taskTitle: string; assigneeUserId: string; taskPath: string },
): void {
  fireEmail(ctx, "assigned", opts.assigneeUserId, opts.taskId, opts.taskTitle, opts.taskPath);
}

/**
 * A task moved into "done" (and was not already there). Notifies whoever
 * assigned it (`assignedById`) in-app, plus a transactional email.
 * createNotificationsExcept suppresses a self-ping, so a self-completed task
 * notifies nobody. Caller must only invoke this when assignedById is non-null
 * and the status actually transitioned to "done".
 */
export function notifyTaskCompleted(
  ctx: TaskNotifyCtx,
  opts: { taskId: string; taskTitle: string; assignedById: string; projectId: string | null },
): void {
  // Round 2 slice A gave every task a real address — /tasks/<id> now renders
  // for any task, project-linked or not (docs/IT-AGENCY-ROUND2-TASK-OBJECT-BRIEF.md
  // §2), so both events link straight at the task instead of the /projects or
  // /home fallback this superseded (see #526).
  const link = `/tasks/${opts.taskId}`;
  createNotificationsExcept(ctx.actorUserId, [
    {
      tenantId: ctx.tenantId,
      userId: opts.assignedById,
      type: NotificationTypes.TASK_COMPLETED,
      title: "Task completed",
      message: opts.taskTitle,
      link,
    },
  ]);
  fireEmail(ctx, "completed", opts.assignedById, opts.taskId, opts.taskTitle, link);
}
