"use client";

import { useState } from "react";
import { Play, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { notifyTimersChanged } from "@/lib/timers/timer-events";

interface TaskTimerButtonProps {
  taskId: string;
  /** Active timer id for this task, if one is already running (e.g. left running from a previous session). */
  initialTimerId?: string | null;
  className?: string;
}

/**
 * Start/stop control rendered only on project task rows when time-tracking is
 * enabled (Phase 2b) — reuses the existing `POST /api/v1/timers` /
 * `POST /api/v1/timers/{id}/stop` endpoints, no new API. Callers must only
 * render this for a task with a non-null `project_id`: the start endpoint
 * 422s on a project-less task, and a control that exists only to error is
 * the exact defect #500 fixed.
 */
export function TaskTimerButton({ taskId, initialTimerId = null, className }: TaskTimerButtonProps) {
  const [timerId, setTimerId] = useState<string | null>(initialTimerId);
  const [pending, setPending] = useState(false);
  const running = timerId !== null;

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setPending(true);
    try {
      if (timerId) {
        const res = await fetch(`/api/v1/timers/${timerId}/stop`, { method: "POST" });
        if (res.ok) {
          setTimerId(null);
          notifyTimersChanged();
        }
      } else {
        const res = await fetch("/api/v1/timers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task_id: taskId }),
        });
        if (res.ok) {
          const { data } = await res.json();
          setTimerId((data as { id: string }).id);
          notifyTimersChanged();
        }
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-label={running ? "Stop timer" : "Start timer"}
      title={running ? "Stop timer" : "Start timer"}
      className={cn(
        "shrink-0 flex items-center justify-center h-11 w-11 rounded-full transition-colors disabled:opacity-50",
        running ? "text-red-600 hover:bg-red-50" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {running ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
    </button>
  );
}
