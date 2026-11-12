"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { moveErrorMessage, isApplicationsGateError, gateMissingItems } from "@/lib/leads/gate-error";
import { hasProspectQualification } from "@/lib/leads/prospect-qualification";
import type { Lead, LeadList } from "@/types/database";

/**
 * The stage / holder logic shared by both lead detail pages (LeadDetailV2 and the education LeadDetailEdu):
 * list moves with optimistic update + rollback, the Prospects %/GPA gate, the Applications readiness gate, the
 * assign-a-counsellor gate, and the re-read of `assigned_to` after every move (the server may assign on its own).
 * Dialog markup stays per page; this owns only the logic and the state the dialogs read.
 */
export interface UseLeadMovesParams {
  /** The lead as the page first received it (rollback reference for assignment). */
  lead: Lead;
  currentLead: Lead;
  setCurrentLead: React.Dispatch<React.SetStateAction<Lead>>;
  stageId: string | null;
  setStageId: (id: string | null) => void;
  setAssignedTo: (id: string) => void;
  userId: string;
  industryId: string | null | undefined;
  bypassQualification: boolean;
  leadLists?: LeadList[];
}

export function useLeadMoves({
  lead, currentLead, setCurrentLead, stageId, setStageId, setAssignedTo, userId, industryId, bypassQualification, leadLists,
}: UseLeadMovesParams) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  // Move-into-Prospects gate: when the target list requires a qualifying %/GPA the lead
  // doesn't have yet, the move is deferred until this fill-in dialog is confirmed.
  const [pendingProspectMove, setPendingProspectMove] = useState<{
    listId: string;
    archiveReason?: string;
    assignToUserId?: string | null;
  } | null>(null);

  // Assign-a-counselor gate (§6b hard-block): the server now rejects assigning a
  // counselor when that assignment would auto-promote an unqualified lead into
  // Prospects. Deferred until this fill-in dialog is confirmed.
  const [pendingAssignGate, setPendingAssignGate] = useState<{ userId: string } | null>(null);

  // Move into Applications blocked by the readiness gate → shown as a pop-up (not a corner toast).
  const [gateMissing, setGateMissing] = useState<string[] | null>(null);

  // "Send to next" into Applications: ask the server (same rule as the move) BEFORE the confirm step, and
  // show the pop-up straight away if something is missing. If the check itself fails we let the user
  // carry on — the move re-checks on the server anyway.
  async function precheckApplications(nextListId: string): Promise<boolean> {
    const target = leadLists?.find((l) => l.id === nextListId);
    if (target?.slug !== "applications") return true;
    try {
      const res = await fetch(`/api/v1/leads/${currentLead.id}/applications-readiness`);
      if (!res.ok) return true;
      const json = (await res.json()) as { data?: { ready?: boolean; missing?: string[] } };
      if (json.data && json.data.ready === false && (json.data.missing?.length ?? 0) > 0) {
        setGateMissing(json.data.missing!);
        return false;
      }
    } catch {
      /* network hiccup — the move itself is still gated server-side */
    }
    return true;
  }

  async function performListMove(
    listId: string,
    archiveReason?: string,
    assignToUserId?: string | null,
    academicPatch?: Record<string, string>
  ) {
    const prevLead = currentLead;
    const prevStageId = stageId;
    const willHandOff =
      assignToUserId !== undefined && assignToUserId !== null && assignToUserId !== userId;
    if (willHandOff) setLeaving(true);
    const targetList = leadLists?.find((l) => l.id === listId);
    const newLeadType = targetList?.slug === "prospects" ? "prospect" : "lead";
    setCurrentLead((prev) => ({
      ...prev,
      list_id: listId,
      lead_type: newLeadType,
      archive_reason: archiveReason ?? null,
      ...(assignToUserId !== undefined ? { assigned_to: assignToUserId } : {}),
      ...(academicPatch ?? {}),
    } as Lead));
    if (assignToUserId !== undefined) setAssignedTo(assignToUserId ?? "");
    let gateBlocked: string[] | null = null;
    try {
      const body: Record<string, unknown> = {
        list_id: listId,
        archive_reason: archiveReason ?? null,
        ...(academicPatch ?? {}),
      };
      if (assignToUserId !== undefined) body.assigned_to = assignToUserId;
      const res = await fetch(`/api/v1/leads/${currentLead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        const msg = moveErrorMessage(errJson, "Failed to move lead");
        if (isApplicationsGateError(errJson)) {
          const items = gateMissingItems(errJson);
          if (items.length > 0) {
            gateBlocked = items;
          }
        }
        throw new Error(msg);
      }
      const json = await res.json();
      const updated = json.data as Lead;
      // Sync stage_id — server resets it to default for new list's pipeline (or null if no pipeline)
      if (updated.stage_id !== stageId) {
        setStageId(updated.stage_id);
        setCurrentLead((prev) => ({ ...prev, stage_id: updated.stage_id, status: updated.status } as Lead));
      }
      // Server may derive a reassignment on revert (stage-transition governance)
      // even when the client didn't pass assigned_to — sync it back.
      if (updated.assigned_to !== prevLead.assigned_to) {
        setAssignedTo(updated.assigned_to ?? "");
        setCurrentLead((prev) => ({ ...prev, assigned_to: updated.assigned_to } as Lead));
        router.refresh();
      }
      toast.success(`Moved to ${targetList?.name ?? "list"}`);
      // Handed off to someone else (send-to-next / revert to another holder):
      // the lead leaves this user's control and is now read-only for them, so
      // close the detail and return to the list it moved out of.
      if (updated.assigned_to && updated.assigned_to !== userId) {
        router.back();
        router.refresh();
        return;
      }
      // Predicted a handoff (spinner shown) but the server kept the lead
      // with us — restore the detail instead of hanging on the spinner.
      if (willHandOff) setLeaving(false);
    } catch (err) {
      setCurrentLead(prevLead);
      setStageId(prevStageId);
      if (assignToUserId !== undefined) setAssignedTo(prevLead.assigned_to ?? "");
      setLeaving(false);
      if (gateBlocked) setGateMissing(gateBlocked);
      else toast.error(err instanceof Error ? err.message : "Failed to move lead");
    }
  }

  /** The page's `onListChange`: applies the Prospects %/GPA gate, then moves. */
  async function requestListChange(listId: string, archiveReason?: string, assignToUserId?: string | null) {
    const targetList = leadLists?.find((l) => l.id === listId);
    // Backward move (revert) — the lead already passed Prospects, so skip the gate.
    const fromList = leadLists?.find((l) => l.id === currentLead.list_id);
    const isBackward =
      !!fromList && !fromList.is_archive && !fromList.is_staging && !!targetList &&
      targetList.sort_order < fromList.sort_order;
    if (
      industryId === "education_consultancy" &&
      !bypassQualification &&
      !isBackward &&
      targetList?.slug === "prospects" &&
      !hasProspectQualification(currentLead as unknown as Record<string, unknown>)
    ) {
      setPendingProspectMove({ listId, archiveReason, assignToUserId });
      return;
    }
    await performListMove(listId, archiveReason, assignToUserId);
  }

  const handleAssignmentChange = async (newUserId: string) => {
    const value = newUserId === "unassigned" ? null : newUserId;
    setAssignedTo(value || "");

    try {
      const res = await fetch(`/api/v1/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigned_to: value }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        const academicMsg = errJson?.error?.details?.academic?.[0] as string | undefined;
        if (academicMsg && value) {
          setAssignedTo(lead.assigned_to || "");
          toast.error(academicMsg);
          setPendingAssignGate({ userId: value });
          return;
        }
        throw new Error(errJson?.error?.message);
      }
      toast.success("Assignment updated");
      // revertTargetUserId/Name are computed server-side from the lead's
      // assignment history — refresh so the Revert confirm dialog reflects
      // the new assignee, not whoever it was when the page first loaded.
      router.refresh();
    } catch {
      toast.error("Failed to update assignment");
      setAssignedTo(lead.assigned_to || "");
    }
  };

  async function confirmAssignQualification(patch: Record<string, string>) {
    if (!pendingAssignGate) return;
    try {
      const res = await fetch(`/api/v1/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigned_to: pendingAssignGate.userId, ...patch }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error?.message || "Failed to update assignment");
      }
      const json = await res.json();
      setCurrentLead(json.data as Lead);
      setAssignedTo(pendingAssignGate.userId);
      toast.success("Assignment updated");
      setPendingAssignGate(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update assignment");
    }
  }

  return {
    leaving, setLeaving,
    gateMissing, setGateMissing,
    pendingProspectMove, setPendingProspectMove,
    pendingAssignGate, setPendingAssignGate,
    precheckApplications, performListMove, requestListChange, handleAssignmentChange, confirmAssignQualification,
  };
}
