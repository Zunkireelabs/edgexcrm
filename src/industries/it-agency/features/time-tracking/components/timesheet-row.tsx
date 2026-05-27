"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Trash2, Loader2, ThumbsUp, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ApprovalStatusBadge } from "./status-badge";
import { useApproveReject } from "../hooks/use-approve-reject";
import { formatMinutes } from "../hooks/use-time-entries";
import type { TimeEntryWithJoins } from "../hooks/use-time-entries";

interface TimesheetRowProps {
  entry: TimeEntryWithJoins;
  isAdmin: boolean;
  showMemberColumn: boolean;
  userEmailMap: Record<string, string>;
  onUpdate: (entry: TimeEntryWithJoins) => void;
  onDelete: (id: string) => void;
  onApprovalChange: (id: string, action: "approve" | "reject") => void;
}

export function TimesheetRow({
  entry,
  isAdmin,
  showMemberColumn,
  userEmailMap,
  onUpdate,
  onDelete,
  onApprovalChange,
}: TimesheetRowProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [minutes, setMinutes] = useState(String(entry.minutes));
  const [notes, setNotes] = useState(entry.notes ?? "");

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const { approve, reject: rejectEntry, processingIds } = useApproveReject({
    onSuccess: (id, action) => {
      onApprovalChange(id, action);
      if (action === "reject") {
        setRejectOpen(false);
        setRejectReason("");
      }
    },
  });

  const isProcessing = processingIds.has(entry.id);
  const canEdit = entry.approval_status === "pending";

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
        body: JSON.stringify({ minutes: parsedMin, notes: notes.trim() || null }),
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

  async function handleRejectSubmit(e: React.FormEvent) {
    e.preventDefault();
    await rejectEntry(entry.id, rejectReason.trim());
  }

  const parsedMin = parseInt(minutes, 10);
  const previewMinutes = parsedMin > 0 ? formatMinutes(parsedMin) : null;

  const memberEmail = userEmailMap[entry.user_id] ?? entry.user_id.slice(0, 8) + "…";
  const memberName = memberEmail.includes("@") ? memberEmail.split("@")[0] : memberEmail;

  const statusCell =
    entry.approval_status === "rejected" && entry.rejection_reason ? (
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
    );

  return (
    <>
      <TableRow className="group">
        {/* Checkbox stub — bulk actions live on /approvals */}
        {/* TODO: wire to bulk action bar in a future phase */}
        <TableCell className="w-8 px-3">
          <Checkbox disabled aria-label="Select entry" />
        </TableCell>

        <TableCell className="w-20 font-medium tabular-nums text-sm">
          {formatMinutes(entry.minutes)}
        </TableCell>

        {showMemberColumn && (
          <TableCell className="w-28 text-sm">
            <span title={memberEmail}>{memberName}</span>
          </TableCell>
        )}

        <TableCell className="text-sm">{entry.projects?.accounts?.name ?? "—"}</TableCell>
        <TableCell className="text-sm">{entry.projects?.name ?? "—"}</TableCell>
        <TableCell className="text-sm">{entry.tasks?.title ?? "—"}</TableCell>

        <TableCell className="text-sm max-w-[160px]">
          {entry.notes ? (
            <span className="truncate block max-w-[160px]" title={entry.notes}>
              {entry.notes}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>

        <TableCell>{statusCell}</TableCell>

        <TableCell className="w-36">
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {canEdit && (
              <>
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
              </>
            )}
            {isAdmin && canEdit && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs text-green-700 border-green-200 hover:bg-green-50"
                  onClick={() => approve(entry.id)}
                  disabled={isProcessing}
                  title="Approve"
                >
                  {isProcessing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ThumbsUp className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs text-red-700 border-red-200 hover:bg-red-50"
                  onClick={() => setRejectOpen(true)}
                  disabled={isProcessing}
                  title="Reject"
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        </TableCell>
      </TableRow>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Time Entry</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={`ts-edit-min-${entry.id}`}>
                Minutes *
                {previewMinutes && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    = {previewMinutes}
                  </span>
                )}
              </Label>
              <Input
                id={`ts-edit-min-${entry.id}`}
                type="number"
                min="1"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`ts-edit-notes-${entry.id}`}>Notes</Label>
              <Textarea
                id={`ts-edit-notes-${entry.id}`}
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

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={(open) => { if (!open) setRejectOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject Time Entry</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRejectSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={`ts-reject-${entry.id}`}>
                Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id={`ts-reject-${entry.id}`}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Explain why this entry is being rejected…"
                maxLength={500}
                rows={3}
                required
              />
              <p className="text-xs text-muted-foreground text-right">
                {rejectReason.length}/500
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRejectOpen(false)}
                disabled={isProcessing}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={isProcessing || !rejectReason.trim()}
              >
                {isProcessing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Reject
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
