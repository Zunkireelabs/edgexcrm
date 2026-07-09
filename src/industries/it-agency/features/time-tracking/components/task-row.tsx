"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Trash2, Loader2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { TaskStatusBadge } from "./status-badge";
import { AssigneePicker } from "../../project-board/components/assignee-picker";
import type { TeamMember } from "../../project-board/hooks/use-projects";
import type { Task, TaskStatus } from "@/types/database";

/** Minutes → hours string for the estimate input, rounded to 2 decimals to avoid float artifacts (e.g. 100min -> "1.67"). */
function minutesToHoursInput(minutes: number | null): string {
  if (minutes == null) return "";
  return String(Math.round((minutes / 60) * 100) / 100);
}

const TASK_STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "todo",        label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "done",        label: "Done" },
];

interface TaskRowProps {
  task: Task;
  isAdmin: boolean;
  team?: TeamMember[];
  onUpdate: (task: Task) => void;
  onDelete: (taskId: string) => void;
}

export function TaskRow({ task, isAdmin, team = [], onUpdate, onDelete }: TaskRowProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [estimatedHours, setEstimatedHours] = useState(minutesToHoursInput(task.estimated_minutes));

  function handleEditOpen() {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setStatus(task.status);
    setEstimatedHours(minutesToHoursInput(task.estimated_minutes));
    setEditOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          status,
          estimated_minutes: estimatedHours.trim() ? Math.round(parseFloat(estimatedHours) * 60) : null,
        }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error?.message ?? "Failed to update task");
      }
      const { data } = await res.json();
      toast.success("Task updated");
      onUpdate(data as Task);
      setEditOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update task");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/v1/tasks/${task.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete task");
      toast.success("Task deleted");
      onDelete(task.id);
    } catch {
      toast.error("Failed to delete task");
    } finally {
      setDeleteLoading(false);
    }
  }

  const estHours =
    task.estimated_minutes != null
      ? `${Math.floor(task.estimated_minutes / 60)}h ${task.estimated_minutes % 60}m`
      : null;

  async function handleAssigneeChange(userId: string | null) {
    try {
      const res = await fetch(`/api/v1/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignee_id: userId }),
      });
      if (!res.ok) throw new Error("Failed to update assignee");
      const { data } = await res.json();
      onUpdate(data as Task);
    } catch {
      toast.error("Failed to update assignee");
    }
  }

  return (
    <>
      <div className="flex items-center gap-3 py-3 px-4 hover:bg-muted/40 rounded-lg group">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">{task.title}</span>
            <TaskStatusBadge status={task.status} />
          </div>
          {(task.description || estHours) && (
            <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
              {task.description && (
                <span className="truncate max-w-xs">{task.description}</span>
              )}
              {estHours && (
                <span className="flex items-center gap-1 shrink-0">
                  <Clock className="h-3 w-3" />
                  {estHours}
                </span>
              )}
            </div>
          )}
        </div>
        <AssigneePicker
          assigneeId={task.assignee_id}
          team={team}
          onChange={handleAssigneeChange}
          disabled={!isAdmin}
        />
        {isAdmin && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={handleEditOpen}
              title="Edit task"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={handleDelete}
              disabled={deleteLoading}
              title="Delete task"
            >
              {deleteLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        )}
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Task</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="task-title">Title *</Label>
              <Input
                id="task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-desc">Description</Label>
              <Textarea
                id="task-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="task-status">Status</Label>
                <Select
                  value={status}
                  onValueChange={(v) => setStatus(v as TaskStatus)}
                >
                  <SelectTrigger id="task-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-est">Est. hours</Label>
                <Input
                  id="task-est"
                  type="number"
                  min="0"
                  step="0.25"
                  value={estimatedHours}
                  onChange={(e) => setEstimatedHours(e.target.value)}
                  placeholder="e.g. 1.5"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !title.trim()}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
