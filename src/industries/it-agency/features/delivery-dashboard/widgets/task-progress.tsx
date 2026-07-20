"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError, RAG_COLORS } from "./widget-shell";

interface TaskRow {
  id: string;
  status: "todo" | "in_progress" | "done";
}

const STATUS_LABELS: Record<TaskRow["status"], string> = {
  todo: "Todo",
  in_progress: "In Progress",
  done: "Done",
};

const STATUS_COLORS: Record<TaskRow["status"], string> = {
  todo: "#94a3b8",
  in_progress: RAG_COLORS.amber,
  done: RAG_COLORS.green,
};

export default function TaskProgressWidget() {
  const { data: tasks, loading, error } = useWidgetData<TaskRow[]>("/api/v1/tasks?page_size=200");

  return (
    <WidgetCard title="Task Progress">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load tasks." />
      ) : !tasks || tasks.length === 0 ? (
        <WidgetEmpty message="No tasks yet." />
      ) : (
        <TaskProgressContent tasks={tasks} />
      )}
    </WidgetCard>
  );
}

function TaskProgressContent({ tasks }: { tasks: TaskRow[] }) {
  const counts: Record<TaskRow["status"], number> = { todo: 0, in_progress: 0, done: 0 };
  for (const t of tasks) counts[t.status]++;

  const total = tasks.length;
  const pctDone = Math.round((counts.done / total) * 100);

  return (
    <div className="space-y-4">
      <div className="text-3xl font-bold">
        {pctDone}% <span className="text-sm font-normal text-muted-foreground">done</span>
      </div>
      <div className="h-3 w-full rounded-full overflow-hidden flex bg-gray-100">
        {(["todo", "in_progress", "done"] as const).map((s) =>
          counts[s] > 0 ? (
            <div
              key={s}
              style={{ width: `${(counts[s] / total) * 100}%`, backgroundColor: STATUS_COLORS[s] }}
            />
          ) : null
        )}
      </div>
      <div className="flex gap-5">
        {(["todo", "in_progress", "done"] as const).map((s) => (
          <div key={s} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[s] }} />
            <span className="text-sm font-semibold">{counts[s]}</span>
            <span className="text-xs text-muted-foreground">{STATUS_LABELS[s]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
