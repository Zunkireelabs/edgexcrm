"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRIORITY_CONFIG } from "./priority-pill";
import { AssigneePicker } from "./assignee-picker";
import { parsePasteLines, isMultiLinePaste } from "@/lib/tasks/parse-paste-lines";
import type { Task, TaskPriority } from "@/types/database";
import type { TeamMember } from "../hooks/use-projects";

const PRIORITIES: TaskPriority[] = ["low", "normal", "high", "urgent"];

interface ProjectOption {
  id: string;
  name: string;
}

interface TaskCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectOption[];
  team: TeamMember[];
  /** Current user — the assignee defaults to them. */
  currentUserId: string;
  /** Pre-selected + locked project (cockpit Tasks tab). */
  lockedProjectId?: string;
  onSuccess: (task: Task) => void;
}

export function TaskCreateDialog({
  open,
  onOpenChange,
  projects,
  team,
  currentUserId,
  lockedProjectId,
  onSuccess,
}: TaskCreateDialogProps) {
  const [saving, setSaving] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(lockedProjectId ?? null);
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState<string | null>(currentUserId);
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [estimate, setEstimate] = useState("");
  // Round 2 slice B (§3b): multi-line paste into Title switches to a preview
  // of one task per line instead of one task with embedded newlines.
  const [pasteLines, setPasteLines] = useState<string[] | null>(null);

  useEffect(() => {
    if (open) {
      setProjectId(lockedProjectId ?? null);
      setTitle("");
      setAssigneeId(currentUserId);
      setDueDate("");
      setPriority("normal");
      setEstimate("");
      setPasteLines(null);
    }
  }, [open, lockedProjectId, currentUserId]);

  const canSubmit = !!projectId && !!title.trim() && !saving;

  function handleTitlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (!isMultiLinePaste(text)) return;
    e.preventDefault();
    setPasteLines(parsePasteLines(text));
  }

  function removePasteLine(index: number) {
    setPasteLines((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  }

  // Bulk-created tasks are always assigned to the current user (no assignee
  // picker in the paste flow — §3b). Notification volume is why: once
  // creation emails the assignee (§2), pasting 20 lines assigned to one
  // teammate would fire 20 emails. Sidestepping that is a deliberate choice
  // for this round, not an oversight.
  async function handleBulkCreate() {
    if (!projectId || !pasteLines || pasteLines.length === 0 || saving) return;
    setSaving(true);
    let created = 0;
    let lastTask: Task | null = null;
    try {
      for (const lineTitle of pasteLines) {
        const res = await fetch(`/api/v1/projects/${projectId}/tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: lineTitle, assignee_id: currentUserId }),
        });
        if (res.ok) {
          const { data } = await res.json();
          lastTask = data as Task;
          created++;
        }
      }
      if (created > 0) {
        toast.success(`Created ${created} task${created === 1 ? "" : "s"}`);
        if (lastTask) onSuccess(lastTask);
        onOpenChange(false);
      }
      if (created < pasteLines.length) {
        toast.error(`${pasteLines.length - created} task${pasteLines.length - created === 1 ? "" : "s"} failed to create`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId || !title.trim()) return;
    setSaving(true);
    try {
      const hours = estimate.trim() ? parseFloat(estimate) : null;
      const body: Record<string, unknown> = {
        title: title.trim(),
        assignee_id: assigneeId,
        priority,
      };
      if (dueDate) body.due_date = dueDate;
      if (hours != null && !Number.isNaN(hours)) body.estimated_minutes = Math.round(hours * 60);

      const res = await fetch(`/api/v1/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: null }));
        throw new Error(error?.message ?? "Failed to create task");
      }
      const { data } = await res.json();
      toast.success("Task created");
      onSuccess(data as Task);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setSaving(false);
    }
  }

  const projectOptions = projects.map((p) => ({ value: p.id, label: p.name }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="task-project">Project *</Label>
            {lockedProjectId ? (
              <Input
                id="task-project"
                value={projects.find((p) => p.id === lockedProjectId)?.name ?? "—"}
                disabled
              />
            ) : (
              <Combobox
                options={projectOptions}
                value={projectId}
                onChange={setProjectId}
                placeholder="Select a project…"
                searchPlaceholder="Search projects…"
                emptyText="No projects found."
                className="h-9 text-sm"
              />
            )}
          </div>
          {pasteLines ? (
            <>
              {/* §3b paste preview — the one confirmation step worth having:
                  a mis-parse that silently creates 20 junk tasks is worse
                  than one extra keypress. */}
              <div className="space-y-1.5">
                <Label>
                  {pasteLines.length} task{pasteLines.length === 1 ? "" : "s"} parsed from paste
                </Label>
                <div className="max-h-56 overflow-y-auto space-y-1 rounded-md border border-input p-2">
                  {pasteLines.length === 0 ? (
                    <p className="text-sm text-muted-foreground px-1 py-2">
                      All lines removed — nothing to create.
                    </p>
                  ) : (
                    pasteLines.map((line, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50"
                      >
                        <span className="truncate">{line}</span>
                        <button
                          type="button"
                          onClick={() => removePasteLine(i)}
                          aria-label={`Drop "${line}"`}
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Each will be assigned to you, in this project.
                </p>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPasteLines(null)}>
                  Back
                </Button>
                <Button
                  type="button"
                  disabled={!projectId || pasteLines.length === 0 || saving}
                  onClick={handleBulkCreate}
                >
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Create {pasteLines.length} task{pasteLines.length === 1 ? "" : "s"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="task-title">Title *</Label>
                <Input
                  id="task-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onPaste={handleTitlePaste}
                  placeholder="What needs doing? (paste multiple lines to create several)"
                  required
                  autoFocus
                />
              </div>
              <div className="flex gap-3">
                <div className="space-y-1.5">
                  <Label>Assignee</Label>
                  <AssigneePicker assigneeId={assigneeId} team={team} onChange={setAssigneeId} showName />
                </div>
                <div className="space-y-1.5 flex-1">
                  <Label htmlFor="task-due">Due date</Label>
                  <Input
                    id="task-due"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <div className="space-y-1.5 flex-1">
                  <Label htmlFor="task-priority">Priority</Label>
                  <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                    <SelectTrigger id="task-priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {PRIORITY_CONFIG[p].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 w-28">
                  <Label htmlFor="task-est">Estimate (hrs)</Label>
                  <Input
                    id="task-est"
                    type="number"
                    min="0"
                    step="0.25"
                    value={estimate}
                    onChange={(e) => setEstimate(e.target.value)}
                    placeholder="—"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!canSubmit}>
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Create task
                </Button>
              </DialogFooter>
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
