"use client";

import { useState } from "react";
import Link from "next/link";
import { X, CheckCircle2, Circle, ClipboardList } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PRIORITY_CONFIG } from "@/industries/it-agency/features/project-board/components/priority-pill";
import { NewTaskRow } from "./new-task-row";
import type { PersonalTask } from "@/lib/supabase/queries";
import type { TaskPriority } from "@/types/database";
import { toLocalDateString } from "@/lib/date";

interface TasksCardProps {
  initialOpen: PersonalTask[];
  initialDone: PersonalTask[];
  onComplete: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAdd: (task: { title: string; due_date: string | null; priority: TaskPriority }) => Promise<void>;
}

export function TasksCard({
  initialOpen,
  initialDone,
  onComplete,
  onDelete,
  onAdd,
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
          <NewTaskRow onAdd={onAdd} />
        </div>
      </CardContent>
    </Card>
  );
}

function TaskRow({
  task,
  today,
  completed = false,
  onComplete,
  onDelete,
}: {
  task: PersonalTask;
  today: string;
  completed?: boolean;
  onComplete: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [acting, setActing] = useState(false);
  const isOverdue = !completed && task.due_date && task.due_date < today;
  const priorityCfg = PRIORITY_CONFIG[task.priority as TaskPriority] ?? PRIORITY_CONFIG.normal;
  const leadName = task.leads
    ? [task.leads.first_name, task.leads.last_name].filter(Boolean).join(" ")
    : null;

  async function handleComplete() {
    setActing(true);
    try { await onComplete(task.id); } finally { setActing(false); }
  }

  async function handleDelete() {
    setActing(true);
    try { await onDelete(task.id); } finally { setActing(false); }
  }

  return (
    <div className="group flex items-start gap-3 py-2 px-1 rounded-md hover:bg-gray-50 transition-colors">
      <button
        type="button"
        onClick={completed ? undefined : handleComplete}
        disabled={acting || completed}
        className="mt-0.5 shrink-0 text-muted-foreground hover:text-green-600 transition-colors disabled:opacity-50"
        title={completed ? "Completed" : "Mark done"}
      >
        {completed ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <Circle className="h-4 w-4" />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${completed ? "line-through text-muted-foreground" : "text-gray-900"}`}>
          {task.title}
        </p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {task.due_date && (
            <span className={`text-xs ${isOverdue ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
              {isOverdue ? "⚠ " : ""}{task.due_date === today ? "Today" : task.due_date}
            </span>
          )}
          <span
            className={`inline-flex items-center px-2 py-0 rounded-full text-[11px] font-medium border ${priorityCfg.cls}`}
          >
            {priorityCfg.label}
          </span>
          {leadName && task.leads && (
            <Link href={`/leads/${task.leads.id}`} className="text-xs text-blue-600 hover:underline truncate">
              {leadName}
            </Link>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={handleDelete}
        disabled={acting}
        className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-muted-foreground hover:text-red-500 mt-0.5"
        title="Delete task"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
