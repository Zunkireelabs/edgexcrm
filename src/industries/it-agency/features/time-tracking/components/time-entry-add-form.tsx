"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMinutes } from "../hooks/use-time-entries";
import type { TimeEntryWithJoins } from "../hooks/use-time-entries";
import type { Project, Task } from "@/types/database";

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

interface TimeEntryAddFormProps {
  onSuccess: (entry: TimeEntryWithJoins) => void;
  onCancel: () => void;
  /** Pre-selected project (e.g. when adding from project detail — Phase 3 uses this from home). */
  defaultProjectId?: string;
}

export function TimeEntryAddForm({
  onSuccess,
  onCancel,
  defaultProjectId,
}: TimeEntryAddFormProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [saving, setSaving] = useState(false);

  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [taskId, setTaskId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [minutes, setMinutes] = useState("");
  const [notes, setNotes] = useState("");

  // Load active projects once
  useEffect(() => {
    fetch("/api/v1/projects?status=active")
      .then((r) => r.json())
      .then(({ data }) => {
        setProjects((data ?? []) as Project[]);
        if (!defaultProjectId && (data ?? []).length === 1) {
          setProjectId((data as Project[])[0].id);
        }
      })
      .catch(() => toast.error("Failed to load projects"))
      .finally(() => setLoadingProjects(false));
  }, [defaultProjectId]);

  // Load tasks when project changes
  useEffect(() => {
    setTaskId("");
    setTasks([]);
    if (!projectId) return;
    setLoadingTasks(true);
    fetch(`/api/v1/projects/${projectId}/tasks`)
      .then((r) => r.json())
      .then(({ data }) => setTasks((data ?? []) as Task[]))
      .catch(() => {})
      .finally(() => setLoadingTasks(false));
  }, [projectId]);

  const parsedMinutes = minutes ? parseInt(minutes, 10) : 0;
  const minutesPreview = parsedMinutes > 0 ? formatMinutes(parsedMinutes) : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId || !date || !minutes || parsedMinutes <= 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/v1/time-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          task_id: taskId || null,
          entry_date: date,
          minutes: parsedMinutes,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error?.message ?? "Failed to log time");
      }
      const { data } = await res.json();
      toast.success("Time logged");
      onSuccess(data as TimeEntryWithJoins);
      // Reset form (keep project/date for quick repeat logging)
      setMinutes("");
      setNotes("");
      setTaskId("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to log time");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border rounded-xl p-4 bg-background shadow-sm space-y-4"
    >
      <div className="flex items-center justify-between">
        <p className="font-medium text-sm">Log time</p>
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onCancel}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Project */}
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="te-project">Project *</Label>
          <Select
            value={projectId}
            onValueChange={setProjectId}
            disabled={loadingProjects}
          >
            <SelectTrigger id="te-project">
              <SelectValue placeholder={loadingProjects ? "Loading…" : "Select project"} />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Task (optional) */}
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="te-task">Task (optional)</Label>
          <Select
            value={taskId}
            onValueChange={setTaskId}
            disabled={!projectId || loadingTasks}
          >
            <SelectTrigger id="te-task">
              <SelectValue
                placeholder={
                  !projectId
                    ? "Select a project first"
                    : loadingTasks
                    ? "Loading…"
                    : tasks.length === 0
                    ? "No tasks"
                    : "No specific task"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {tasks.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Date */}
        <div className="space-y-1.5">
          <Label htmlFor="te-date">Date *</Label>
          <Input
            id="te-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>

        {/* Minutes */}
        <div className="space-y-1.5">
          <Label htmlFor="te-minutes">
            Minutes *
            {minutesPreview && (
              <span className="ml-2 font-normal text-muted-foreground">= {minutesPreview}</span>
            )}
          </Label>
          <Input
            id="te-minutes"
            type="number"
            min="1"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder="e.g. 90"
            required
          />
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <Label htmlFor="te-notes">Notes</Label>
        <Textarea
          id="te-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What did you work on?"
          rows={2}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={saving || !projectId || !date || parsedMinutes <= 0}
        >
          {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          Log time
        </Button>
      </div>
    </form>
  );
}
