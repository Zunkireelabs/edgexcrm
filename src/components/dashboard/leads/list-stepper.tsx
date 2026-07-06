"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, CornerUpRight } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LeadList } from "@/types/database";
import { moveConfirmMessage } from "@/components/dashboard/leads/move-to-list-selector";

interface NextPositionMember {
  user_id: string;
  email: string;
  name?: string | null;
}

interface ListStepperProps {
  /** The lead's current list id. */
  currentListId: string | null;
  /** Full active funnel (non-archive, non-staging) — used to compute true neighbours + their names. */
  activeLists: LeadList[];
  /** Lists the caller's position is allowed to move into (gates each direction). */
  accessibleLists: LeadList[];
  industryId?: string | null;
  /** Move the lead to a list, optionally with an assignee. */
  onMove: (listId: string, assignToUserId?: string | null) => Promise<void>;
  /** Opens the dedicated Qualify dialog for the intake → Qualified step (education only). */
  onQualify?: () => void;
  /** Next-position members to assign when sending to next stage. Empty = no picker shown. */
  nextPositionMembers?: NextPositionMember[];
}

/**
 * Linear list-progression control that replaces the free "move to any list"
 * dropdown on the lead detail card. Three parts:
 *   [ ← revert ]  [ current list ]  [ send to next → ]
 * Direction buttons are enabled only when the destination list is in the
 * caller's accessible lists (server enforces this too in PATCH /leads/[id]).
 * Hovering a direction button shows the destination list's name.
 */
export function ListStepper({
  currentListId,
  activeLists,
  accessibleLists,
  industryId,
  onMove,
  onQualify,
  nextPositionMembers = [],
}: ListStepperProps) {
  const [confirmList, setConfirmList] = useState<LeadList | null>(null);
  const [isNextDirection, setIsNextDirection] = useState(false);
  const [selectedAssignee, setSelectedAssignee] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const chain = [...activeLists].sort((a, b) => a.sort_order - b.sort_order);
  const idx = chain.findIndex((l) => l.id === currentListId);
  const currentList =
    (idx >= 0 ? chain[idx] : null) ??
    accessibleLists.find((l) => l.id === currentListId) ??
    null;

  const prevList = idx > 0 ? chain[idx - 1] : null;
  const nextList = idx >= 0 && idx < chain.length - 1 ? chain[idx + 1] : null;

  const accessibleIds = new Set(accessibleLists.map((l) => l.id));
  const canPrev = !!prevList && accessibleIds.has(prevList.id);
  const canNext = !!nextList && accessibleIds.has(nextList.id);

  // The intake → Qualified step keeps its dedicated Qualify dialog (education only).
  const isQualifyStep =
    !!nextList &&
    !!currentList &&
    currentList.is_intake &&
    nextList.slug === "qualified" &&
    industryId === "education_consultancy" &&
    !!onQualify;

  function handleNext() {
    if (!nextList || !canNext) return;
    if (isQualifyStep) {
      onQualify?.();
      return;
    }
    setIsNextDirection(true);
    setSelectedAssignee("");
    setConfirmList(nextList);
  }

  function handlePrev() {
    if (!prevList || !canPrev) return;
    setIsNextDirection(false);
    setSelectedAssignee("");
    setConfirmList(prevList);
  }

  async function confirmMove() {
    if (!confirmList) return;
    setSaving(true);
    try {
      const assignTo = isNextDirection && nextPositionMembers.length > 0
        ? (selectedAssignee || null)
        : undefined;
      await onMove(confirmList.id, assignTo);
      setConfirmList(null);
      setSelectedAssignee("");
    } finally {
      setSaving(false);
    }
  }

  const stepBtn =
    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap transition-colors shrink-0";

  return (
    <>
      <TooltipProvider delayDuration={150}>
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Revert */}
          {prevList && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-disabled={!canPrev}
                  aria-label={`Revert to ${prevList.name}`}
                  onClick={handlePrev}
                  className={cn(
                    stepBtn,
                    canPrev
                      ? "bg-gray-100 text-gray-600 hover:bg-gray-200 cursor-pointer"
                      : "bg-gray-50 text-gray-300 cursor-not-allowed"
                  )}
                >
                  <ArrowLeft className="w-3 h-3" />
                  Revert
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {canPrev ? prevList.name : `No access to ${prevList.name}`}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Current list (display only) */}
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap bg-blue-50 text-blue-700">
            {currentList?.name ?? "—"}
          </span>

          {/* Send to next */}
          {nextList && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-disabled={!canNext}
                  aria-label={`Send to ${nextList.name}`}
                  onClick={handleNext}
                  className={cn(
                    stepBtn,
                    canNext
                      ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 cursor-pointer"
                      : "bg-gray-50 text-gray-300 cursor-not-allowed"
                  )}
                >
                  Send to next
                  <ArrowRight className="w-3 h-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {canNext ? nextList.name : `No access to ${nextList.name}`}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </TooltipProvider>

      {/* Confirm dialog */}
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
              This lead will be moved to the{" "}
              <span className="font-medium text-foreground">{confirmList?.name}</span> list.
            </DialogDescription>
          </DialogHeader>

          {/* Assignee picker — only shown when sending forward and next-position members exist */}
          {isNextDirection && nextPositionMembers.length > 0 && (
            <div className="py-2">
              <p className="text-xs text-muted-foreground mb-1.5">Assign to</p>
              <Select value={selectedAssignee} onValueChange={setSelectedAssignee}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select assignee (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {nextPositionMembers.map((m) => (
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
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => { setConfirmList(null); setSelectedAssignee(""); }}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={confirmMove}>
              {saving ? "Moving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
