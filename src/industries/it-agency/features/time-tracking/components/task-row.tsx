"use client";

import { Clock, Loader2, Play, Square } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TaskStatusBadge } from "./status-badge";
import { AssigneePicker } from "../../project-board/components/assignee-picker";
import { useActiveTimersContext, formatElapsed } from "../hooks/use-active-timers";
import type { TeamMember } from "../../project-board/hooks/use-projects";
import type { Task } from "@/types/database";

interface TaskRowProps {
  task: Task;
  team?: TeamMember[];
  /** Opens the shared task detail drawer (Round 2 slice A) — replaces this row's old Pencil/Dialog editor and inline assignee picker; see docs/IT-AGENCY-ROUND2-TASK-OBJECT-BRIEF.md §2. */
  onOpenDetail: (id: string) => void;
}

/**
 * Read-only summary row + a quick timer action — editing (title, description,
 * status, assignee, due date, priority, estimate, billable, tags) and delete
 * all live in the TaskDetailDrawer opened via onOpenDetail. This row used to
 * carry its own Pencil-triggered edit Dialog and an editable AssigneePicker;
 * removing them is the point of Round 2 slice A, not an oversight.
 */
export function TaskRow({ task, team = [], onOpenDetail }: TaskRowProps) {
  const { isTaskRunning, isPending, startTimer, stopTimer, now } = useActiveTimersContext();
  const running = isTaskRunning(task.id);
  const timerPending = isPending(task.id);
  const noProject = task.project_id == null;

  const estHours =
    task.estimated_minutes != null
      ? `${Math.floor(task.estimated_minutes / 60)}h ${task.estimated_minutes % 60}m`
      : null;

  return (
    <div className="flex items-center gap-3 py-3 px-4 hover:bg-muted/40 rounded-lg group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => onOpenDetail(task.id)}
            className="font-medium text-sm truncate text-left hover:underline"
          >
            {task.title}
          </button>
          <TaskStatusBadge status={task.status} />
        </div>
        {(task.description || estHours) && (
          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
            {task.description && (
              <span className="truncate max-w-xs">{task.description}</span>
            )}
            {estHours && (
              <span className="flex items-center gap-1 shrink-0">
                <Clock className="h-3 w-3" />
                {estHours}
              </span>
            )}
          </div>
        )}
      </div>
      <AssigneePicker assigneeId={task.assignee_id} team={team} onChange={() => {}} disabled />
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <button
                type="button"
                className={`h-7 px-2 gap-1.5 inline-flex items-center rounded-md ${running ? "text-red-600" : "text-muted-foreground"} disabled:opacity-50 hover:bg-muted`}
                disabled={noProject || timerPending}
                onClick={() => (running ? stopTimer(running.id) : startTimer(task.id))}
                title={running ? "Stop timer" : "Start timer"}
                aria-label={running ? "Stop timer" : "Start timer"}
              >
                {timerPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : running ? (
                  <Square className="h-3.5 w-3.5" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                {running && (
                  <span className="text-xs tabular-nums">
                    {formatElapsed(now - Date.parse(running.started_at))}
                  </span>
                )}
              </button>
            </span>
          </TooltipTrigger>
          {noProject && <TooltipContent>Task must be attached to a project to track time</TooltipContent>}
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
