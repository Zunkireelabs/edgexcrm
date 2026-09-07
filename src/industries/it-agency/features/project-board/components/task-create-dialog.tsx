"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
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

  useEffect(() => {
    if (open) {
      setProjectId(lockedProjectId ?? null);
      setTitle("");
      setAssigneeId(currentUserId);
      setDueDate("");
      setPriority("normal");
      setEstimate("");
    }
  }, [open, lockedProjectId, currentUserId]);

  const canSubmit = !!projectId && !!title.trim() && !saving;

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
          <div className="space-y-1.5">
            <Label htmlFor="task-title">Title *</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
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
        </form>
      </DialogContent>
    </Dialog>
  );
}
