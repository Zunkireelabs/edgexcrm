"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, ArrowUpDown, Timer, ListTodo } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LogTimeDialog } from "@/industries/it-agency/features/time-tracking/components/log-time-dialog";
import { AssigneePicker } from "../assignee-picker";
import { PriorityPill } from "../priority-pill";
import { TagMultiPicker } from "../tag-multi-picker";
import type { Task, TaskStatus, TaskPriority } from "@/types/database";
import type { TeamMember } from "../../hooks/use-projects";
import type { WorkspaceFilters } from "../../hooks/use-workspace-filters";

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
};

interface TaskWithProject extends Task {
  projects: {
    id: string;
    name: string;
    account_id: string;
    accounts: { id: string; name: string } | null;
  } | null;
}

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

interface TasksViewProps {
  filters: WorkspaceFilters;
  team: TeamMember[];
  teamMap: Map<string, TeamMember>;
  poolTags: string[];
  refetchTags: () => Promise<void>;
  onClearFilters: () => void;
}

export function TasksView({ filters, team, teamMap, poolTags, refetchTags, onClearFilters }: TasksViewProps) {
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
          const aEmail = a.assignee_id ? (teamMap.get(a.assignee_id)?.email ?? "") : "";
          const bEmail = b.assignee_id ? (teamMap.get(b.assignee_id)?.email ?? "") : "";
          cmp = aEmail.localeCompare(bEmail);
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

  async function patchTask(id: string, patch: Partial<Task>) {
    const res = await fetch(`/api/v1/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error("Failed to update task");
    const { data } = await res.json();
    return data as Task;
  }

  async function handleStatusChange(taskId: string, status: TaskStatus) {
    try {
      const updated = await patchTask(taskId, { status });
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...updated } : t)));
    } catch {
      toast.error("Failed to update status");
    }
  }

  async function handleAssigneeChange(taskId: string, assigneeId: string | null) {
    try {
      const updated = await patchTask(taskId, { assignee_id: assigneeId });
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...updated } : t)));
    } catch {
      toast.error("Failed to update assignee");
    }
  }

  async function handlePriorityChange(taskId: string, priority: TaskPriority) {
    try {
      const updated = await patchTask(taskId, { priority });
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...updated } : t)));
    } catch {
      toast.error("Failed to update priority");
    }
  }

  async function handleDueDateChange(taskId: string, due_date: string | null) {
    try {
      const updated = await patchTask(taskId, { due_date });
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...updated } : t)));
    } catch {
      toast.error("Failed to update due date");
    }
  }

  async function handleEstimateChange(taskId: string, estimated_minutes: number | null) {
    try {
      const updated = await patchTask(taskId, { estimated_minutes });
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...updated } : t)));
    } catch {
      toast.error("Failed to update estimate");
    }
  }

  async function handleTagsChange(taskId: string, newTags: string[]) {
    const prevTags = tasks.find((t) => t.id === taskId)?.tags ?? [];
    setTasks((curr) => curr.map((t) => (t.id === taskId ? { ...t, tags: newTags } : t)));
    try {
      const updated = await patchTask(taskId, { tags: newTags });
      setTasks((curr) => curr.map((t) => (t.id === taskId ? { ...t, ...updated } : t)));
      await refetchTags();
    } catch {
      setTasks((curr) => curr.map((t) => (t.id === taskId ? { ...t, tags: prevTags } : t)));
      toast.error("Failed to update tags");
    }
  }

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
        <p className="text-sm text-muted-foreground">No tasks match these filters.</p>
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
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50 border-b border-gray-200">
            <TableHead
              className={headCls}
              onClick={() => handleSort("title")}
              aria-sort={sortKey === "title" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
            >
              <span className="flex items-center gap-1">Title <SortIcon col="title" sortKey={sortKey} dir={sortDir} /></span>
            </TableHead>
            <TableHead
              className={headCls}
              onClick={() => handleSort("project")}
              aria-sort={sortKey === "project" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
            >
              <span className="flex items-center gap-1">Project <SortIcon col="project" sortKey={sortKey} dir={sortDir} /></span>
            </TableHead>
            <TableHead
              className={headCls}
              onClick={() => handleSort("status")}
              aria-sort={sortKey === "status" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
            >
              <span className="flex items-center gap-1">Status <SortIcon col="status" sortKey={sortKey} dir={sortDir} /></span>
            </TableHead>
            <TableHead
              className={headCls}
              onClick={() => handleSort("assignee")}
              aria-sort={sortKey === "assignee" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
            >
              <span className="flex items-center gap-1">Assignee <SortIcon col="assignee" sortKey={sortKey} dir={sortDir} /></span>
            </TableHead>
            <TableHead
              className={headCls}
              onClick={() => handleSort("priority")}
              aria-sort={sortKey === "priority" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
            >
              <span className="flex items-center gap-1">Priority <SortIcon col="priority" sortKey={sortKey} dir={sortDir} /></span>
            </TableHead>
            <TableHead
              className={headCls}
              onClick={() => handleSort("due_date")}
              aria-sort={sortKey === "due_date" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
            >
              <span className="flex items-center gap-1">Due <SortIcon col="due_date" sortKey={sortKey} dir={sortDir} /></span>
            </TableHead>
            <TableHead className="text-xs font-medium text-gray-600">Est.</TableHead>
            <TableHead className="text-xs font-medium text-gray-600">Tags</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              team={team}
              poolTags={poolTags}
              onStatusChange={handleStatusChange}
              onAssigneeChange={handleAssigneeChange}
              onPriorityChange={handlePriorityChange}
              onDueDateChange={handleDueDateChange}
              onEstimateChange={handleEstimateChange}
              onTagsChange={handleTagsChange}
              onLogTime={openLogTime}
            />
          ))}
        </TableBody>
      </Table>

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

interface TaskRowProps {
  task: TaskWithProject;
  team: TeamMember[];
  poolTags: string[];
  onStatusChange: (id: string, s: TaskStatus) => void;
  onAssigneeChange: (id: string, uid: string | null) => void;
  onPriorityChange: (id: string, p: TaskPriority) => void;
  onDueDateChange: (id: string, d: string | null) => void;
  onEstimateChange: (id: string, estimated_minutes: number | null) => void;
  onTagsChange: (id: string, tags: string[]) => void;
  onLogTime: (task: TaskWithProject) => void;
}

function TaskRow({
  task,
  team,
  poolTags,
  onStatusChange,
  onAssigneeChange,
  onPriorityChange,
  onDueDateChange,
  onEstimateChange,
  onTagsChange,
  onLogTime,
}: TaskRowProps) {
  const isOverdue =
    task.due_date != null &&
    task.status !== "done" &&
    task.due_date < new Date().toISOString().split("T")[0];

  const [estimateInput, setEstimateInput] = useState(
    task.estimated_minutes != null ? String(Math.round((task.estimated_minutes / 60) * 100) / 100) : ""
  );

  function commitEstimate() {
    const trimmed = estimateInput.trim();
    const minutes = trimmed ? Math.round(parseFloat(trimmed) * 60) : null;
    if (minutes != null && Number.isNaN(minutes)) return;
    if (minutes === (task.estimated_minutes ?? null)) return;
    onEstimateChange(task.id, minutes);
  }

  return (
    <TableRow className="group hover:bg-gray-50">
      {/* Title */}
      <TableCell className="max-w-[220px]">
        <span className="text-sm font-medium text-[#0f0f10] truncate block" title={task.title}>
          {task.title}
        </span>
        {task.projects?.accounts?.name && (
          <span className="text-[11px] text-muted-foreground">
            {task.projects.accounts.name}
          </span>
        )}
      </TableCell>

      {/* Project */}
      <TableCell className="max-w-[160px]">
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
      <TableCell>
        <Select
          value={task.status}
          onValueChange={(v) => onStatusChange(task.id, v as TaskStatus)}
        >
          <SelectTrigger className="h-6 text-xs border-0 bg-transparent p-0 gap-1 w-auto focus:ring-0 shadow-none hover:bg-gray-100 rounded px-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.entries(TASK_STATUS_LABELS) as [TaskStatus, string][]).map(([v, lbl]) => (
              <SelectItem key={v} value={v} className="text-xs">{lbl}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>

      {/* Assignee */}
      <TableCell>
        <AssigneePicker
          assigneeId={task.assignee_id}
          team={team}
          onChange={(uid) => onAssigneeChange(task.id, uid)}
        />
      </TableCell>

      {/* Priority */}
      <TableCell>
        <PriorityPill
          priority={task.priority}
          onChange={(p) => onPriorityChange(task.id, p)}
        />
      </TableCell>

      {/* Due date */}
      <TableCell>
        <input
          type="date"
          value={task.due_date ?? ""}
          onChange={(e) => onDueDateChange(task.id, e.target.value || null)}
          aria-label="Due date"
          className={[
            "text-xs border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring bg-transparent",
            isOverdue ? "text-red-600 border-red-200" : "border-gray-200 text-gray-700",
          ].join(" ")}
        />
      </TableCell>

      {/* Estimate (hours) */}
      <TableCell>
        <input
          type="number"
          min="0"
          step="0.25"
          value={estimateInput}
          onChange={(e) => setEstimateInput(e.target.value)}
          onBlur={commitEstimate}
          placeholder="—"
          aria-label="Estimated hours"
          className="w-14 text-xs border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring bg-transparent text-gray-700"
        />
      </TableCell>

      {/* Tags */}
      <TableCell className="max-w-[200px]">
        <TagMultiPicker
          size="sm"
          value={task.tags}
          onChange={(next) => onTagsChange(task.id, next)}
          allTags={poolTags}
          placeholder="+ tag"
        />
      </TableCell>

      {/* Log time action */}
      <TableCell>
        {task.projects && (
          <button
            type="button"
            onClick={() => onLogTime(task)}
            title="Log time for this task"
            aria-label="Log time for this task"
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-gray-100"
          >
            <Timer className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
      </TableCell>
    </TableRow>
  );
}

