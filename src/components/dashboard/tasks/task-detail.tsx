"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Trash2, UserCircle2 } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TaskStatusBadge } from "@/industries/it-agency/features/time-tracking/components/status-badge";
import { PriorityPill } from "@/industries/it-agency/features/project-board/components/priority-pill";
import { AssigneePicker } from "@/industries/it-agency/features/project-board/components/assignee-picker";
import { TagMultiPicker } from "@/industries/it-agency/features/project-board/components/tag-multi-picker";
import { TaskContextChip } from "./task-context-chip";
import { TaskTimerButton } from "./task-timer-button";
import { notifyTaskChanged } from "@/lib/tasks/task-events";
import type { TaskStatus, TaskPriority } from "@/types/database";

// Round 2 slice A — the task as a first-class object
// (docs/IT-AGENCY-ROUND2-TASK-OBJECT-BRIEF.md §2). One component, rendered as
// a right-side drawer (in-app click, via the @modal intercepting route) or a
// full page (/tasks/[id] direct load, e.g. an email link) — see
// src/app/(main)/(dashboard)/tasks/[id]/page.tsx and
// src/app/(main)/(dashboard)/@modal/(.)tasks/[id]/page.tsx.
//
// A task can be a project task (it_agency, PATCH/DELETE via
// /api/v1/tasks/[id]) or a personal task from ANY industry (Home's My Tasks —
// "Universal task assignment" — PATCH/DELETE via /api/v1/my-tasks/[id]).
// Those two endpoints have genuinely different field support and
// authorization (see fetchTaskDetail below and the Round 2 report) — this
// component picks the endpoint pair once, on load, and reuses it for every
// mutation. Per the brief §4, this does NOT change what either PATCH/DELETE
// accepts or authorizes; it only chooses between the two that already exist.

export type TaskDetailMode = "tasks" | "my-tasks";

export interface TaskDetailTask {
  id: string;
  tenant_id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  estimated_minutes: number | null;
  is_billable: boolean;
  assignee_id: string | null;
  assigned_by_id: string | null;
  lead_id: string | null;
  deal_id: string | null;
  due_date: string | null;
  priority: TaskPriority;
  tags: string[];
  created_at: string;
  updated_at: string;
  projects: { id: string; name: string } | null;
  leads: { id: string; first_name: string | null; last_name: string | null } | null;
  deals: { id: string; name: string } | null;
}

interface TeamMember {
  user_id: string;
  name: string;
}

const TASK_STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
];

function minutesToHoursInput(minutes: number | null): string {
  if (minutes == null) return "";
  return String(Math.round((minutes / 60) * 100) / 100);
}

type FetchResult =
  | { kind: "ok"; mode: TaskDetailMode; task: TaskDetailTask }
  | { kind: "not_found" };

/**
 * Tries the it_agency project-task endpoint first (works for any it_agency
 * task, project-linked or not — FEATURES.ACCOUNTS is the deciding gate, not
 * project_id). A 403 there means the tenant isn't it_agency, so the task can
 * only be a universal personal task — fall back to /api/v1/my-tasks/[id]. A
 * 404 from the primary call is a real not-found (tenant isolation via
 * scopedClient) and does NOT fall back.
 */
async function fetchTaskDetail(taskId: string): Promise<FetchResult> {
  const primary = await fetch(`/api/v1/tasks/${taskId}`);
  if (primary.ok) {
    const { data } = await primary.json();
    return { kind: "ok", mode: "tasks", task: data as TaskDetailTask };
  }
  if (primary.status === 404) return { kind: "not_found" };

  const fallback = await fetch(`/api/v1/my-tasks/${taskId}`);
  if (fallback.ok) {
    const { data } = await fallback.json();
    return { kind: "ok", mode: "my-tasks", task: data as TaskDetailTask };
  }
  return { kind: "not_found" };
}

export interface TaskDetailBodyProps {
  taskId: string;
  currentUserId: string;
  /** auth.role === "owner" || "admin" — matches the PATCH/DELETE admin gate on both endpoints. */
  isAdmin: boolean;
  /** tenantData.permissions.canManageProjects — the it_agency delivery admin gate DELETE /api/v1/tasks/[id] actually checks (distinct from `isAdmin`). */
  canManageProjects: boolean;
  /** Already-running timer id for this task, if the caller happens to know it (e.g. from ActiveTimersProvider). Unknown callers pass nothing. */
  initialTimerId?: string | null;
  onChanged?: () => void;
  onDeleted?: () => void;
}

