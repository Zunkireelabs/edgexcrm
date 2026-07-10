"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { CheckSquare, Loader2 } from "lucide-react";
import { PriorityPill } from "../priority-pill";
import type { Task, TaskPriority } from "@/types/database";

interface TasksSummaryCardProps {
  projectId: string;
  onViewAllTasks: () => void;
}

const PRIORITY_ORDER: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export function TasksSummaryCard({ projectId, onViewAllTasks }: TasksSummaryCardProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/v1/projects/${projectId}/tasks`)
      .then((r) => r.json())
      .then(({ data }) => setTasks(data ?? []))
      .catch(() => toast.error("Failed to load tasks"))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-4 flex items-center justify-center h-24">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const total = tasks.length;
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const today = new Date().toISOString().split("T")[0];
  const openTasks = tasks.filter((t) => t.status !== "done");
  const overdueCount = openTasks.filter((t) => t.due_date != null && t.due_date < today).length;
  const progressPct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const upNext = [...openTasks]
    .sort((a, b) => {
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    })
    .slice(0, 3);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <CheckSquare className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Tasks</h3>
      </div>

      {total === 0 ? (
        <>
          <p className="text-sm text-muted-foreground">No tasks yet.</p>
          <button
            type="button"
            onClick={onViewAllTasks}
            className="text-sm text-primary hover:underline mt-3"
          >
            View all tasks →
          </button>
        </>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {doneCount}/{total} done
              </span>
              {overdueCount > 0 && (
                <span className="text-destructive font-medium">
                  {overdueCount} overdue
                </span>
              )}
            </div>
            <div
              role="progressbar"
              aria-label="Tasks completed"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1.5 rounded-full bg-muted overflow-hidden"
            >
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {upNext.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Up next</p>
              <ul className="space-y-1.5">
                {upNext.map((task) => (
                  <li key={task.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{task.title}</span>
                    {task.due_date ? (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(task.due_date).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    ) : (
                      <span className="shrink-0">
                        <PriorityPill priority={task.priority} readOnly />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="button"
            onClick={onViewAllTasks}
            className="text-sm text-primary hover:underline"
          >
            View all tasks →
          </button>
        </div>
      )}
    </div>
  );
}
