"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RateInput } from "../../time-tracking/components/rate-input";
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
import type { Project, ProjectStatus } from "@/types/database";

const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: "planning",   label: "Planning" },
  { value: "active",     label: "Active" },
  { value: "in_review",  label: "In Review" },
  { value: "delivered",  label: "Delivered" },
  { value: "on_hold",    label: "On Hold" },
  { value: "cancelled",  label: "Cancelled" },
];

interface ProjectFormProps {
  project?: Project;
  /** Pre-set account_id when creating from an account detail page. */
  accountId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (project: Project) => void;
}

export function ProjectForm({
  project,
  accountId,
  open,
  onOpenChange,
  onSuccess,
}: ProjectFormProps) {
  const isEdit = Boolean(project);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(project?.name ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "active");
  const [rate, setRate] = useState(project?.default_rate != null ? String(project.default_rate) : "");
  const [notes, setNotes] = useState(project?.notes ?? "");

  function handleOpenChange(next: boolean) {
    if (next) {
      setName(project?.name ?? "");
      setStatus(project?.status ?? "active");
      setRate(project?.default_rate != null ? String(project.default_rate) : "");
      setNotes(project?.notes ?? "");
    }
    onOpenChange(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const url = isEdit ? `/api/v1/projects/${project!.id}` : "/api/v1/projects";
      const method = isEdit ? "PATCH" : "POST";
      const body: Record<string, unknown> = {
        name: name.trim(),
        status,
        default_rate: rate ? parseFloat(rate) : null,
        notes: notes.trim() || null,
      };
      if (!isEdit) body.account_id = accountId ?? project?.account_id;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error?.message ?? "Failed to save project");
      }
      const { data } = await res.json();
      toast.success(isEdit ? "Project updated" : "Project created");
      onSuccess(data as Project);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save project");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Project" : "New Project"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="proj-name">Project name *</Label>
            <Input
              id="proj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="BathroomFort Website"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proj-status">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
              <SelectTrigger id="proj-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proj-rate">Default hourly rate (overrides member rate)</Label>
            <RateInput id="proj-rate" value={rate} onChange={setRate} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proj-notes">Notes</Label>
            <Textarea
              id="proj-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes about this project…"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEdit ? "Save changes" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
