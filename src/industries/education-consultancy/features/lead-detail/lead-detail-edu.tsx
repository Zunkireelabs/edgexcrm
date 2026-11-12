"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CaretDownIcon, CaretUpIcon, CircleNotchIcon, PencilSimpleIcon, ArrowLeftIcon, XIcon } from "@/components/icons";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useLeadBackDestination } from "@/hooks/use-lead-back-destination";
import { getLeadFullName } from "@/components/dashboard/lead/lead-name";
import { DialogKeyHint } from "@/components/ui/dialog";
import { MergeDialog } from "@/components/dashboard/lead/merge-dialog";
import { PersonalDetailsDialog } from "@/industries/education-consultancy/features/student-record/components/personal-details-dialog";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { resolveThresholds } from "@/industries/education-consultancy/features/team-performance/lib/thresholds";
import { LeadCheckInDialog, type CheckInTriage } from "@/industries/_shared/features/check-in/lead-check-in";
import type { SearchableOption } from "@/components/ui/searchable-select";
import { canEditLeadWorkingData } from "@/lib/leads/lead-edit-scope";
import { isOwnerOrAdmin } from "@/lib/roles";
import type { Lead, LeadChecklist, LeadList, LeadNote, PipelineStage, Tenant } from "@/types/database";
import type { LeadActivity } from "@/lib/supabase/queries";
import type { LeadSubmissionSnapshot } from "@/lib/leads/submission-history";
import { NavButton } from "../record-preview/record-preview";
import { shouldHandleNavKey } from "../record-preview/lib/nav";
import { LeftColumn, MoreMenu } from "./left-column";
import { restoreOrigin, rememberOrigin } from "./focus-origin";
import { MiddleColumn, type MiddleColumnHandle } from "./middle-column";
import { useLeadActions, type Assignee, type Person } from "./use-lead-actions";
import { useLeadFile } from "./lead-file";
import { RightRail } from "./right-rail";
import { fetchAdjacentLeadId, readLeadNav, resolveLeadNav, writeLeadNav, type LeadNavContext } from "./lib/lead-nav";

interface TeamMember extends Person {
  id: string;
  role: string;
}

export interface LeadDetailEduProps {
  lead: Lead;
  memberNames?: Record<string, string>;
  notes: LeadNote[];
  checklists: LeadChecklist[];
  activities: LeadActivity[];
  submissionHistory?: LeadSubmissionSnapshot[];
  stages: PipelineStage[];
  tenant: Tenant;
  role: string;
  userId: string;
  leadScope?: "all" | "own" | "team";
  bypassQualification?: boolean;
  canAssign?: boolean;
  canEditLeads?: boolean;
  assignableMembers?: TeamMember[];
  stageScopedAssignees?: Assignee[] | null;
  nextPositionMembers?: TeamMember[];
  revertTargetUserId?: string | null;
  revertTargetName?: string | null;
  revertTargetMembers?: Assignee[];
  canMoveWithoutChain?: boolean;
  stageAssigneeMap?: Record<string, Assignee[]>;
  canManageApplications?: boolean;
  canManageApplicationPanel?: boolean;
  canEnroll?: boolean;
  leadLists?: LeadList[];
  activeLeadLists?: LeadList[];
  classesActive?: boolean;
  applicationsActive?: boolean;
  checkInActive?: boolean;
  documentsActive?: boolean;
  consentEnabled?: boolean;
  consentSigned?: boolean;
  projectBoardEnabled?: boolean;
  /** AI_ASSISTANT_ENABLED env flag AND tenants.ai_enabled (computed by the page shell). Hides the Orca brief when false. */
  aiEnabled?: boolean;
  /** Follow-up staleness for the Last touch highlight; defaults to the tenant-config default. */
  followUpStaleDays?: number;
}

/**
 * The education lead detail (EDGEX-89). Frame: 48px header strip (back, prev/next, counter, Edit profile, ···) over
 * three columns: left 320 (identity, stage, details), middle (today's tabs, restyled in the next phase), right rail 280
 * from 1280px wide. Legacy industries keep LeadDetailV2; the route shell picks which one renders.
 */
