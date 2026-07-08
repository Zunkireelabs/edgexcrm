"use client";

import { useState } from "react";
import Link from "next/link";
import { X, CheckCircle2, Circle } from "lucide-react";
import { PRIORITY_CONFIG } from "@/industries/it-agency/features/project-board/components/priority-pill";
import type { TaskPriority, TaskStatus } from "@/types/database";

export interface TaskRowItem {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  assigned_by_name?: string | null;
  assignee_name?: string | null;
  leads?: { id: string; first_name: string | null; last_name: string | null } | null;
  deals?: { id: string; name: string } | null;
  projects?: { id: string; name: string } | null;
}

interface TaskRowProps {
  task: TaskRowItem;
  today: string;
  completed?: boolean;
  /** Show who the task is assigned to — useful on lead/deal task lists where the viewer isn't necessarily the assignee. */
  showAssignee?: boolean;
  onComplete: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function TaskRow({
  task,
  today,
  completed = false,
  showAssignee = false,
  onComplete,
  onDelete,
}: TaskRowProps) {
  const [acting, setActing] = useState(false);
  const isOverdue = !completed && task.due_date && task.due_date < today;
  const priorityCfg = PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG.normal;
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
          {task.assigned_by_name && (
            <span className="text-xs text-muted-foreground">Assigned by {task.assigned_by_name}</span>
          )}
          {showAssignee && task.assignee_name && (
            <span className="text-xs text-muted-foreground">→ {task.assignee_name}</span>
          )}
          {leadName && task.leads && (
            <Link href={`/leads/${task.leads.id}`} className="text-xs text-blue-600 hover:underline truncate">
              {leadName}
            </Link>
          )}
          {task.deals && (
            <Link href={`/deals/${task.deals.id}`} className="text-xs text-blue-600 hover:underline truncate">
              {task.deals.name}
            </Link>
          )}
          {task.projects && (
            <Link href={`/projects/${task.projects.id}`} className="text-xs text-blue-600 hover:underline truncate">
              {task.projects.name}
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
