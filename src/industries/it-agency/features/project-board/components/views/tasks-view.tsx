"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, ArrowUpDown, Timer, ListTodo, Play, Square, Loader2 } from "lucide-react";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { LogTimeDialog } from "@/industries/it-agency/features/time-tracking/components/log-time-dialog";
import { TaskStatusBadge } from "@/industries/it-agency/features/time-tracking/components/status-badge";
import { useActiveTimersContext, formatElapsed } from "@/industries/it-agency/features/time-tracking/hooks/use-active-timers";
import { AssigneePicker } from "../assignee-picker";
import { PriorityPill } from "../priority-pill";
import { TASK_CHANGED_EVENT } from "@/lib/tasks/task-events";
import type { Task, TaskPriority } from "@/types/database";
import type { TeamMember } from "../../hooks/use-projects";
import type { WorkspaceFilters } from "../../hooks/use-workspace-filters";

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

type SortKey = "title" | "project" | "status" | "assignee" | "priority" | "due_date" | "created_at";
type SortDir = "asc" | "desc";

function SortIcon({ col, sortKey, dir }: { col: SortKey; sortKey: SortKey; dir: SortDir }) {
  if (col !== sortKey) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
  return dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
}

function buildQuery(filters: WorkspaceFilters): string {
  const params = new URLSearchParams();
  if (filters.account !== "__all__") params.set("account_id", filters.account);
  if (filters.assignee !== "__all__") params.set("assignee_id", filters.assignee);
  if (filters.q) params.set("q", filters.q);
  if (filters.taskStatuses.length > 0) params.set("status", filters.taskStatuses.join(","));
  if (filters.priorities.length > 0) params.set("priority", filters.priorities.join(","));
  if (filters.tags.length > 0) params.set("tags", filters.tags.join(","));
  if (filters.due !== "__all__") params.set("due", filters.due);
  params.set("page_size", "200");
  return `/api/v1/tasks?${params.toString()}`;
}

interface TaskWithProject extends Task {
  projects: {
    id: string;
    name: string;
    account_id: string;
    accounts: { id: string; name: string } | null;
  } | null;
}

interface TasksViewProps {
  filters: WorkspaceFilters;
  team: TeamMember[];
  teamMap: Map<string, TeamMember>;
  onClearFilters: () => void;
}

/**
 * Round 2 slice A (docs/IT-AGENCY-ROUND2-TASK-OBJECT-BRIEF.md §2) replaced
 * this table's per-cell inline editors (status select, assignee picker,
 * priority pill, due-date input, estimate input, tag picker) with a single
 * click-through to /tasks/<id>, intercepted as the shared TaskDetailDrawer —
 * one editing path shared with Home and the cockpit Tasks tab, instead of a
 * fourth divergent one. The row below is now a read-only summary; the timer
 * and "log time" controls stay as quick actions since they're not edits to
 * the task record. The drawer lives in the @modal route, not this
 * component's tree, so this listens for TASK_CHANGED_EVENT to refetch after
 * an edit made there.
 */
