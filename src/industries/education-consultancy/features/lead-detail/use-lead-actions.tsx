"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowBendUpRightIcon, CircleNotchIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DestinationsMultiSelect } from "@/components/dashboard/destinations-multi-select";
import { ApplicationsGateDialog } from "@/components/dashboard/leads/applications-gate-dialog";
import { ProspectQualificationDialog } from "@/components/dashboard/leads/prospect-qualification-dialog";
import { moveConfirmMessage } from "@/components/dashboard/leads/move-to-list-selector";
import { useEduTaxonomy } from "@/hooks/use-edu-taxonomy";
import { hasProspectQualification } from "@/lib/leads/prospect-qualification";
import { moveErrorMessage, isApplicationsGateError, gateMissingItems } from "@/lib/leads/gate-error";
import type { Lead, LeadList } from "@/types/database";

export interface Assignee {
  user_id: string;
  email: string;
  name?: string | null;
}

export interface Person extends Assignee {
  role?: string;
  position_name?: string | null;
}

export const ARCHIVE_REASONS = ["Not interested", "Wrong number", "Not reachable", "Already enrolled elsewhere", "Other"];

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
  /** Opens the Student Details pop-up (the same one the page's Edit button used). */
  openStudentDetails: (missing?: string[]) => void;
}

type ConfirmMove = { list: LeadList; direction: "next" | "back" | "move" } | null;

const nameOf = (m: Assignee) => m.name || m.email.split("@")[0];

/**
 * Everything that changes the lead's stage / holder on the detail page, with today's rules kept exactly:
 * the Prospects %/GPA gate, the Applications readiness gate, optimistic updates that roll back with a toast, and a
 * re-read of `assigned_to` after every move (the server may assign on its own). Phase 1 shows today's pop-ups; the
 * restyled Dialogs v1 versions replace the `dialogs` node in a later phase without touching these handlers.
 */
