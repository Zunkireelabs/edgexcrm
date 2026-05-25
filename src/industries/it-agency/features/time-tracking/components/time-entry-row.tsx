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
import { ApprovalStatusBadge } from "./status-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatMinutes } from "../hooks/use-time-entries";
import type { TimeEntryWithJoins } from "../hooks/use-time-entries";

interface TimeEntryRowProps {
  entry: TimeEntryWithJoins;
  /** Whether the current user can edit this entry (own + pending, or admin). */
  canEdit: boolean;
  onUpdate: (entry: TimeEntryWithJoins) => void;
  onDelete: (id: string) => void;
}

export function TimeEntryRow({ entry, canEdit, onUpdate, onDelete }: TimeEntryRowProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [minutes, setMinutes] = useState(String(entry.minutes));
  const [notes, setNotes] = useState(entry.notes ?? "");

  function handleEditOpen() {
    setMinutes(String(entry.minutes));
    setNotes(entry.notes ?? "");
    setEditOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const parsedMin = parseInt(minutes, 10);
    if (!parsedMin || parsedMin <= 0) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/time-entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minutes: parsedMin,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error?.message ?? "Failed to update entry");
      }
      const { data } = await res.json();
      toast.success("Entry updated");
      onUpdate(data as TimeEntryWithJoins);
      setEditOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update entry");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/v1/time-entries/${entry.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete entry");
      toast.success("Entry deleted");
      onDelete(entry.id);
    } catch {
      toast.error("Failed to delete entry");
    } finally {
      setDeleteLoading(false);
    }
  }

  const parsedMin = parseInt(minutes, 10);
  const previewMinutes = parsedMin > 0 ? formatMinutes(parsedMin) : null;

  return (
    <>
      <div className="flex items-center gap-3 py-2.5 px-4 hover:bg-muted/40 rounded-lg group">
        {/* Time chip */}
        <div className="flex items-center gap-1.5 shrink-0 w-16 text-sm font-medium tabular-nums">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          {formatMinutes(entry.minutes)}
        </div>

        {/* Project / Task */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {entry.projects?.name ?? "—"}
            {entry.tasks && (
              <span className="text-muted-foreground font-normal"> · {entry.tasks.title}</span>
            )}
          </p>
          {entry.notes && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{entry.notes}</p>
          )}
        </div>

        {/* Status badge — rejected entries show reason on hover */}
        {entry.approval_status === "rejected" && entry.rejection_reason ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <ApprovalStatusBadge status={entry.approval_status} />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                {entry.rejection_reason}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <ApprovalStatusBadge status={entry.approval_status} />
        )}

        {/* Actions (only when editable) */}
        {canEdit && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={handleEditOpen}
              title="Edit entry"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={handleDelete}
              disabled={deleteLoading}
              title="Delete entry"
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
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Time Entry</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="te-edit-minutes">
                Minutes *
                {previewMinutes && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    = {previewMinutes}
                  </span>
                )}
              </Label>
              <Input
                id="te-edit-minutes"
                type="number"
                min="1"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="te-edit-notes">Notes</Label>
              <Textarea
                id="te-edit-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || parsedMin <= 0}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
