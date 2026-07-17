"use client";

import { useState } from "react";
import { CornerUpRight } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { LeadList } from "@/types/database";
import { moveConfirmMessage } from "@/components/dashboard/leads/move-to-list-selector";

interface StageAssignee {
  user_id: string;
  email: string;
  name?: string | null;
}

interface StageMoveSelectorProps {
  /** The lead's current list id. */
  currentListId: string | null;
  /** Every active (non-archive, non-staging) stage, any direction. */
  activeLists: LeadList[];
  /** Stages the caller may actually move into (server enforces the same via canAccessList).
   *  Options outside this set are hidden so a branch-manager never picks a stage that 403s.
   *  Omit ⇒ no client-side gating (admins/owners access all). */
  accessibleLists?: LeadList[];
  /** Per-stage assignee candidates (branch line-team → branch-manager → tenant-wide fallback). */
  stageAssigneeMap: Record<string, StageAssignee[]>;
  /** Move the lead to a list, optionally with an assignee. */
  onMove: (listId: string, assignToUserId?: string | null) => Promise<void>;
}

/**
 * Admin/branch-manager stage control: one dropdown listing every active stage
 * (forward or backward), coupled to that destination's own assignee picker.
 * Replaces the linear ListStepper for these viewers — see list-stepper.tsx
 * for the chain-member (lead-caller/lead-executive/counselor/application-executive) flow.
 */
export function StageMoveSelector({
  currentListId,
  activeLists,
  accessibleLists,
  stageAssigneeMap,
  onMove,
}: StageMoveSelectorProps) {
  const [confirmList, setConfirmList] = useState<LeadList | null>(null);
  const [selectedAssignee, setSelectedAssignee] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const sortedLists = [...activeLists].sort((a, b) => a.sort_order - b.sort_order);
  const currentList = sortedLists.find((l) => l.id === currentListId) ?? null;

  // Options gated to the caller's accessible stages so a branch-manager can't pick a
  // stage the server (canAccessList) would 403. The current stage always stays visible
  // (shown as the disabled trigger value even if outside the accessible set).
  const accessibleIds = accessibleLists ? new Set(accessibleLists.map((l) => l.id)) : null;
  const optionLists = sortedLists.filter(
    (l) => l.id === currentListId || accessibleIds == null || accessibleIds.has(l.id),
  );

  function handlePick(listId: string) {
    if (listId === currentListId) return;
    const list = sortedLists.find((l) => l.id === listId);
    if (!list) return;
    setSelectedAssignee("");
    setConfirmList(list);
  }

  const pickerMembers = confirmList ? (stageAssigneeMap[confirmList.id] ?? []) : [];
  const showAssigneePicker = pickerMembers.length > 0;

  async function confirmMove() {
    if (!confirmList) return;
    if (showAssigneePicker && !selectedAssignee) return;
    setSaving(true);
    try {
      const assignTo = showAssigneePicker ? (selectedAssignee || null) : undefined;
      await onMove(confirmList.id, assignTo);
      setConfirmList(null);
      setSelectedAssignee("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Select value={currentListId ?? ""} onValueChange={handlePick}>
        <SelectTrigger className="h-8 text-sm">
          <SelectValue placeholder="Select stage">{currentList?.name ?? "—"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {optionLists.map((list) => (
            <SelectItem key={list.id} value={list.id} disabled={list.id === currentListId}>
              {list.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Dialog
        open={!!confirmList}
        onOpenChange={(v) => {
          if (!v && !saving) { setConfirmList(null); setSelectedAssignee(""); }
        }}
      >
        <DialogContent
          className="max-w-md sm:max-w-md"
          overlayClassName="bg-[#0000004d] backdrop-blur-[2px]"
        >
          <DialogHeader>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <CornerUpRight className="h-5 w-5" />
            </div>
            <DialogTitle className="pt-1">
              {confirmList ? moveConfirmMessage(confirmList) : ""}
            </DialogTitle>
            <DialogDescription>
              {selectedAssignee ? (
                <>
                  This lead will move to{" "}
                  <span className="font-medium text-foreground">{confirmList?.name}</span> and be
                  assigned to{" "}
                  <span className="font-medium text-foreground">
                    {(() => {
                      const m = pickerMembers.find((m) => m.user_id === selectedAssignee);
                      return m?.name || m?.email.split("@")[0] || "";
                    })()}
                  </span>
                  .
                </>
              ) : (
                <>
                  This lead will be moved to the{" "}
                  <span className="font-medium text-foreground">{confirmList?.name}</span> list.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {showAssigneePicker && (
            <div className="py-2">
              <p className="text-xs text-muted-foreground mb-1.5">Assign to</p>
              <Select value={selectedAssignee} onValueChange={setSelectedAssignee}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select assignee" />
                </SelectTrigger>
                <SelectContent>
                  {pickerMembers.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-4 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <span className="text-[9px] font-medium text-primary">
                            {(m.name || m.email)[0]?.toUpperCase() ?? "?"}
                          </span>
                        </div>
                        <span>{m.name || m.email.split("@")[0]}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!selectedAssignee && (
                <p className="text-xs text-muted-foreground mt-1">Select an assignee to continue.</p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => { setConfirmList(null); setSelectedAssignee(""); }}>
              Cancel
            </Button>
            <Button
              disabled={saving || (showAssigneePicker && !selectedAssignee)}
              onClick={confirmMove}
            >
              {saving ? "Moving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