export function TasksView({ filters, team, teamMap, onClearFilters }: TasksViewProps) {
  const router = useRouter();
  const [tasks, setTasks] = useState<TaskWithProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("due_date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Log-time dialog state
  const [logTimeOpen, setLogTimeOpen] = useState(false);
  const [logTimeTask, setLogTimeTask] = useState<{ taskId: string; projectId: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(buildQuery(filters));
      if (!res.ok) throw new Error("Failed to fetch tasks");
      const { data } = await res.json();
      setTasks((data ?? []) as TaskWithProject[]);
    } catch {
      toast.error("Failed to load tasks");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters.account,
    filters.assignee,
    filters.q,
    filters.taskStatuses.join(","),
    filters.priorities.join(","),
    filters.tags.join(","),
    filters.due,
  ]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    window.addEventListener(TASK_CHANGED_EVENT, load);
    return () => window.removeEventListener(TASK_CHANGED_EVENT, load);
  }, [load]);

  function openDetail(taskId: string) {
    router.push(`/tasks/${taskId}`);
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "due_date" ? "asc" : "desc"); }
  }

  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "title":
          cmp = a.title.localeCompare(b.title);
          break;
        case "project":
          cmp = (a.projects?.name ?? "").localeCompare(b.projects?.name ?? "");
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "assignee": {
          const aName = a.assignee_id ? (teamMap.get(a.assignee_id)?.name ?? "") : "";
          const bName = b.assignee_id ? (teamMap.get(b.assignee_id)?.name ?? "") : "";
          cmp = aName.localeCompare(bName);
          break;
        }
        case "priority":
          cmp = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
          break;
        case "due_date": {
          // nulls last
          if (!a.due_date && !b.due_date) cmp = 0;
          else if (!a.due_date) cmp = 1;
          else if (!b.due_date) cmp = -1;
          else cmp = a.due_date.localeCompare(b.due_date);
          break;
        }
        case "created_at":
          cmp = a.created_at.localeCompare(b.created_at);
          break;
      }
      // secondary: priority desc (only when primary isn't priority)
      if (cmp === 0 && sortKey !== "priority") {
        cmp = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
      }
      // tertiary: created_at desc
      if (cmp === 0 && sortKey !== "created_at") {
        cmp = b.created_at.localeCompare(a.created_at);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [tasks, sortKey, sortDir, teamMap]);

  function openLogTime(task: TaskWithProject) {
    if (!task.projects) return;
    setLogTimeTask({ taskId: task.id, projectId: task.projects.id });
    setLogTimeOpen(true);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        Loading tasks…
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
        <ListTodo className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          No tasks match your filters. Use <span className="font-medium">New task</span> above to add one.
        </p>
        <button
          type="button"
          onClick={onClearFilters}
          className="text-xs text-gray-600 hover:text-[#0f0f10] hover:underline underline-offset-2"
        >
          Clear filters
        </button>
      </div>
    );
  }

  const headCls = "text-xs font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none";

  return (
    <>
      <div className="flex-1 min-h-0 bg-white rounded-[0.75rem] border border-gray-200 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-sm border-collapse">
            <TableHeader className="sticky top-0 z-10">
              <TableRow className="bg-gray-50 border-b border-gray-200">
                <TableHead className="w-0 border-r border-gray-100" />
                <TableHead
                  className={`${headCls} border-r border-gray-100`}
                  onClick={() => handleSort("title")}
                  aria-sort={sortKey === "title" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <span className="flex items-center gap-1">Title <SortIcon col="title" sortKey={sortKey} dir={sortDir} /></span>
                </TableHead>
                <TableHead
                  className={`${headCls} border-r border-gray-100`}
                  onClick={() => handleSort("project")}
                  aria-sort={sortKey === "project" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <span className="flex items-center gap-1">Project <SortIcon col="project" sortKey={sortKey} dir={sortDir} /></span>
                </TableHead>
                <TableHead
                  className={`${headCls} border-r border-gray-100`}
                  onClick={() => handleSort("status")}
                  aria-sort={sortKey === "status" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <span className="flex items-center gap-1">Status <SortIcon col="status" sortKey={sortKey} dir={sortDir} /></span>
                </TableHead>
                <TableHead
                  className={`${headCls} border-r border-gray-100`}
                  onClick={() => handleSort("assignee")}
                  aria-sort={sortKey === "assignee" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <span className="flex items-center gap-1">Assignee <SortIcon col="assignee" sortKey={sortKey} dir={sortDir} /></span>
                </TableHead>
                <TableHead
                  className={`${headCls} border-r border-gray-100`}
                  onClick={() => handleSort("priority")}
                  aria-sort={sortKey === "priority" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <span className="flex items-center gap-1">Priority <SortIcon col="priority" sortKey={sortKey} dir={sortDir} /></span>
                </TableHead>
                <TableHead
                  className={`${headCls} border-r border-gray-100`}
                  onClick={() => handleSort("due_date")}
                  aria-sort={sortKey === "due_date" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <span className="flex items-center gap-1">Due <SortIcon col="due_date" sortKey={sortKey} dir={sortDir} /></span>
                </TableHead>
                <TableHead className="text-xs font-medium text-gray-600 border-r border-gray-100">Est.</TableHead>
                <TableHead className="text-xs font-medium text-gray-600">Tags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  team={team}
                  onOpenDetail={openDetail}
                  onLogTime={openLogTime}
                />
              ))}
            </TableBody>
          </table>
        </div>
      </div>

      <LogTimeDialog
        open={logTimeOpen}
        onOpenChange={(o) => { setLogTimeOpen(o); if (!o) setLogTimeTask(null); }}
        onSuccess={() => { /* no state update needed — time entries handled by timesheet */ }}
        defaultProjectId={logTimeTask?.projectId}
        defaultTaskId={logTimeTask?.taskId}
      />
    </>
  );
}

// ── TaskRow ──────────────────────────────────────────────────────────────────
// Read-only summary + quick actions (timer, log time) — clicking the title
// navigates to /tasks/<id>, intercepted as the shared drawer. See the file
// header.

interface TaskRowProps {
  task: TaskWithProject;
  team: TeamMember[];
  onOpenDetail: (id: string) => void;
  onLogTime: (task: TaskWithProject) => void;
}

function TaskRow({ task, team, onOpenDetail, onLogTime }: TaskRowProps) {
  const isOverdue =
    task.due_date != null &&
    task.status !== "done" &&
    task.due_date < new Date().toISOString().split("T")[0];

  const { isTaskRunning, isPending, startTimer, stopTimer, now } = useActiveTimersContext();
  const running = isTaskRunning(task.id);
  const timerPending = isPending(task.id);

  const estimateLabel =
    task.estimated_minutes != null
      ? String(Math.round((task.estimated_minutes / 60) * 100) / 100)
      : "—";

  return (
    <TableRow className="group hover:bg-gray-50">
      {/* Timer + log time actions */}
      <TableCell className="border-r border-gray-100">
        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <button
                    type="button"
                    onClick={() => (running ? stopTimer(running.id) : startTimer(task.id))}
                    disabled={!task.projects || timerPending}
                    title={running ? "Stop timer" : "Start timer"}
                    aria-label={running ? "Stop timer" : "Start timer"}
                    className="flex items-center gap-1 p-1 rounded hover:bg-gray-100"
                  >
                    {timerPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : running ? (
                      <Square className="h-3.5 w-3.5 text-red-600" />
                    ) : (
                      <Play className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    {running && (
                      <span className="text-[11px] tabular-nums text-red-600">
                        {formatElapsed(now - Date.parse(running.started_at))}
                      </span>
                    )}
                  </button>
                </span>
              </TooltipTrigger>
              {!task.projects && (
                <TooltipContent>Task must be attached to a project to track time</TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
          {task.projects && (
            <button
              type="button"
              onClick={() => onLogTime(task)}
              title="Log time for this task"
              aria-label="Log time for this task"
              className="p-1 rounded hover:bg-gray-100"
            >
              <Timer className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
      </TableCell>

      {/* Title — opens the task detail drawer */}
      <TableCell className="max-w-[220px] border-r border-gray-100">
        <button
          type="button"
          onClick={() => onOpenDetail(task.id)}
          className="text-sm font-medium text-[#0f0f10] truncate block text-left hover:underline"
          title={task.title}
        >
          {task.title}
        </button>
        {task.projects?.accounts?.name && (
          <span className="text-[11px] text-muted-foreground">
            {task.projects.accounts.name}
          </span>
        )}
      </TableCell>

      {/* Project */}
      <TableCell className="max-w-[160px] border-r border-gray-100">
        {task.projects ? (
          <a
            href={`/projects/${task.projects.id}`}
            className="text-xs text-[#0f0f10] hover:underline truncate block"
          >
            {task.projects.name}
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Status */}
      <TableCell className="border-r border-gray-100">
        <TaskStatusBadge status={task.status} />
      </TableCell>

      {/* Assignee */}
      <TableCell className="border-r border-gray-100">
        <AssigneePicker assigneeId={task.assignee_id} team={team} onChange={() => {}} disabled showName />
      </TableCell>

      {/* Priority */}
      <TableCell className="border-r border-gray-100">
        <PriorityPill priority={task.priority} readOnly />
      </TableCell>

      {/* Due date */}
      <TableCell className="border-r border-gray-100">
        <span className={`text-xs ${isOverdue ? "text-red-600" : "text-gray-600"}`}>
          {task.due_date ?? "—"}
        </span>
      </TableCell>

      {/* Estimate (hours) */}
      <TableCell className="border-r border-gray-100">
        <span className="text-xs text-gray-600">{estimateLabel}</span>
      </TableCell>

      {/* Tags */}
      <TableCell className="max-w-[200px]">
        {task.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {task.tags.map((t) => (
              <span key={t} className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                {t}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}
