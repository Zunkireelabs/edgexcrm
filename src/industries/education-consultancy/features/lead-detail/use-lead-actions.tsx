"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ApplicationsGateDialog } from "@/components/dashboard/leads/applications-gate-dialog";
import { ProspectQualificationDialog } from "@/components/dashboard/leads/prospect-qualification-dialog";
import { getLeadFullName } from "@/components/dashboard/lead/lead-name";
import { hasProspectQualification } from "@/lib/leads/prospect-qualification";
import { useEduTaxonomy } from "@/hooks/use-edu-taxonomy";
import { useLeadMoves } from "@/components/dashboard/lead/use-lead-moves";
import type { Lead, LeadList } from "@/types/database";
import { readLeadNav, writeLeadNav } from "./lib/lead-nav";
import {
  defaultAssignee, handOffToast, isStepBack, memberName, needsProspectGate, resolveHandOffTarget, revertNote, type MoveDirection,
} from "./lib/move-model";
import { ArchiveDialog, GpaGateDialog, MoveConfirmDialog, QualifyDialog } from "./move-dialogs";

export interface Assignee {
  user_id: string;
  email: string;
  name?: string | null;
}

export interface Person extends Assignee {
  role?: string;
  position_name?: string | null;
}

interface Params {
  lead: Lead;
  userId: string;
  leadLists: LeadList[];
  activeLeadLists: LeadList[];
  bypassQualification: boolean;
  nextPositionMembers: Assignee[];
  revertTargetUserId: string | null;
  revertTargetName: string | null;
  revertTargetMembers: Assignee[];
  stageAssigneeMap: Record<string, Assignee[]>;
  /** Names for the hand-off toast ("sent to <assignee>"), user id → display name. */
  memberNames?: Record<string, string>;
  /** Admin / owner / branch manager: "Move" wording, no chain. */
  canMoveWithoutChain?: boolean;
  /** Where "back to the view" goes when there is no edgex.leadNav context. */
  fallbackHref?: string;
  /** Opens the Student Details pop-up (the same one the page's Edit button used). */
  openStudentDetails: (missing?: string[]) => void;
}

interface Confirm {
  list: LeadList;
  direction: MoveDirection;
  /** %/GPA the gate collected; sent with the move (the confirm can still be cancelled, so nothing saved yet). */
  patch?: Record<string, string>;
}

/**
 * Everything that changes the lead's stage / holder on the detail page, with today's rules kept exactly:
 * the Prospects %/GPA gate, the Applications readiness gate, optimistic updates that roll back with a toast, and a
 * re-read of `assigned_to` after every move (the server may assign on its own). EDGEX-155 puts the Dialogs v1 pop-ups
 * on these handlers: Qualify, the %/GPA gate FIRST then the send / move / revert confirm, and the archive confirm. The
 * move logic itself is the shared `useLeadMoves` (also used by LeadDetailV2).
 */
