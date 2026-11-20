import { daysBetween, localDate } from "../time";
import type { DoNextItem, HomeTask } from "../types";
import type { RuleCtx } from "./ctx";

/**
 * task_due: my task, not done, due today or earlier (tenant-local date). Overdue → tier now (first in the tier);
 * due today → tier today. Clears when the task is done.
 */
export function taskDueRule(tasks: HomeTask[], ctx: RuleCtx): DoNextItem[] {
  const today = localDate(ctx.now, ctx.tz);
  const out: DoNextItem[] = [];
  for (const t of tasks) {
    if (t.status === "done" || !t.dueDate) continue;
    const late = daysBetween(t.dueDate, today);
    if (late < 0) continue;
    const overdue = late > 0;
    out.push({
      key: `task_due:${t.id}`,
      kind: "task_due",
      tier: overdue ? "now" : "today",
      leadId: t.leadId ?? undefined,
      title: t.title,
      why: [t.leadName ? `About ${t.leadName}` : null, t.assignedByName ? `Assigned by ${t.assignedByName}` : null].filter(Boolean).join(" · ") || "Task",
      chip: overdue
        ? { text: `Task · overdue ${late} ${late === 1 ? "day" : "days"}`, tone: "bad" }
        : { text: "Task · due today", tone: "neutral" },
      tone: overdue ? "bad" : "neutral",
      primaryAction: { type: "done_task", taskId: t.id },
      sortKey: { group: overdue ? 0.5 : 2, at: Date.parse(`${t.dueDate}T00:00:00Z`) },
      evidenceHref: t.leadId ? `/leads/${t.leadId}` : "/tasks",
      canMarkDone: true,
    });
  }
  return out;
}
