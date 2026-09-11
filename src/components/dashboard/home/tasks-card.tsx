"use client";

import { ClipboardList } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { NewTaskRow } from "./new-task-row";
import { TaskRow } from "@/components/dashboard/tasks/task-row";
import { addDays } from "@/lib/hr/dates";
import { summarizeOpenTasks } from "@/lib/home/task-grouping";
import type { PersonalTask } from "@/lib/supabase/queries";

/**
 * Home Overview's task card is a capped SUMMARY, not a third task surface —
 * see the Phase 4 rule this Phase 5 pass acts on
 * (docs/IT-AGENCY-PHASE5-DELIVERY-NAV-IA-BRIEF.md §Phase 2): Home → Tasks is
 * the canonical "everything assigned to me" surface, /tasks is the canonical
 * "project work" surface, and every other task view must be a summary that
 * links into one of those two.
 */
const MAX_VISIBLE = 5;

interface TasksCardProps {
  initialOpen: PersonalTask[];
  currentUserId: string;
  /** Tenant-local "today" as YYYY-MM-DD — see todayInTz in @/lib/hr/dates. */
  today: string;
  projectBoardEnabled: boolean;
  timeTrackingEnabled: boolean;
  runningTimersByTask: Record<string, string>;
  onComplete: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCreated: (task: Record<string, unknown>) => void;
  /** Switches Home to the Tasks tab — the canonical surface this card summarizes. */
  onViewAll: () => void;
  /** Opens the task detail drawer (Round 2 slice A). */
  onOpenDetail: (id: string) => void;
}

export function TasksCard({
  initialOpen,
  currentUserId,
  today,
  projectBoardEnabled,
  timeTrackingEnabled,
  runningTimersByTask,
  onComplete,
  onDelete,
  onCreated,
  onViewAll,
  onOpenDetail,
}: TasksCardProps) {
  const tomorrow = addDays(today, 1);
  const { visible, total } = summarizeOpenTasks(initialOpen, today, tomorrow, MAX_VISIBLE);

  return (
    <Card className="border-sidebar-border rounded-xl">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">My Tasks</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-1">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
            <ClipboardList className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">You have no open tasks.</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {visible.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                today={today}
                projectBoardEnabled={projectBoardEnabled}
                timeTrackingEnabled={timeTrackingEnabled}
                runningTimerId={runningTimersByTask[task.id] ?? null}
                onOpenDetail={onOpenDetail}
                onComplete={onComplete}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}

        {total > 0 && (
          <button
            type="button"
            onClick={onViewAll}
            className="w-full text-left text-xs text-blue-600 hover:underline pt-1"
          >
            View all {total} task{total === 1 ? "" : "s"}
          </button>
        )}

        <div className="pt-2">
          <NewTaskRow onCreated={onCreated} currentUserId={currentUserId} />
        </div>
      </CardContent>
    </Card>
  );
}
