"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Circle, CheckCircle2, ClipboardList, X } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toLocalDateString } from "@/lib/date";
import { NewTaskRow } from "./new-task-row";
import { PRIORITY_CONFIG } from "@/industries/it-agency/features/project-board/components/priority-pill";
import type { PersonalTask } from "@/lib/supabase/queries";

interface TasksTabContentProps {
  initialOpen: PersonalTask[];
  initialDone: PersonalTask[];
  currentUserId: string;
  onComplete: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCreated: (task: Record<string, unknown>) => void;
}

type FilterKey = "all" | "overdue" | "completed";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "completed", label: "Completed" },
];

function addDays(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toLocalDateString(d);
}

function dueLabel(dueDate: string, today: string, tomorrow: string) {
  if (dueDate === today) return "Today";
  if (dueDate === tomorrow) return "Tomorrow";
  return new Date(`${dueDate}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function TaskRow({
  task,
  today,
  tomorrow,
  completed,
  acting,
  onToggle,
  onDelete,
}: {
  task: PersonalTask;
  today: string;
  tomorrow: string;
  completed: boolean;
  acting: boolean;
  onToggle: () => void;
  onDelete?: () => void;
}) {
  const priorityCfg = PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG.normal;
  const leadName = task.leads
    ? [task.leads.first_name, task.leads.last_name].filter(Boolean).join(" ")
    : null;

  return (
    <div className="group flex items-center gap-3 py-2 px-1 rounded-md hover:bg-gray-50 transition-colors">
      <button
        type="button"
        onClick={completed ? undefined : onToggle}
        disabled={acting || completed}
        className="shrink-0 text-muted-foreground hover:text-green-600 transition-colors disabled:opacity-50"
        title={completed ? "Completed" : "Mark done"}
      >
        {completed ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <Circle className="h-4 w-4" />
        )}
      </button>

      <div className="flex-1 min-w-0 flex items-center gap-2">
        <p className={cn("text-sm truncate", completed ? "line-through text-muted-foreground" : "text-foreground font-medium")}>
          {task.title}
        </p>
        {leadName && task.lead_id && (
          <Link href={`/leads/${task.lead_id}`} prefetch={false} className="text-xs text-blue-600 hover:underline truncate shrink-0">
            {leadName}
          </Link>
        )}
      </div>

      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0 ${priorityCfg.cls}`}>
        {priorityCfg.label}
      </span>

      <span className="text-xs text-muted-foreground w-16 text-right shrink-0">
        {task.due_date ? dueLabel(task.due_date, today, tomorrow) : ""}
      </span>

      {onDelete && !completed && (
        <button
          type="button"
          onClick={onDelete}
          disabled={acting}
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-muted-foreground hover:text-red-500"
          title="Delete task"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function TaskGroup({
  title,
  tasks,
  today,
  tomorrow,
  completed = false,
  acting,
  onToggle,
  onDelete,
}: {
  title: string;
  tasks: PersonalTask[];
  today: string;
  tomorrow: string;
  completed?: boolean;
  acting: string | null;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  if (tasks.length === 0) return null;

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between py-2 px-1"
      >
        <span className="text-sm font-medium text-foreground">
          {title} ({tasks.length})
        </span>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <div className="pb-2 space-y-0.5">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              today={today}
              tomorrow={tomorrow}
              completed={completed}
              acting={acting === task.id}
              onToggle={() => onToggle(task.id)}
              onDelete={() => onDelete(task.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function TasksTabContent({
  initialOpen,
  initialDone,
  currentUserId,
  onComplete,
  onDelete,
  onCreated,
}: TasksTabContentProps) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [acting, setActing] = useState<string | null>(null);

  const today = toLocalDateString(new Date());
  const tomorrow = addDays(today, 1);

  const { overdue, dueToday, dueTomorrow, later } = useMemo(() => {
    const overdue: PersonalTask[] = [];
    const dueToday: PersonalTask[] = [];
    const dueTomorrow: PersonalTask[] = [];
    const later: PersonalTask[] = [];
    for (const t of initialOpen) {
      if (!t.due_date) {
        later.push(t);
      } else if (t.due_date < today) {
        overdue.push(t);
      } else if (t.due_date === today) {
        dueToday.push(t);
      } else if (t.due_date === tomorrow) {
        dueTomorrow.push(t);
      } else {
        later.push(t);
      }
    }
    return { overdue, dueToday, dueTomorrow, later };
  }, [initialOpen, today, tomorrow]);

  async function handleComplete(id: string) {
    setActing(id);
    try {
      await onComplete(id);
    } finally {
      setActing(null);
    }
  }

  async function handleDelete(id: string) {
    setActing(id);
    try {
      await onDelete(id);
    } finally {
      setActing(null);
    }
  }

  const isEmpty =
    initialOpen.length === 0 && (filter !== "completed" ? true : initialDone.length === 0);

  return (
    <div className="space-y-4">
      <Card className="border-sidebar-border rounded-xl">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Due Today</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {dueToday.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
              <ClipboardList className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No tasks due today.</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {dueToday.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  today={today}
                  tomorrow={tomorrow}
                  completed={false}
                  acting={acting === task.id}
                  onToggle={() => handleComplete(task.id)}
                  onDelete={() => handleDelete(task.id)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-1.5 flex-wrap">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            type="button"
            size="sm"
            variant={filter === f.key ? "default" : "outline"}
            className={cn("h-7 px-2.5 text-xs rounded-full", filter === f.key && "pointer-events-none")}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      <Card className="border-sidebar-border rounded-xl">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Tasks</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
              <ClipboardList className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {filter === "completed" ? "No completed tasks." : "You have no open tasks."}
              </p>
            </div>
          ) : filter === "completed" ? (
            <div className="space-y-0.5">
              {initialDone.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  today={today}
                  tomorrow={tomorrow}
                  completed
                  acting={false}
                  onToggle={() => {}}
                />
              ))}
            </div>
          ) : filter === "overdue" ? (
            <TaskGroup title="Overdue" tasks={overdue} today={today} tomorrow={tomorrow} acting={acting} onToggle={handleComplete} onDelete={handleDelete} />
          ) : (
            <div>
              <TaskGroup title="Overdue" tasks={overdue} today={today} tomorrow={tomorrow} acting={acting} onToggle={handleComplete} onDelete={handleDelete} />
              <TaskGroup title="Due today" tasks={dueToday} today={today} tomorrow={tomorrow} acting={acting} onToggle={handleComplete} onDelete={handleDelete} />
              <TaskGroup title="Due tomorrow" tasks={dueTomorrow} today={today} tomorrow={tomorrow} acting={acting} onToggle={handleComplete} onDelete={handleDelete} />
              <TaskGroup title="Later" tasks={later} today={today} tomorrow={tomorrow} acting={acting} onToggle={handleComplete} onDelete={handleDelete} />
            </div>
          )}

          <div className="pt-3 mt-1 border-t border-border">
            <NewTaskRow onCreated={onCreated} currentUserId={currentUserId} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