export function TaskDetailBody({
  taskId,
  currentUserId,
  isAdmin,
  canManageProjects,
  initialTimerId = null,
  onChanged,
  onDeleted,
}: TaskDetailBodyProps) {
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [mode, setMode] = useState<TaskDetailMode | null>(null);
  const [task, setTask] = useState<TaskDetailTask | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [poolTags, setPoolTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [descInput, setDescInput] = useState("");
  const [estimateInput, setEstimateInput] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    try {
      const result = await fetchTaskDetail(taskId);
      if (result.kind === "not_found") {
        setNotFound(true);
        setTask(null);
        setMode(null);
        return;
      }
      setMode(result.mode);
      setTask(result.task);
      setTitleInput(result.task.title);
      setDescInput(result.task.description ?? "");
      setEstimateInput(minutesToHoursInput(result.task.estimated_minutes));
    } catch {
      toast.error("Failed to load task");
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/v1/team?minimal=1")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then(({ data }) => setTeam((data ?? []) as TeamMember[]))
      .catch(() => setTeam([]));
  }, []);

  useEffect(() => {
    if (mode !== "tasks") return;
    fetch("/api/v1/tasks/tags")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then(({ data }) => setPoolTags((data ?? []) as string[]))
      .catch(() => setPoolTags([]));
  }, [mode]);

  async function patch(fields: Record<string, unknown>) {
    if (!task || !mode) return;
    setBusy(true);
    try {
      const url = mode === "tasks" ? `/api/v1/tasks/${task.id}` : `/api/v1/my-tasks/${task.id}`;
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? "Failed to update task");
        return;
      }
      setTask((prev) => (prev ? { ...prev, ...(json.data as Partial<TaskDetailTask>) } : prev));
      onChanged?.();
      notifyTaskChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!task || !mode) return;
    setBusy(true);
    try {
      const url = mode === "tasks" ? `/api/v1/tasks/${task.id}` : `/api/v1/my-tasks/${task.id}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        toast.error(json?.error?.message ?? "Failed to delete task");
        return;
      }
      toast.success("Task deleted");
      onChanged?.();
      notifyTaskChanged();
      onDeleted?.();
    } finally {
      setBusy(false);
      setDeleteOpen(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1 py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !task || !mode) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 py-12 gap-1 text-center">
        <p className="text-sm font-medium text-foreground">Task not found</p>
        <p className="text-xs text-muted-foreground">
          It may have been deleted, or it belongs to a different organization.
        </p>
      </div>
    );
  }

  const isOwner = task.assignee_id === currentUserId || task.assigned_by_id === currentUserId;
  const isUnassigned = task.assignee_id === null;

  // Mirrors PATCH /api/v1/tasks/[id] (isAdmin || ownsTask || isUnassigned) and
  // PATCH /api/v1/my-tasks/[id] (isOwner || requireAdmin) exactly — see the
  // Round 2 report for why they diverge on the isUnassigned allowance.
  const canEdit = mode === "tasks" ? isAdmin || isOwner || isUnassigned : isAdmin || isOwner;
  // DELETE /api/v1/tasks/[id] gates on canManageProjects (a position
  // permission), NOT the role-based isAdmin the PATCH routes use — a real,
  // pre-existing asymmetry, not something this component invented.
  const canDelete = mode === "tasks" ? canManageProjects : isAdmin || isOwner;
  // title is admin-only on tasks/[id] (absent from its NON_ADMIN_FIELDS) but
  // owner-editable on my-tasks/[id].
  const canEditTitle = mode === "tasks" ? isAdmin : canEdit;
  const canEditBillable = mode === "tasks" && isAdmin;
  const assignedByName = task.assigned_by_id ? team.find((m) => m.user_id === task.assigned_by_id)?.name : null;
  const assigneeName = task.assignee_id ? team.find((m) => m.user_id === task.assignee_id)?.name : null;

  function commitTitle() {
    const trimmed = titleInput.trim();
    if (!trimmed || trimmed === task!.title) {
      setTitleInput(task!.title);
      return;
    }
    patch({ title: trimmed });
  }

  function commitDescription() {
    const trimmed = descInput.trim();
    if (trimmed === (task!.description ?? "")) return;
    patch({ description: trimmed || null });
  }

  function commitEstimate() {
    const trimmed = estimateInput.trim();
    const minutes = trimmed ? Math.round(parseFloat(trimmed) * 60) : null;
    if (minutes != null && Number.isNaN(minutes)) return;
    if (minutes === (task!.estimated_minutes ?? null)) return;
    patch({ estimated_minutes: minutes });
  }

  return (
    <>
      {/* Plain elements rather than SheetHeader/SheetTitle/SheetFooter — this
          body renders both inside a Sheet (the drawer) and inside a plain
          page shell (the full page), and SheetTitle is a Radix Dialog.Title
          that expects a Dialog context the page doesn't have. */}
      <div className="flex flex-col gap-1.5 p-4">
        <h2 className="text-foreground font-semibold pr-8">
          {canEditTitle ? (
            <Input
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onBlur={commitTitle}
              disabled={busy}
              className="text-base font-semibold border-transparent hover:border-input focus-visible:border-input -mx-3 h-auto py-1"
            />
          ) : (
            <span>{task.title}</span>
          )}
        </h2>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {canEdit ? (
            <Select value={task.status} onValueChange={(v) => patch({ status: v as TaskStatus })}>
              <SelectTrigger className="h-6 text-xs w-auto gap-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <TaskStatusBadge status={task.status} />
          )}
          <PriorityPill
            priority={task.priority}
            onChange={canEdit ? (p) => patch({ priority: p }) : undefined}
            readOnly={!canEdit}
          />
          <TaskContextChip
            task={{ projects: task.projects, leads: task.leads, deals: task.deals }}
            projectBoardEnabled={mode === "tasks"}
          />
        </div>
      </div>

      <div className="px-4 flex-1 overflow-y-auto space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Description</Label>
          {canEdit ? (
            <Textarea
              value={descInput}
              onChange={(e) => setDescInput(e.target.value)}
              onBlur={commitDescription}
              disabled={busy}
              rows={3}
              placeholder="Add a description…"
            />
          ) : (
            <p className="text-sm text-foreground whitespace-pre-wrap">
              {task.description || <span className="text-muted-foreground italic">No description.</span>}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Assignee</Label>
            {mode === "my-tasks" && canEdit ? (
              <AssigneePicker
                assigneeId={task.assignee_id}
                team={team}
                onChange={(uid) => patch({ assignee_id: uid })}
                showName
              />
            ) : mode === "tasks" && !isAdmin && isUnassigned ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => patch({ assignee_id: currentUserId })}>
                Claim this task
              </Button>
            ) : task.assignee_id ? (
              <div className="flex items-center gap-1.5">
                <AssigneePicker assigneeId={task.assignee_id} team={team} onChange={() => {}} disabled showName />
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <UserCircle2 className="h-4 w-4" />
                Unassigned
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-due" className="text-xs text-muted-foreground">
              Due date
            </Label>
            {canEdit ? (
              <input
                id="task-due"
                type="date"
                value={task.due_date ?? ""}
                disabled={busy}
                onChange={(e) => patch({ due_date: e.target.value || null })}
                className="w-full text-sm border border-input rounded-md px-2 py-1.5 bg-transparent focus:outline-none focus:ring-1 focus:ring-ring"
              />
            ) : (
              <p className="text-sm text-foreground">{task.due_date ?? "—"}</p>
            )}
          </div>
        </div>

        {mode === "tasks" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="task-est" className="text-xs text-muted-foreground">
                Estimated hours
              </Label>
              {canEdit ? (
                <Input
                  id="task-est"
                  type="number"
                  min="0"
                  step="0.25"
                  value={estimateInput}
                  disabled={busy}
                  onChange={(e) => setEstimateInput(e.target.value)}
                  onBlur={commitEstimate}
                  placeholder="e.g. 1.5"
                />
              ) : (
                <p className="text-sm text-foreground">{estimateInput || "—"}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Billable</Label>
              <div className="flex items-center gap-2 h-9">
                <Checkbox
                  checked={task.is_billable}
                  disabled={busy || !canEditBillable}
                  onCheckedChange={(checked) => patch({ is_billable: checked === true })}
                />
                <span className="text-sm text-muted-foreground">
                  {task.is_billable ? "Billable" : "Not billable"}
                </span>
              </div>
            </div>
          </div>
        )}

        {mode === "tasks" && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Tags</Label>
            {canEdit ? (
              <TagMultiPicker
                value={task.tags}
                onChange={(next) => patch({ tags: next })}
                allTags={poolTags}
                placeholder="+ tag"
              />
            ) : task.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {task.tags.map((t) => (
                  <span key={t} className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                    {t}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </div>
        )}

        {task.project_id && (
          <div className="flex items-center gap-2">
            <TaskTimerButton taskId={task.id} initialTimerId={initialTimerId} />
            <span className="text-xs text-muted-foreground">Time tracking</span>
          </div>
        )}

        <Separator />

        <div className="text-xs text-muted-foreground space-y-0.5">
          {assignedByName && <p>Assigned by {assignedByName}</p>}
          {!assignedByName && assigneeName && <p>Assigned to {assigneeName}</p>}
          <p>Created {new Date(task.created_at).toLocaleDateString()}</p>
        </div>
      </div>

      <div className="mt-auto flex flex-row justify-end gap-2 p-4">
        {canDelete && (
          <Button
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => (deleteOpen ? handleDelete() : setDeleteOpen(true))}
            onBlur={() => setDeleteOpen(false)}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
            {deleteOpen ? "Confirm delete" : "Delete task"}
          </Button>
        )}
      </div>
    </>
  );
}

export interface TaskDetailDrawerProps {
  taskId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserId: string;
  isAdmin: boolean;
  canManageProjects: boolean;
  initialTimerId?: string | null;
  /** Called after any successful mutation (edit or delete) so the caller's list can refetch. */
  onChanged?: () => void;
}

/** The drawer presentation — one component, reused by every surface (see the file header). */
export function TaskDetailDrawer({
  taskId,
  open,
  onOpenChange,
  currentUserId,
  isAdmin,
  canManageProjects,
  initialTimerId,
  onChanged,
}: TaskDetailDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md w-full flex flex-col">
        {/* Radix requires a real Dialog.Title descendant for a11y; TaskDetailBody
            renders its own visible <h2> (shared with the plain-page variant,
            which has no Dialog context to satisfy this against) so this one
            stays screen-reader-only. */}
        <SheetTitle className="sr-only">Task details</SheetTitle>
        {taskId && (
          <TaskDetailBody
            key={taskId}
            taskId={taskId}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            canManageProjects={canManageProjects}
            initialTimerId={initialTimerId}
            onChanged={onChanged}
            onDeleted={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
