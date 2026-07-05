"use client";

import { useState, useEffect, useCallback } from "react";
import { ClipboardList } from "lucide-react";
import { TaskRow, type TaskRowItem } from "./task-row";
import { TaskComposer, type TaskComposerContext } from "./task-composer";
import { toLocalDateString } from "@/lib/date";

interface TaskListProps {
  /** GET endpoint returning the entity-scoped, enriched task list. */
  fetchUrl: string;
  currentUserId: string;
  context: TaskComposerContext;
  emptyLabel?: string;
}

export function TaskList({ fetchUrl, currentUserId, context, emptyLabel = "No tasks yet." }: TaskListProps) {
  const [tasks, setTasks] = useState<TaskRowItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(fetchUrl)
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then(({ data }) => {
        if (!cancelled) setTasks((data ?? []) as TaskRowItem[]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchUrl]);

  const handleComplete = useCallback(async (id: string) => {
    const res = await fetch(`/api/v1/my-tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
    if (res.ok) {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: "done" } : t)));
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    const res = await fetch(`/api/v1/my-tasks/${id}`, { method: "DELETE" });
    if (res.ok) {
      setTasks((prev) => prev.filter((t) => t.id !== id));
    }
  }, []);

  function handleCreated(task: Record<string, unknown>) {
    setTasks((prev) => [task as unknown as TaskRowItem, ...prev]);
  }

  const today = toLocalDateString(new Date());
  const open = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");

  return (
    <div className="space-y-1">
      {loading ? (
        <p className="text-sm text-muted-foreground py-2">Loading tasks…</p>
      ) : open.length === 0 && !showCompleted ? (
        <div className="flex flex-col items-center justify-center py-4 gap-1.5 text-center">
          <ClipboardList className="h-6 w-6 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {open.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              today={today}
              showAssignee
              onComplete={handleComplete}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {done.length > 0 && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            className="text-xs text-blue-600 hover:underline"
          >
            {showCompleted ? "Hide completed" : `Show completed (${done.length})`}
          </button>
          {showCompleted && (
            <div className="mt-2 space-y-0.5 border-t border-gray-100 pt-2">
              {done.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  today={today}
                  completed
                  showAssignee
                  onComplete={handleComplete}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="pt-2">
        <TaskComposer
          currentUserId={currentUserId}
          context={context}
          onCreated={handleCreated}
          triggerLabel="+ Task"
        />
      </div>
    </div>
  );
}
