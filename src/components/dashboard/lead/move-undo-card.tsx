"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Undo2, Pencil, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Lead, LeadList } from "@/types/database";

interface TeamMemberLite {
  user_id: string;
  name?: string | null;
  email: string;
}

interface MoveLog {
  id: string;
  prev_list_id: string | null;
  new_list_id: string | null;
  prev_assigned_to: string | null;
  new_assigned_to: string | null;
}

interface MoveUndoCardProps {
  leadId: string;
  /** owner/admin, or a branch-manager position holder (leadScope === "team") */
  canManage: boolean;
  currentListId: string | null;
  currentAssignedTo: string | null;
  /** Lists the caller may move this lead into (position-side allowlist already applied) */
  assignableLists?: LeadList[];
  /** Full active funnel — used only to resolve list names for display, even outside assignableLists */
  allLists?: LeadList[];
  teamMembers: TeamMemberLite[];
  memberNames: Record<string, string>;
  onUpdated: (lead: Lead) => void;
}

export function MoveUndoCard({
  leadId,
  canManage,
  currentListId,
  currentAssignedTo,
  assignableLists,
  allLists,
  teamMembers,
  memberNames,
  onUpdated,
}: MoveUndoCardProps) {
  const [lastMove, setLastMove] = useState<MoveLog | null>(null);
  const [loading, setLoading] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editListId, setEditListId] = useState<string>("__none__");
  const [editAssignedTo, setEditAssignedTo] = useState<string>("unassigned");
  const [revokePrevious, setRevokePrevious] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchLastMove = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/revert-move`);
      if (res.ok) {
        const json = await res.json();
        setLastMove(json.data?.lastMove ?? null);
      }
    } catch {
      // silently fail — control just won't offer an undo option
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canManage) fetchLastMove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, leadId]);

  if (!canManage) return null;

  const listName = (id: string | null) => {
    if (!id) return "None";
    return allLists?.find((l) => l.id === id)?.name || "Unknown list";
  };
  const memberName = (userId: string | null) => {
    if (!userId) return "Unassigned";
    return memberNames[userId] || "Unknown";
  };

  const handleUndo = async () => {
    setUndoing(true);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/revert-move`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json?.error?.message || "Failed to undo move");
        return;
      }
      const json = await res.json();
      onUpdated(json.data as Lead);
      toast.success("Move undone");
      fetchLastMove();
    } catch {
      toast.error("Failed to undo move");
    } finally {
      setUndoing(false);
    }
  };

  const openEdit = () => {
    setEditListId(currentListId ?? "__none__");
    setEditAssignedTo(currentAssignedTo ?? "unassigned");
    setRevokePrevious(true);
    setEditOpen(true);
  };

  const handleSaveOverride = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        assigned_to: editAssignedTo === "unassigned" ? null : editAssignedTo,
        revoke_previous_assignee: revokePrevious,
      };
      if (assignableLists && assignableLists.length > 0) {
        body.list_id = editListId === "__none__" ? null : editListId;
      }
      const res = await fetch(`/api/v1/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json?.error?.message || "Failed to save changes");
        return;
      }
      const json = await res.json();
      onUpdated(json.data as Lead);
      toast.success("Lead updated");
      setEditOpen(false);
      fetchLastMove();
    } catch {
      toast.error("Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-border rounded-lg bg-card shadow-none p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          Move / Assignment
        </h3>
        <Button variant="ghost" size="sm" onClick={openEdit} className="h-6 px-2">
          <Pencil className="h-3.5 w-3.5 mr-1" />
          Edit
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : lastMove ? (
        <>
          <p className="text-xs text-muted-foreground">
            Last move: {listName(lastMove.prev_list_id)} → {listName(lastMove.new_list_id)}
            {lastMove.new_assigned_to && `, assigned to ${memberName(lastMove.new_assigned_to)}`}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleUndo}
            disabled={undoing}
            className="h-7 text-xs"
          >
            {undoing ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Undo2 className="h-3.5 w-3.5 mr-1.5" />
            )}
            {undoing ? "Undoing…" : "Undo last move"}
          </Button>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">No moves recorded yet.</p>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit list / assignment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {assignableLists && assignableLists.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">List</p>
                <Select value={editListId} onValueChange={setEditListId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select list" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="text-muted-foreground">No list</span>
                    </SelectItem>
                    {assignableLists.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Assignee</p>
              <Select value={editAssignedTo} onValueChange={setEditAssignedTo}>
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {teamMembers.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.name || m.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="revoke-previous-assignee"
                checked={revokePrevious}
                onCheckedChange={(v) => setRevokePrevious(v === true)}
              />
              <label htmlFor="revoke-previous-assignee" className="text-sm cursor-pointer">
                Revoke previous assignee&apos;s access
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSaveOverride} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
