"use client";

import { useState } from "react";
import { ClipboardList } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { NewTaskRow } from "./new-task-row";
import { TaskRow } from "@/components/dashboard/tasks/task-row";
import type { PersonalTask } from "@/lib/supabase/queries";
import { toLocalDateString } from "@/lib/date";

interface TasksCardProps {
  initialOpen: PersonalTask[];
  initialDone: PersonalTask[];
  currentUserId: string;
  onComplete: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCreated: (task: Record<string, unknown>) => void;
}

export function TasksCard({
  initialOpen,
  initialDone,
  currentUserId,
  onComplete,
  onDelete,
  onCreated,
}: TasksCardProps) {
  const [showCompleted, setShowCompleted] = useState(false);

  const today = toLocalDateString(new Date());

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">My Tasks</CardTitle>
          {initialDone.length > 0 && (
            <button
              type="button"
              onClick={() => setShowCompleted((v) => !v)}
              className="text-xs text-blue-600 hover:underline"
            >
              {showCompleted ? "Hide completed" : `Show completed (${initialDone.length})`}
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-1">
        {initialOpen.length === 0 && !showCompleted ? (
          <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
            <ClipboardList className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">You have no open tasks.</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {initialOpen.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                today={today}
                onComplete={onComplete}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}

        {showCompleted && initialDone.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Completed
            </p>
            <div className="space-y-0.5">
              {initialDone.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  today={today}
                  completed
                  onComplete={onComplete}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </div>
        )}

        <div className="pt-2">
          <NewTaskRow onCreated={onCreated} currentUserId={currentUserId} />
        </div>
      </CardContent>
    </Card>
  );
}