export function LeadDetailEdu(props: LeadDetailEduProps) {
  const {
    memberNames = {}, notes: initialNotes, checklists: initialChecklists, activities, submissionHistory, stages, tenant, role, userId,
    leadScope, bypassQualification = false, canAssign = false, canEditLeads = false, assignableMembers = [], stageScopedAssignees = null,
    nextPositionMembers = [], revertTargetUserId = null, revertTargetName = null, revertTargetMembers = [], canMoveWithoutChain = false,
    stageAssigneeMap = {}, canManageApplications, canManageApplicationPanel, canEnroll, leadLists = [], activeLeadLists = [],
    classesActive, applicationsActive, checkInActive, documentsActive, consentEnabled = false, consentSigned = false, projectBoardEnabled,
    aiEnabled = false, followUpStaleDays = resolveThresholds(null).followUpStaleDays,
  } = props;
  const router = useRouter();
  const searchParams = useSearchParams();
  const backDestination = useLeadBackDestination();
  const middleRef = useRef<MiddleColumnHandle>(null);
  const mainRef = useRef<{ enabled: boolean; run: () => void } | null>(null);

  // Student Details pop-up (edit mode). Hosted here since the tab row no longer owns it.
  const studentRecordActive = getFeatureAccess(tenant.industry_id, FEATURES.STUDENT_RECORD);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsKey, setDetailsKey] = useState(0);
  const [missingBeforeApplications, setMissingBeforeApplications] = useState<string[]>([]);
  const openStudentDetails = useCallback((missing?: string[]) => {
    if (!studentRecordActive) return false;
    rememberOrigin();
    setMissingBeforeApplications(missing ?? []);
    setDetailsKey((k) => k + 1);
    setDetailsOpen(true);
    return true;
  }, [studentRecordActive]);
  const actions = useLeadActions({
    lead: props.lead, userId, leadLists, activeLeadLists, bypassQualification, nextPositionMembers, revertTargetUserId, revertTargetName,
    revertTargetMembers, stageAssigneeMap, openStudentDetails, memberNames, canMoveWithoutChain, fallbackHref: backDestination.href,
  });
  const lead = actions.currentLead;

  const [notes, setNotes] = useState(initialNotes);
  const [checklists, setChecklists] = useState(initialChecklists);
  const [consentSignedState, setConsentSignedState] = useState(consentSigned);
  useEffect(() => { setConsentSignedState(consentSigned); }, [consentSigned]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isAdmin = isOwnerOrAdmin(role);
  const canEdit = isAdmin || canEditLeads;
  const canManageNotes = canEditLeadWorkingData({ isAdmin, leadScope, isOwnScopeEditor: userId === lead.assigned_to });
  const name = getLeadFullName(lead, "Unnamed lead");

  // The student file (EDGEX-154): one state per feature, read by the rail, the matching tab and the stage card.
  const consentActive = !!applicationsActive && consentEnabled;
  const file = useLeadFile({
    lead, initialLead: props.lead, tenantId: tenant.id, leadName: name,
    applicationsActive: !!applicationsActive, consentEnabled, consentSigned: consentSignedState, classesActive: !!classesActive,
    documentsActive: !!documentsActive, checkInActive: !!checkInActive, isAdmin, canManageApplications: canManageApplications ?? isAdmin,
    onConsentSignedChange: setConsentSignedState,
    onFeeSaved: (patch) => actions.setCurrentLead((prev) => ({ ...prev, ...patch } as Lead)),
  });

  // Roster for the collaborator picker + the Activity feed's names (admins / assigners only; others never open the picker).
  const [roster, setRoster] = useState<TeamMember[]>([]);
  useEffect(() => {
    if (!isAdmin && !canAssign) return;
    fetch("/api/v1/team").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) setRoster(j.data || []); }).catch(() => {});
  }, [isAdmin, canAssign]);
  const teamMemberEmails = useMemo(() => roster.reduce<Record<string, string>>((a, m) => { a[m.user_id] = m.email; return a; }, {}), [roster]);
  const teamMemberNames = useMemo(() => roster.reduce<Record<string, string>>((a, m) => { if (m.name) a[m.user_id] = m.name; return a; }, { ...memberNames }), [roster, memberNames]);

  // ── Check-in dialog (EDGEX-154): records a visit via POST /leads/:id/check-in; Assign / Move are the education triage ──
  const [minimalRoster, setMinimalRoster] = useState<{ user_id: string; name: string }[] | null>(null);
  const checkInOpen = file.checkIns.dialogOpen;
  useEffect(() => {
    if (!checkInOpen || minimalRoster) return;
    fetch("/api/v1/team?minimal=1").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) setMinimalRoster(j.data || []); }).catch(() => {});
  }, [checkInOpen, minimalRoster]);
  const meetWithOptions = useMemo<SearchableOption[]>(() => {
    const byId = new Map<string, string>(Object.entries(teamMemberNames));
    for (const m of minimalRoster ?? []) byId.set(m.user_id, m.name);
    return [...byId].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [teamMemberNames, minimalRoster]);
  const checkInTriage = useMemo<CheckInTriage>(() => {
    const opt = (m: TeamMember): SearchableOption => ({ value: m.user_id, label: m.name || m.email.split("@")[0], secondary: m.position_name ?? undefined });
    const isLeadExec = (m: TeamMember) => /lead\s*exec/i.test(m.position_name ?? "");
    const isCounsellor = (m: TeamMember) => /counsel+or/i.test(m.position_name ?? "");
    const list = [...activeLeadLists, ...leadLists].find((l) => l.id === lead.list_id);
    return {
      currentSlug: list?.slug ?? null,
      leadExecs: roster.filter(isLeadExec).map(opt),
      counselors: roster.filter(isCounsellor).map(opt),
      holderName: lead.assigned_to ? teamMemberNames[lead.assigned_to] ?? null : null,
    };
  }, [roster, activeLeadLists, leadLists, lead.list_id, lead.assigned_to, teamMemberNames]);
  const onCheckedIn = useCallback(async ({ triaged }: { triaged: boolean }) => {
    void file.checkIns.fetchHistory();
    // The visit is a note: re-read them so the Activity tab shows it without a reload.
    fetch(`/api/v1/leads/${props.lead.id}/notes`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && Array.isArray(j.data)) setNotes(j.data); }).catch(() => {});
    if (triaged) {
      // An assignee or a stage move was sent: re-read the lead so the left column and the stage card follow.
      fetch(`/api/v1/leads/${props.lead.id}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.data) actions.setCurrentLead((prev) => ({ ...prev, ...j.data } as Lead)); }).catch(() => {});
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.lead.id, file.checkIns.fetchHistory, router]);

  // Academic/test edit gate (admin, the assignee, or a collaborator) — unchanged from today's page.
  const [isCollaboratorUser, setIsCollaboratorUser] = useState(false);
  useEffect(() => {
    fetch(`/api/v1/leads/${props.lead.id}/collaborators`).then((r) => (r.ok ? r.json() : null)).then((j) => {
      const list = (j?.data?.collaborators ?? []) as { user_id: string }[];
      setIsCollaboratorUser(list.some((c) => c.user_id === userId));
    }).catch(() => {});
  }, [props.lead.id, userId]);
  const isEditor = isAdmin || userId === lead.assigned_to || isCollaboratorUser;

  // Opening a lead clears its notifications (e.g. "New lead"), like reading a thread clears its unread count.
  useEffect(() => {
    fetch("/api/v1/notifications/read-by-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ link: `/leads/${props.lead.id}` }) }).catch(() => {});
  }, [props.lead.id]);

  // ?edit=1 (the table's old "Edit" link) opens the Student Details pop-up, then drops the param.
  useEffect(() => {
    if (searchParams.get("edit") !== "1") return;
    const t = setTimeout(() => openStudentDetails(), 0);
    const url = new URL(window.location.href);
    url.searchParams.delete("edit");
    router.replace(url.pathname + url.search);
    return () => clearTimeout(t);
    // once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const prev = document.title;
    document.title = `${name} · EdgeX`;
    return () => { document.title = prev; };
  }, [name]);

  // ── prev / next (edgex.leadNav) ──
  const [navCtx, setNavCtx] = useState<LeadNavContext | null>(null);
  useEffect(() => { setNavCtx(readLeadNav()); }, [props.lead.id]);
  const nav = useMemo(() => resolveLeadNav(navCtx, props.lead.id), [navCtx, props.lead.id]);
  const goLead = useCallback(async (dir: "next" | "prev") => {
    if (!nav || !navCtx) return;
    const direct = dir === "next" ? nav.nextId : nav.prevId;
    if (direct) { router.push(`/leads/${direct}`); return; }
    if (dir === "next" ? !nav.hasNext : !nav.hasPrev) return;
    const adj = await fetchAdjacentLeadId(navCtx, dir);
    if (!adj) { toast.error("Couldn't load the next lead"); return; }
    writeLeadNav(adj.ctx);
    router.push(`/leads/${adj.id}`);
  }, [nav, navCtx, router]);

  const goNote = useCallback(() => { middleRef.current?.goNote(); }, []);
  const goTask = useCallback(() => { middleRef.current?.goTask(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!shouldHandleNavKey(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        const el = document.activeElement as HTMLElement | null;
        if (el && el !== document.body && el.tagName !== "DIV") return; // something is focused: don't hijack ⌘↵
        if (mainRef.current?.enabled) { e.preventDefault(); mainRef.current.run(); }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "j") { e.preventDefault(); void goLead("next"); }
      else if (k === "k") { e.preventDefault(); void goLead("prev"); }
      else if (k === "n") { e.preventDefault(); goNote(); }
      else if (k === "t") { e.preventDefault(); goTask(); }
      else if (k === "e" && lead.email) { e.preventDefault(); window.location.href = `mailto:${lead.email}`; }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [goLead, goNote, goTask, lead.email]);

  const deleteLead = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/leads/${lead.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Lead deleted");
      router.push("/leads");
      router.refresh();
    } catch {
      toast.error("Failed to delete lead");
      setDeleting(false);
      setDeleteOpen(false);
    }
  };
  const copyLink = async () => { try { await navigator.clipboard.writeText(`${window.location.origin}/leads/${lead.id}`); toast.success("Link copied"); } catch { toast.error("Failed to copy"); } };
  const copyId = async () => { try { await navigator.clipboard.writeText(lead.display_id ?? lead.id); toast.success("Lead ID copied"); } catch { toast.error("Failed to copy"); } };

  // ··· → Merge duplicates… (admins): one suggestion opens the existing merge dialog; several (or none) go to / say so on the Overview card.
  const [mergeWith, setMergeWith] = useState<Lead | null>(null);
  const mergeDuplicates = async () => {
    try {
      const res = await fetch(`/api/v1/leads/${lead.id}/duplicates`);
      const list = res.ok ? ((await res.json()).data ?? []) as Array<{ other_lead: { id: string } }> : [];
      if (list.length === 0) { toast.info("No possible duplicates for this lead"); return; }
      if (list.length > 1) {
        middleRef.current?.openTab("overview");
        setTimeout(() => document.getElementById("possible-duplicates")?.scrollIntoView({ block: "center" }), 80);
        return;
      }
      const other = await fetch(`/api/v1/leads/${list[0].other_lead.id}`).then((r) => (r.ok ? r.json() : null));
      if (other?.data) setMergeWith(other.data as Lead);
      else toast.error("Couldn't load the duplicate");
    } catch {
      toast.error("Couldn't check for duplicates");
    }
  };

  if (actions.leaving) {
    return <div className="flex h-full items-center justify-center py-32"><CircleNotchIcon className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  const backHref = nav?.backHref ?? backDestination.href;
  // The shared hook says "All Leads"; the education page (and its mockup) reads "All leads".
  const backLabel = nav?.viewLabel ?? (backDestination.label === "All Leads" ? "All leads" : backDestination.label);

  return (
    <div className="flex h-full min-h-[640px] flex-col overflow-hidden bg-white font-medium">
      <a href="#lead-tabpanel" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-[8px] focus:bg-white focus:px-3 focus:py-2 focus:text-[14px] focus:shadow-[0_0_0_1px_#266df0]">Skip to content</a>

      {/* Header strip (48px) */}
      <header className="flex h-12 flex-none items-center gap-1 border-b border-[#e8e9eb] px-3">
        <button type="button" onClick={() => router.push(backHref)} className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[8px] px-1.5 text-[14px] text-black/[.63] outline-none hover:bg-[#f6f7f9] focus-visible:ring-2 focus-visible:ring-[#266df0]/50">
          <ArrowLeftIcon className="size-[14px]" aria-hidden />{backLabel}
        </button>
        {nav && (
          <>
            <span aria-hidden className="mx-1.5 h-4 w-px bg-[#e8e9eb]" />
            <NavButton label="Previous lead" kbd="K" disabled={!nav.hasPrev} onClick={() => void goLead("prev")}><CaretUpIcon className="size-[14px]" /></NavButton>
            <NavButton label="Next lead" kbd="J" disabled={!nav.hasNext} onClick={() => void goLead("next")}><CaretDownIcon className="size-[14px]" /></NavButton>
            <span className="ml-1.5 text-[12px] font-medium leading-4 text-black/[.63]">{nav.position.toLocaleString()} of {nav.total.toLocaleString()} in {nav.viewLabel}</span>
          </>
        )}
        <span className="flex-1" />
        <button type="button" onClick={() => openStudentDetails()} className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[8px] px-2 text-[14px] text-black/[.63] outline-none hover:bg-[#f6f7f9] focus-visible:ring-2 focus-visible:ring-[#266df0]/50">
          <PencilSimpleIcon className="size-[14px]" aria-hidden />Edit profile
        </button>
        <MoreMenu isAdmin={isAdmin} onCopyLink={copyLink} onCopyId={copyId} onDelete={() => setDeleteOpen(true)} onMerge={() => void mergeDuplicates()} />
      </header>

      <div className="flex min-h-0 flex-1 max-[767px]:flex-col max-[767px]:overflow-y-auto">
        {/* Left 320 */}
        <aside aria-label="Lead" className="w-[320px] flex-none overflow-y-auto [scrollbar-color:#d0d3d7_transparent] [scrollbar-width:thin] border-r border-[#e8e9eb] max-[767px]:w-full max-[767px]:overflow-visible max-[767px]:border-r-0">
          <LeftColumn
            lead={props.lead} actions={actions} stages={stages} leadLists={leadLists} activeLeadLists={activeLeadLists} userId={userId} memberNames={memberNames}
            isAdmin={isAdmin} leadScope={leadScope} canEdit={canEdit} isEditor={isEditor} canAssign={canAssign} canMoveWithoutChain={canMoveWithoutChain}
            revertTargetUserId={revertTargetUserId} consentEnabled={consentEnabled} consentSigned={consentSignedState}
            assignableMembers={assignableMembers} stageScopedAssignees={stageScopedAssignees} roster={roster}
            file={file} canManageConsent={canManageApplications ?? isAdmin} onNote={goNote} onTask={goTask} onEditProfile={openStudentDetails} onDelete={() => setDeleteOpen(true)} onMerge={() => void mergeDuplicates()} mainRef={mainRef}
          />
        </aside>

        {/* Middle: one tab row + the active panel (EDGEX-153) */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden max-[767px]:overflow-visible">
          <MiddleColumn
            ref={middleRef} lead={lead} notes={notes} onNotesChange={setNotes} checklists={checklists} onChecklistsChange={setChecklists} audits={activities}
            stages={stages} leadLists={leadLists} tenantId={tenant.id} currentUserId={userId} memberNames={memberNames}
            teamMemberNames={teamMemberNames} teamMemberEmails={teamMemberEmails} isAdmin={isAdmin} canEdit={canEdit} canManageNotes={canManageNotes}
            aiEnabled={aiEnabled} followUpStaleDays={followUpStaleDays} projectBoardEnabled={projectBoardEnabled}
            applicationsActive={applicationsActive} classesActive={classesActive} checkInActive={checkInActive} documentsActive={documentsActive}
            consentEnabled={consentEnabled} consentSigned={consentSignedState} onConsentSignedChange={setConsentSignedState}
            canManageApplications={canManageApplications} canManageApplicationPanel={canManageApplicationPanel} canEnroll={canEnroll}
            file={file} onOpenCheckIn={file.checkIns.openCheckIn}
            onOpenStudentDetails={() => { openStudentDetails(); }} onMerged={() => router.refresh()}
          />
        </main>

        {/* Right rail 280, from 1280px wide (EDGEX-154): the student file, sharing state with its tabs. */}
        <aside aria-label="Student file" className="hidden w-[280px] flex-none overflow-y-auto border-l border-[#e8e9eb] px-3 pb-4 pt-1 min-[1280px]:block">
          <RightRail
            lead={lead} file={file} applicationsActive={!!applicationsActive} consentActive={consentActive} classesActive={!!classesActive}
            documentsActive={!!documentsActive} checkInActive={!!checkInActive} consentSigned={consentSignedState} isAdmin={isAdmin}
            canManageConsent={canManageApplications ?? isAdmin} canManageApplications={canManageApplicationPanel ?? canManageApplications ?? isAdmin}
            canEnroll={canEnroll ?? isAdmin} canUpload={canEdit} teamMemberNames={teamMemberNames}
            openTab={(t) => middleRef.current?.openTab(t)} onEditProfile={() => openStudentDetails()} onCheckIn={file.checkIns.openCheckIn}
          />
        </aside>
      </div>

      {actions.dialogs}

      {/* The student file's dialogs, hosted once: the rail's "+", the tab's main button and the stage card's links open THESE. */}
      {file.consent.dialogs}
      {file.applications.dialogs}
      {file.enrollments.dialogs}
      {file.documents.dialogs}
      <LeadCheckInDialog
        open={file.checkIns.dialogOpen} onOpenChange={file.checkIns.setDialogOpen} leadId={lead.id} leadName={name}
        meetWithOptions={meetWithOptions} triage={checkInTriage} onSaved={(info) => void onCheckedIn(info)}
      />

      {/* Edit profile (flow 10). Mounted per opening so it always starts from the CURRENT lead (inline edits happen meanwhile). */}
      {studentRecordActive && detailsOpen && (
        <PersonalDetailsDialog
          key={detailsKey}
          layout="sections"
          lead={lead} open
          onOpenChange={(next) => { setDetailsOpen(next); if (!next) setMissingBeforeApplications([]); }}
          submissionHistory={submissionHistory}
          onLeadUpdate={(patch) => actions.setCurrentLead((prev) => ({ ...prev, ...patch } as Lead))}
          canUploadDocuments={getFeatureAccess(tenant.industry_id, FEATURES.APPLICANT_DOCUMENTS) && canEdit}
          openInEditMode isAdmin={isAdmin} missingBeforeApplications={missingBeforeApplications}
          onNavKey={(dir) => void goLead(dir)}
        />
      )}

      {mergeWith && (
        <MergeDialog leadA={lead} leadB={mergeWith} open onOpenChange={(o) => { if (!o) setMergeWith(null); }} onMerged={() => { setMergeWith(null); router.refresh(); }} />
      )}

      <AlertDialog open={deleteOpen} onOpenChange={(o) => { if (!deleting) setDeleteOpen(o); }}>
        <AlertDialogContent onCloseAutoFocus={restoreOrigin}>
          <AlertDialogHeader icon={<XIcon aria-hidden />} tone="danger">
            <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
            <AlertDialogDescription>The lead moves to the Recycle bin. Admins can restore it from there.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={deleting} onClick={(e) => { e.preventDefault(); void deleteLead(); }}>{deleting ? "Deleting…" : <>Delete <DialogKeyHint>↵</DialogKeyHint></>}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