export function useLeadActions(p: Params) {
  const router = useRouter();
  const { destinations: destOptions, fieldsOfStudy, studyLevels } = useEduTaxonomy();
  const [currentLead, setCurrentLead] = useState<Lead>(p.lead);
  const [leaving, setLeaving] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmMove>(null);
  const [assignee, setAssignee] = useState("");
  const [saving, setSaving] = useState(false);
  const [gateMissing, setGateMissing] = useState<string[] | null>(null);
  const [pendingProspectMove, setPendingProspectMove] = useState<{ listId: string; archiveReason?: string; assignToUserId?: string | null } | null>(null);
  const [pendingAssignGate, setPendingAssignGate] = useState<{ userId: string } | null>(null);

  // Qualify pop-up
  const [qualifyOpen, setQualifyOpen] = useState(false);
  const [qDests, setQDests] = useState<string[]>([]);
  const [qField, setQField] = useState("");
  const [qDegree, setQDegree] = useState("");
  const [qNote, setQNote] = useState("");
  const [qualifying, setQualifying] = useState(false);

  // Archive pop-up
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveOther, setArchiveOther] = useState("");

  const stageId = currentLead.stage_id;
  const assignedTo = currentLead.assigned_to ?? "";

  const performListMove = useCallback(
    async (listId: string, archiveReason?: string, assignToUserId?: string | null, academicPatch?: Record<string, string>) => {
      const prevLead = currentLead;
      const willHandOff = assignToUserId !== undefined && assignToUserId !== null && assignToUserId !== p.userId;
      if (willHandOff) setLeaving(true);
      const targetList = p.leadLists.find((l) => l.id === listId) ?? p.activeLeadLists.find((l) => l.id === listId);
      setCurrentLead((prev) => ({
        ...prev,
        list_id: listId,
        lead_type: targetList?.slug === "prospects" ? "prospect" : "lead",
        archive_reason: archiveReason ?? null,
        ...(assignToUserId !== undefined ? { assigned_to: assignToUserId } : {}),
        ...(academicPatch ?? {}),
      } as Lead));
      let gateBlocked: string[] | null = null;
      try {
        const body: Record<string, unknown> = { list_id: listId, archive_reason: archiveReason ?? null, ...(academicPatch ?? {}) };
        if (assignToUserId !== undefined) body.assigned_to = assignToUserId;
        const res = await fetch(`/api/v1/leads/${currentLead.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!res.ok) {
          const errJson = await res.json().catch(() => null);
          const msg = moveErrorMessage(errJson, "Failed to move lead");
          if (isApplicationsGateError(errJson)) {
            const items = gateMissingItems(errJson);
            if (items.length > 0) gateBlocked = items;
          }
          throw new Error(msg);
        }
        const updated = ((await res.json()).data ?? {}) as Lead;
        // The server resets stage_id to the new list's default and may re-assign (stage-transition governance): re-read both.
        setCurrentLead((prev) => ({ ...prev, stage_id: updated.stage_id, status: updated.status, assigned_to: updated.assigned_to } as Lead));
        if (updated.assigned_to !== prevLead.assigned_to) router.refresh();
        toast.success(`Moved to ${targetList?.name ?? "list"}`);
        if (updated.assigned_to && updated.assigned_to !== p.userId) {
          // Handed to someone else: the lead is read-only for this user now. Go back to where it came from.
          router.back();
          router.refresh();
          return;
        }
        if (willHandOff) setLeaving(false);
        router.refresh();
      } catch (err) {
        setCurrentLead(prevLead);
        setLeaving(false);
        if (gateBlocked) setGateMissing(gateBlocked);
        else toast.error(err instanceof Error ? err.message : "Failed to move lead");
      }
    },
    [currentLead, p.activeLeadLists, p.leadLists, p.userId, router],
  );

  /** Move gate: Prospects needs a qualifying %/GPA unless the viewer may bypass it or the move is backwards. */
  const requestMove = useCallback(
    async (listId: string, assignToUserId?: string | null, archive?: string) => {
      const target = p.leadLists.find((l) => l.id === listId) ?? p.activeLeadLists.find((l) => l.id === listId);
      const from = p.activeLeadLists.find((l) => l.id === currentLead.list_id);
      const isBackward = !!from && !!target && target.sort_order < from.sort_order;
      if (!p.bypassQualification && !isBackward && target?.slug === "prospects" && !hasProspectQualification(currentLead as unknown as Record<string, unknown>)) {
        setPendingProspectMove({ listId, archiveReason: archive, assignToUserId });
        return;
      }
      await performListMove(listId, archive, assignToUserId);
    },
    [currentLead, p.activeLeadLists, p.bypassQualification, p.leadLists, performListMove],
  );

  /** Applications pre-check (same rule the server enforces): shows the pop-up straight away when something is missing. */
  const precheckApplications = useCallback(
    async (list: LeadList): Promise<boolean> => {
      if (list.slug !== "applications") return true;
      try {
        const res = await fetch(`/api/v1/leads/${currentLead.id}/applications-readiness`);
        if (!res.ok) return true;
        const json = (await res.json()) as { data?: { ready?: boolean; missing?: string[] } };
        if (json.data && json.data.ready === false && (json.data.missing?.length ?? 0) > 0) {
          setGateMissing(json.data.missing!);
          return false;
        }
      } catch {
        /* the move re-checks on the server */
      }
      return true;
    },
    [currentLead.id],
  );

  const startMove = useCallback(
    async (list: LeadList, direction: "next" | "back" | "move") => {
      if (direction !== "back" && !(await precheckApplications(list))) return;
      const members = direction === "next" ? p.nextPositionMembers : direction === "back" ? p.revertTargetMembers : p.stageAssigneeMap[list.id] ?? [];
      setAssignee(direction === "back" ? p.revertTargetUserId ?? "" : members.length === 1 ? members[0].user_id : "");
      setConfirm({ list, direction });
    },
    [p.nextPositionMembers, p.revertTargetMembers, p.revertTargetUserId, p.stageAssigneeMap, precheckApplications],
  );

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
      toast.error("Failed to qualify lead");
    } finally {
      setQualifying(false);
    }
  };

  /** Counsellor change. The server rejects an assignment that would push an unqualified lead into Prospects → fill-in pop-up. */
  const changeAssignment = useCallback(
    async (userIdOrNull: string | null) => {
      const prev = currentLead.assigned_to;
      setCurrentLead((l) => ({ ...l, assigned_to: userIdOrNull } as Lead));
      try {
        const res = await fetch(`/api/v1/leads/${currentLead.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assigned_to: userIdOrNull }) });
        if (!res.ok) {
          const errJson = await res.json().catch(() => null);
          const academicMsg = errJson?.error?.details?.academic?.[0] as string | undefined;
          if (academicMsg && userIdOrNull) {
            setCurrentLead((l) => ({ ...l, assigned_to: prev } as Lead));
            toast.error(academicMsg);
            setPendingAssignGate({ userId: userIdOrNull });
            return;
          }
          throw new Error(errJson?.error?.message);
        }
        toast.success("Assignment updated");
        router.refresh();
      } catch {
        toast.error("Failed to update assignment");
        setCurrentLead((l) => ({ ...l, assigned_to: prev } as Lead));
      }
    },
    [currentLead.assigned_to, currentLead.id, router],
  );

  const confirmAssignQualification = async (patch: Record<string, string>) => {
    if (!pendingAssignGate) return;
    try {
      const res = await fetch(`/api/v1/leads/${currentLead.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assigned_to: pendingAssignGate.userId, ...patch }) });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message || "Failed to update assignment");
      setCurrentLead((await res.json()).data as Lead);
      toast.success("Assignment updated");
      setPendingAssignGate(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update assignment");
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
    const members = confirm.direction === "next" ? p.nextPositionMembers : confirm.direction === "back" ? p.revertTargetMembers : p.stageAssigneeMap[confirm.list.id] ?? [];
    if (members.length > 0 && !assignee) return;
    setSaving(true);
    try {
      const assignTo = members.length > 0 ? assignee || null : undefined;
      const listId = confirm.list.id;
      setConfirm(null);
      if (confirm.direction === "back") await performListMove(listId, undefined, assignTo);
      else await requestMove(listId, assignTo);
    } finally {
      setSaving(false);
    }
  };

  const members = confirm ? (confirm.direction === "next" ? p.nextPositionMembers : confirm.direction === "back" ? p.revertTargetMembers : p.stageAssigneeMap[confirm.list.id] ?? []) : [];
  const dialogs: ReactNode = (
    <>
      <Dialog open={!!confirm} onOpenChange={(v) => { if (!v && !saving) setConfirm(null); }}>
        <DialogContent className="max-w-md sm:max-w-md" overlayClassName="bg-[#0000004d] backdrop-blur-[2px]">
          <DialogHeader>
            <div className="flex size-10 items-center justify-center rounded-full bg-blue-50 text-blue-600"><ArrowBendUpRightIcon className="size-5" /></div>
            <DialogTitle className="pt-1">{confirm ? (confirm.direction === "back" ? `Revert to ${confirm.list.name}` : moveConfirmMessage(confirm.list)) : ""}</DialogTitle>
            <DialogDescription>
              {confirm?.direction === "back" ? (
                <>This lead will move back to <span className="font-medium text-foreground">{confirm.list.name}</span>.{members.length === 0 && p.revertTargetName ? <> Reassigned to <span className="font-medium text-foreground">{p.revertTargetName}</span>.</> : null}</>
              ) : (
                <>This lead will move to <span className="font-medium text-foreground">{confirm?.list.name}</span>.</>
              )}
            </DialogDescription>
          </DialogHeader>
          {members.length > 0 && (
            <div className="py-2">
              <p className="mb-1.5 text-xs text-muted-foreground">Assign to</p>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select assignee" /></SelectTrigger>
                <SelectContent>{members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{nameOf(m)}</SelectItem>)}</SelectContent>
              </Select>
              {!assignee && <p className="mt-1 text-xs text-muted-foreground">Select an assignee to continue.</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setConfirm(null)}>Cancel</Button>
            <Button disabled={saving || (members.length > 0 && !assignee)} onClick={confirmMove}>{saving ? "Moving…" : "Confirm"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={qualifyOpen} onOpenChange={setQualifyOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Qualify Lead</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <DestinationsMultiSelect selected={qDests} onChange={setQDests} options={destOptions} label="Interested Destinations" optional={false} />
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Field of Study</p>
              <Select value={qField || "__none__"} onValueChange={(v) => setQField(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Select field" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__"><span className="text-muted-foreground">Not specified</span></SelectItem>
                  {fieldsOfStudy.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Degree Level</p>
              <Select value={qDegree || "__none__"} onValueChange={(v) => setQDegree(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Select level" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__"><span className="text-muted-foreground">Not specified</span></SelectItem>
                  {studyLevels.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Note <span className="font-normal text-muted-foreground">(optional)</span></p>
              <textarea value={qNote} onChange={(e) => setQNote(e.target.value)} placeholder="Add a note about this qualification…" rows={3} className="w-full resize-none rounded-[8px] border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            {qDests.length === 0 && !qField && <p className="text-xs text-muted-foreground">Needed: at least one study country or a course.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQualifyOpen(false)} disabled={qualifying}>Cancel</Button>
            <Button onClick={submitQualify} disabled={qualifying || (qDests.length === 0 && !qField)}>
              {qualifying ? <><CircleNotchIcon className="mr-2 size-4 animate-spin" />Qualifying…</> : "Qualify →"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Archive this lead</DialogTitle><DialogDescription>Pick why. The lead moves to the archive and can be restored.</DialogDescription></DialogHeader>
          <div className="space-y-1">
            {ARCHIVE_REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setArchiveReason(r)} className={`w-full rounded-[8px] px-2 py-1.5 text-left text-sm ${archiveReason === r ? "bg-blue-50 font-medium text-blue-800" : "hover:bg-muted"}`}>{r}</button>
            ))}
            {archiveReason === "Other" && <textarea value={archiveOther} onChange={(e) => setArchiveOther(e.target.value)} placeholder="Describe the reason…" className="mt-1 h-16 w-full resize-none rounded-[8px] border p-2 text-sm" />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveOpen(false)}>Cancel</Button>
            <Button disabled={!archiveReason} onClick={submitArchive}>Archive</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ApplicationsGateDialog
        missing={gateMissing}
        onClose={() => setGateMissing(null)}
        onEditProfile={gateMissing && gateMissing.some((m) => /^Basic info/i.test(m)) ? () => { const m = gateMissing; setGateMissing(null); p.openStudentDetails(m.filter((x) => /^Basic info/i.test(x))); } : undefined}
      />
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
      <ProspectQualificationDialog lead={currentLead as unknown as Record<string, unknown>} open={!!pendingAssignGate} onConfirm={confirmAssignQualification} onCancel={() => setPendingAssignGate(null)} />
    </>
  );

  return {
    currentLead, setCurrentLead, stageId, assignedTo, leaving,
    startMove, requestMove, openQualify, changeAssignment, patchLead, restore,
    openArchive: () => { setArchiveReason(""); setArchiveOther(""); setArchiveOpen(true); },
    dialogs,
  };
}
