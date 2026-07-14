"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";
import type { DeliveryWidgetProps } from "./types";

// Never a real assignee — used when currentUserId is missing so the request
// still resolves to zero rows instead of the tasks endpoint's "no filter"
// fallback (an empty assignee_id param is treated as unset => all tenant tasks).
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

interface TaskRow {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "done";
  due_date: string | null;
}

export default function MyTasksWidget({ currentUserId }: DeliveryWidgetProps) {
  const assigneeId = currentUserId || NIL_UUID;
  const { data: tasks, loading, error } = useWidgetData<TaskRow[]>(
    `/api/v1/tasks?assignee_id=${encodeURIComponent(assigneeId)}&page_size=200`
  );

  return (
    <WidgetCard title="My Tasks">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load your tasks." />
      ) : !tasks || tasks.length === 0 ? (
        <WidgetEmpty message="No tasks assigned to you." />
      ) : (
        <MyTasksContent tasks={tasks} />
      )}
    </WidgetCard>
  );
}

function MyTasksContent({ tasks }: { tasks: TaskRow[] }) {
  const counts = { todo: 0, in_progress: 0, done: 0 };
  for (const t of tasks) counts[t.status]++;

  const now = new Date();
  const weekOutDate = new Date(now);
  weekOutDate.setDate(now.getDate() + 7);
  const today = now.toISOString().slice(0, 10);
  const weekOut = weekOutDate.toISOString().slice(0, 10);
  const dueSoon = tasks
    .filter((t): t is TaskRow & { due_date: string } => t.status !== "done" && !!t.due_date && t.due_date <= weekOut)
    .sort((a, b) => (a.due_date < b.due_date ? -1 : 1))
    .slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="flex gap-5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{counts.todo}</span>
          <span className="text-xs text-muted-foreground">Todo</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{counts.in_progress}</span>
          <span className="text-xs text-muted-foreground">In Progress</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{counts.done}</span>
          <span className="text-xs text-muted-foreground">Done</span>
        </div>
      </div>
      {dueSoon.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Due soon</p>
          <ul className="space-y-1">
            {dueSoon.map((t) => (
              <li key={t.id} className="flex items-center justify-between text-sm gap-2">
                <span className="truncate">{t.title}</span>
                <span
                  className={`text-xs flex-shrink-0 ${t.due_date < today ? "text-red-600" : "text-muted-foreground"}`}
                >
                  {t.due_date}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
