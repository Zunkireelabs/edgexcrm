"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { RateInput } from "../../time-tracking/components/rate-input";
import { OwnerPicker } from "./owner-picker";
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
import type { Account, Project, ProjectStatus } from "@/types/database";
import type { TeamMember } from "../hooks/use-projects";

const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: "planning",   label: "Planning" },
  { value: "active",     label: "Active" },
  { value: "in_review",  label: "In Review" },
  { value: "delivered",  label: "Delivered" },
  { value: "on_hold",    label: "On Hold" },
  { value: "cancelled",  label: "Cancelled" },
];

type ProjectType = "client" | "internal";

interface ProjectFormProps {
  project?: Project;
  /** Pre-set + locked account_id when creating from an account detail page. */
  accountId?: string;
  /** Accounts to choose from when no `accountId` is locked. */
  accounts?: Account[];
  /** Team members for the owner picker. */
  team?: TeamMember[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (project: Project) => void;
}

export function ProjectForm({
  project,
  accountId,
  accounts = [],
  team = [],
  open,
  onOpenChange,
  onSuccess,
}: ProjectFormProps) {
  const isEdit = Boolean(project);
  const accountLocked = Boolean(accountId);

  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(project?.name ?? "");
  const [type, setType] = useState<ProjectType>(
    accountLocked || project?.account_id ? "client" : "internal"
  );
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    accountId ?? project?.account_id ?? null
  );
  const [ownerId, setOwnerId] = useState<string | null>(project?.owner_id ?? null);
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "active");
  const [startDate, setStartDate] = useState(project?.start_date ?? "");
  const [targetEndDate, setTargetEndDate] = useState(project?.target_end_date ?? "");
  const [rate, setRate] = useState(project?.default_rate != null ? String(project.default_rate) : "");
  const [notes, setNotes] = useState(project?.notes ?? "");

  function handleOpenChange(next: boolean) {
    if (next) {
      setName(project?.name ?? "");
      setType(accountLocked || project?.account_id ? "client" : "internal");
      setSelectedAccountId(accountId ?? project?.account_id ?? null);
      setOwnerId(project?.owner_id ?? null);
      setStatus(project?.status ?? "active");
      setStartDate(project?.start_date ?? "");
      setTargetEndDate(project?.target_end_date ?? "");
      setRate(project?.default_rate != null ? String(project.default_rate) : "");
      setNotes(project?.notes ?? "");
    }
    onOpenChange(next);
  }

  const needsAccount = type === "client";
  const canSubmit = !!name.trim() && (!needsAccount || !!selectedAccountId) && !saving;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (needsAccount && !selectedAccountId) return;
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
      if (!isEdit) {
        if (needsAccount) body.account_id = selectedAccountId;
        if (ownerId) body.owner_id = ownerId;
        if (startDate) body.start_date = startDate;
        if (targetEndDate) body.target_end_date = targetEndDate;
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: null }));
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

  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name }));

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

          {!isEdit && !accountLocked && (
            <div className="space-y-1.5">
              <Label>Type</Label>
              <div className="inline-flex rounded-md border border-input overflow-hidden text-sm">
                <button
                  type="button"
                  aria-pressed={type === "client"}
                  onClick={() => setType("client")}
                  className={`px-3 py-1.5 ${type === "client" ? "bg-foreground text-background" : "bg-background text-muted-foreground"}`}
                >
                  Client
                </button>
                <button
                  type="button"
                  aria-pressed={type === "internal"}
                  onClick={() => setType("internal")}
                  className={`px-3 py-1.5 border-l border-input ${type === "internal" ? "bg-foreground text-background" : "bg-background text-muted-foreground"}`}
                >
                  Internal
                </button>
              </div>
            </div>
          )}

          {!isEdit && needsAccount && (
            <div className="space-y-1.5">
              <Label htmlFor="proj-account">Account *</Label>
              {accountLocked ? (
                <Input
                  id="proj-account"
                  value={accounts.find((a) => a.id === accountId)?.name ?? "This account"}
                  disabled
                />
              ) : (
                <Combobox
                  options={accountOptions}
                  value={selectedAccountId}
                  onChange={setSelectedAccountId}
                  placeholder="Select an account…"
                  searchPlaceholder="Search accounts…"
                  emptyText="No accounts found."
                  className="h-9 text-sm"
                />
              )}
            </div>
          )}

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

          {!isEdit && (
            <>
              <div className="space-y-1.5">
                <Label>Owner</Label>
                <div>
                  <OwnerPicker ownerId={ownerId} team={team} onChange={setOwnerId} />
                </div>
              </div>
              <div className="flex gap-3">
                <div className="space-y-1.5 flex-1">
                  <Label htmlFor="proj-start">Start date</Label>
                  <Input
                    id="proj-start"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5 flex-1">
                  <Label htmlFor="proj-end">Target end date</Label>
                  <Input
                    id="proj-end"
                    type="date"
                    value={targetEndDate}
                    onChange={(e) => setTargetEndDate(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

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
            <Button type="submit" disabled={!canSubmit}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEdit ? "Save changes" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
