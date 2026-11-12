import { daysUntil } from "../../record-preview/lib/labels";

/**
 * ONE list for the Tasks tab (EDGEX-153): the lead's tasks plus its old checklist items. Checklist items show up as
 * tasks without a due date; ticking one calls the checklist endpoint, ticking a task calls the task endpoint. There is
 * no data migration: both tables stay as they are.
 */
export interface TaskIn {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "done";
  due_date: string | null;
  assignee_name?: string | null;
  /** Tasks have no completed_at column; updated_at is the closest stamp for a done row's date. */
  updated_at?: string | null;
}
export interface ChecklistIn {
  id: string;
  title: string;
  is_completed: boolean;
  completed_at?: string | null;
}

export interface UnifiedTask {
  /** Unique across both sources. */
  key: string;
  id: string;
  source: "task" | "checklist";
  title: string;
  done: boolean;
  due_date: string | null;
  assignee_name: string | null;
  /** When a done row was finished (shown on the row). */
  done_at: string | null;
}

export function mergeTasks(tasks: readonly TaskIn[], checklists: readonly ChecklistIn[]): UnifiedTask[] {
  return [
    ...tasks.map<UnifiedTask>((t) => ({
      key: `task-${t.id}`, id: t.id, source: "task", title: t.title, done: t.status === "done", due_date: t.due_date ?? null, assignee_name: t.assignee_name ?? null,
      done_at: t.status === "done" ? t.updated_at ?? null : null,
    })),
    ...checklists.map<UnifiedTask>((c) => ({
      key: `checklist-${c.id}`, id: c.id, source: "checklist", title: c.title, done: c.is_completed, due_date: null, assignee_name: null,
      done_at: c.is_completed ? c.completed_at ?? null : null,
    })),
  ];
}

export function taskCounts(items: readonly UnifiedTask[]): { open: number; done: number } {
  const done = items.filter((t) => t.done).length;
  return { open: items.length - done, done };
}

export type TaskGroupId = "overdue" | "week" | "later" | "none" | "done";
export const TASK_GROUP_LABEL: Record<TaskGroupId, string> = { overdue: "Overdue", week: "This week", later: "Later", none: "No date", done: "Done" };

/** Overdue, This week (today through 7 days), Later, No date, Done. Empty groups are left out. */
export function groupTasks(items: readonly UnifiedTask[], now: Date = new Date()): { id: TaskGroupId; items: UnifiedTask[] }[] {
  const g: Record<TaskGroupId, UnifiedTask[]> = { overdue: [], week: [], later: [], none: [], done: [] };
  for (const t of items) {
    if (t.done) g.done.push(t);
    else if (!t.due_date) g.none.push(t);
    else {
      const n = daysUntil(t.due_date, now);
      (n < 0 ? g.overdue : n <= 7 ? g.week : g.later).push(t);
    }
  }
  const byDue = (a: UnifiedTask, b: UnifiedTask) => (a.due_date ?? "").localeCompare(b.due_date ?? "");
  g.overdue.sort(byDue); g.week.sort(byDue); g.later.sort(byDue);
  return (["overdue", "week", "later", "none", "done"] as const).filter((id) => g[id].length > 0).map((id) => ({ id, items: g[id] }));
}

/** The request that ticks (or un-ticks) one row: tasks go to the task endpoint, checklist items to the checklist endpoint. */
export function toggleRequest(t: Pick<UnifiedTask, "id" | "source">, leadId: string, done: boolean): { url: string; body: Record<string, unknown> } {
  return t.source === "checklist"
    ? { url: `/api/v1/leads/${leadId}/checklists/${t.id}`, body: { is_completed: done } }
    : { url: `/api/v1/my-tasks/${t.id}`, body: { status: done ? "done" : "todo" } };
}

/** Sends the toggle request for one row; resolves true when the server accepted it. */
export async function sendToggle(
  t: Pick<UnifiedTask, "id" | "source">, leadId: string, done: boolean, fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  const req = toggleRequest(t, leadId, done);
  try {
    const res = await fetchFn(req.url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req.body) });
    return res.ok;
  } catch {
    return false;
  }
}