export function useLeadActions(p: Params) {
  const router = useRouter();
  const { destinations: destOptions, fieldsOfStudy, studyLevels } = useEduTaxonomy();
  const [currentLead, setCurrentLead] = useState<Lead>(p.lead);
  const leadName = getLeadFullName(currentLead, "this lead");

  // `confirm` keeps what the dialog shows while it fades out; `confirmOpen` is what opens / closes it.
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [gate, setGate] = useState<{ list: LeadList; direction: MoveDirection } | null>(null);
  const [assignee, setAssignee] = useState("");
  const [why, setWhy] = useState("");
  const [saving, setSaving] = useState(false);

  // Qualify pop-up
  const [qualifyOpen, setQualifyOpen] = useState(false);
  const [qDests, setQDests] = useState<string[]>([]);
  const [qField, setQField] = useState("");
  const [qDegree, setQDegree] = useState("");
  const [qNote, setQNote] = useState("");
  const [qualifying, setQualifying] = useState(false);

  // Archive confirm
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveOther, setArchiveOther] = useState("");

  const stageId = currentLead.stage_id;
  const assignedTo = currentLead.assigned_to ?? "";
  const allLists = [...p.activeLeadLists, ...p.leadLists];
  const currentList = allLists.find((l) => l.id === currentLead.list_id) ?? null;

  const nameOfUser = useCallback((id: string) => {
    const fromLists = [...p.nextPositionMembers, ...p.revertTargetMembers, ...Object.values(p.stageAssigneeMap).flat()].find((m) => m.user_id === id);
    return p.memberNames?.[id] ?? (fromLists ? memberName(fromLists) : "someone");
  }, [p.memberNames, p.nextPositionMembers, p.revertTargetMembers, p.stageAssigneeMap]);

  // After a hand-off the lead is read-only for this user: open THEIR next lead of the view (or go back to it) and say what happened.
  const onHandOff = useCallback(({ lead: updated, listName }: { lead: Lead; listName: string }) => {
    void (async () => {
      const target = await resolveHandOffTarget(readLeadNav(), p.lead.id, p.fallbackHref ?? "/leads");
      const text = handOffToast(leadName, updated.assigned_to ? nameOfUser(updated.assigned_to) : "someone", listName);
      if (target.nextId) {
        if (target.ctx) writeLeadNav(target.ctx);
        router.push(`/leads/${target.nextId}`);
        // The toast names the next lead once we know its name (the nav context only stores ids).
        let next = "";
        try {
          const r = await fetch(`/api/v1/leads/${target.nextId}`);
          if (r.ok) next = getLeadFullName((await r.json()).data as Lead, "");
        } catch { /* the line is a nicety */ }
        toast.success(text, next ? { description: `Opened your next lead: ${next}` } : undefined);
      } else {
        toast.success(text);
        router.push(target.href);
      }
      router.refresh();
    })();
  }, [leadName, nameOfUser, p.fallbackHref, p.lead.id, router]);

  // The move / assign / gate logic is shared with LeadDetailV2 (one hook, one behaviour).
  const moves = useLeadMoves({
    lead: p.lead, currentLead, setCurrentLead, stageId, setStageId: () => {},
    setAssignedTo: (v) => setCurrentLead((l) => ({ ...l, assigned_to: v || null } as Lead)),
    userId: p.userId, industryId: "education_consultancy", bypassQualification: p.bypassQualification, leadLists: p.leadLists,
    onHandOff,
  });
  const { leaving, gateMissing, setGateMissing, pendingProspectMove, setPendingProspectMove, pendingAssignGate, setPendingAssignGate, performListMove } = moves;
  const requestMove = (listId: string, assignToUserId?: string | null, archive?: string) => moves.requestListChange(listId, archive, assignToUserId);

  const membersFor = useCallback((list: LeadList, direction: MoveDirection): Assignee[] =>
    direction === "next" ? p.nextPositionMembers : direction === "back" ? p.revertTargetMembers : p.stageAssigneeMap[list.id] ?? [],
  [p.nextPositionMembers, p.revertTargetMembers, p.stageAssigneeMap]);

  const openConfirm = useCallback((list: LeadList, direction: MoveDirection, patch?: Record<string, string>) => {
    setAssignee(defaultAssignee(membersFor(list, direction), direction, p.revertTargetUserId));
    setWhy("");
    setConfirm({ list, direction, patch });
    setConfirmOpen(true);
  }, [membersFor, p.revertTargetUserId]);

  /**
   * Start a move. Order matters (flow 2): Applications readiness first, then the %/GPA gate when moving forward into
   * Prospects without a qualifying level, THEN the confirm with the assignee.
   */
  const startMove = useCallback(
    async (list: LeadList, direction: MoveDirection) => {
      if (direction !== "back" && !(await moves.precheckApplications(list.id))) return;
      const stepBack = isStepBack(currentList, list);
      if (direction !== "back" && needsProspectGate({ target: list, stepBack, hasQualification: hasProspectQualification(currentLead as unknown as Record<string, unknown>) })) {
        setGate({ list, direction });
        return;
      }
      openConfirm(list, direction);
    },
    [moves, currentList, currentLead, openConfirm],
  );

  /** The stage card's "Add" next to the %/GPA requirement: the same gate, then straight to the Prospects confirm. */
  const openGate = useCallback(() => {
    const next = [...p.activeLeadLists].sort((a, b) => a.sort_order - b.sort_order).find((l) => l.slug === "prospects");
    if (next) setGate({ list: next, direction: p.canMoveWithoutChain ? "move" : "next" });
  }, [p.activeLeadLists, p.canMoveWithoutChain]);

  const openQualify = useCallback(() => {
    const l = currentLead as { destinations?: string[] | null; field_of_study?: string | null; degree_level?: string | null };
    setQDests(l.destinations ?? []);
    setQField(l.field_of_study ?? "");
    setQDegree(l.degree_level ?? "");
    setQNote("");
    setQualifyOpen(true);
  }, [currentLead]);

  const submitQualify = async () => {
    const qualified = p.leadLists.find((l) => l.slug === "qualified") ?? p.activeLeadLists.find((l) => l.slug === "qualified");
    if (!qualified) { toast.error("Qualified list not found"); return; }
    setQualifying(true);
    try {
      const res = await fetch(`/api/v1/leads/${currentLead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ list_id: qualified.id, destinations: qDests, field_of_study: qField || null, degree_level: qDegree || null }),
      });
      if (!res.ok) throw new Error("Failed to qualify lead");
      setCurrentLead((await res.json()).data as Lead);
      if (qNote.trim()) {
        const noteRes = await fetch(`/api/v1/leads/${currentLead.id}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: qNote.trim() }) });
        if (!noteRes.ok) toast.error((await noteRes.json().catch(() => null))?.error?.message || "Failed to add note");
      }
      toast.success(`Moved to ${qualified.name}`);
      setQualifyOpen(false);
      router.refresh();
    } catch {
      toast.error("Couldn't qualify, try again");
    } finally {
      setQualifying(false);
    }
  };

  /** Optimistic in-place field save: apply now, PATCH, roll back with a toast when it fails. */
  const patchLead = useCallback(
    async (fields: Record<string, unknown>, label = "field", localExtra: Record<string, unknown> = {}): Promise<boolean> => {
      const prev = currentLead;
      setCurrentLead((l) => ({ ...l, ...fields, ...localExtra } as Lead));
      try {
        const res = await fetch(`/api/v1/leads/${currentLead.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
        if (!res.ok) {
          const errJson = await res.json().catch(() => null);
          const first = errJson?.error?.details && Object.values(errJson.error.details as Record<string, string[]>)[0]?.[0];
          throw new Error(first || errJson?.error?.message || `Couldn't save ${label}`);
        }
        const updated = (await res.json()).data as Lead | undefined;
        if (updated) setCurrentLead((l) => ({ ...l, ...updated } as Lead));
        return true;
      } catch (err) {
        setCurrentLead(prev);
        toast.error(err instanceof Error ? err.message : `Couldn't save ${label}`);
        return false;
      }
    },
    [currentLead],
  );

  const submitArchive = async () => {
    const archive = p.leadLists.find((l) => l.is_archive);
    if (!archive) { toast.error("Archive list not found"); return; }
    const reason = archiveReason === "Other" ? archiveOther.trim() || "Other" : archiveReason;
    if (!reason) return;
    setArchiveOpen(false);
    await performListMove(archive.id, reason);
  };

  const restore = async () => {
    try {
      const res = await fetch(`/api/v1/archived-leads/${currentLead.id}/restore`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message || "Couldn't restore the lead");
      toast.success("Lead restored");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't restore the lead");
    }
  };

  const confirmMove = async () => {
    if (!confirm) return;
    const members = membersFor(confirm.list, confirm.direction);
    if (members.length > 0 && !assignee) return;
    setSaving(true);
    try {
      const assignTo = members.length > 0 ? assignee || null : undefined;
      const { list, direction, patch } = confirm;
      const note = direction === "back" ? revertNote(why) : null;
      setConfirmOpen(false);
      if (direction === "back") {
        const ok = await performListMove(list.id, undefined, assignTo);
        // The "Why" becomes a lead note ONLY after the move went through (a failed move must leave no note behind).
        if (ok && note) {
          try {
            const r = await fetch(`/api/v1/leads/${currentLead.id}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: note }) });
            if (!r.ok) throw new Error();
          } catch {
            toast.error("Moved, but the note couldn't be saved");
          }
        }
      } else if (patch) {
        // The gate already collected the %/GPA: send it with the move (requestListChange would ask for it again).
        await performListMove(list.id, undefined, assignTo, patch);
      } else {
        await requestMove(list.id, assignTo);
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmMembers = confirm ? membersFor(confirm.list, confirm.direction) : [];
  const dialogs: ReactNode = (
    <>
      <MoveConfirmDialog
        open={confirmOpen && !!confirm}
        direction={confirm?.direction ?? "move"}
        targetName={confirm?.list.name ?? ""}
        leadName={leadName}
        isBackward={!!confirm && isStepBack(currentList, confirm.list)}
        chainSend={!p.canMoveWithoutChain}
        members={confirmMembers as Person[]}
        assignee={assignee} onAssignee={setAssignee} why={why} onWhy={setWhy}
        fixedHolderName={p.revertTargetName}
        busy={saving}
        onConfirm={() => void confirmMove()} onCancel={() => setConfirmOpen(false)}
      />

      <QualifyDialog
        open={qualifyOpen} onOpenChange={setQualifyOpen} leadName={leadName}
        destinations={qDests} onDestinations={setQDests} course={qField} onCourse={setQField} level={qDegree} onLevel={setQDegree} note={qNote} onNote={setQNote}
        destinationOptions={destOptions} courseOptions={fieldsOfStudy} levelOptions={studyLevels}
        saving={qualifying} onSubmit={() => void submitQualify()}
      />

      <GpaGateDialog
        open={!!gate} lead={currentLead as unknown as Record<string, unknown>} canSkip={p.bypassQualification}
        onSave={(patch) => { if (gate) { const g = gate; setGate(null); openConfirm(g.list, g.direction, patch); } }}
        onSkip={() => { if (gate) { const g = gate; setGate(null); openConfirm(g.list, g.direction); } }}
        onCancel={() => setGate(null)}
      />

      <ArchiveDialog
        open={archiveOpen} leadName={leadName} reason={archiveReason} onReason={setArchiveReason} other={archiveOther} onOther={setArchiveOther}
        onConfirm={() => void submitArchive()} onCancel={() => setArchiveOpen(false)}
      />

      <ApplicationsGateDialog
        missing={gateMissing}
        onClose={() => setGateMissing(null)}
        onEditProfile={gateMissing && gateMissing.some((m) => /^Basic info/i.test(m)) ? () => { const m = gateMissing; setGateMissing(null); p.openStudentDetails(m.filter((x) => /^Basic info/i.test(x))); } : undefined}
      />
      {/* Server-side blocks (someone else changed the lead meanwhile) still open the gate instead of a corner toast. */}
      <ProspectQualificationDialog
        lead={currentLead as unknown as Record<string, unknown>}
        open={!!pendingProspectMove}
        onConfirm={async (patch) => {
          if (!pendingProspectMove) return;
          await performListMove(pendingProspectMove.listId, pendingProspectMove.archiveReason, pendingProspectMove.assignToUserId, patch);
          setPendingProspectMove(null);
        }}
        onCancel={() => setPendingProspectMove(null)}
      />
      <ProspectQualificationDialog lead={currentLead as unknown as Record<string, unknown>} open={!!pendingAssignGate} onConfirm={moves.confirmAssignQualification} onCancel={() => setPendingAssignGate(null)} />
    </>
  );

  return {
    currentLead, setCurrentLead, stageId, assignedTo, leaving,
    startMove, requestMove, openQualify, openGate, changeAssignment: (id: string | null) => moves.handleAssignmentChange(id ?? "unassigned"), patchLead, restore,
    openArchive: () => { setArchiveReason(""); setArchiveOther(""); setArchiveOpen(true); },
    dialogs,
  };
}
