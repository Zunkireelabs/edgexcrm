"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CaretDownIcon, CaretUpIcon, CircleNotchIcon, PencilSimpleIcon, ArrowLeftIcon } from "@/components/icons";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useLeadBackDestination } from "@/hooks/use-lead-back-destination";
import { getLeadFullName } from "@/components/dashboard/lead/lead-name";
import { PersonalDetailsDialog } from "@/industries/education-consultancy/features/student-record/components/personal-details-dialog";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { resolveThresholds } from "@/industries/education-consultancy/features/team-performance/lib/thresholds";
import { ManagementPanel } from "@/components/dashboard/lead/management-panel";
import { ApplicationsCard } from "@/industries/education-consultancy/features/application-tracking/components/applications-card";
import { ConsentCard } from "@/industries/education-consultancy/features/application-tracking/components/consent-card";
import { ClassesCard } from "@/industries/education-consultancy/features/classes/components/classes-card";
import { CheckInHistoryCard } from "@/industries/_shared/features/check-in/check-in-history-card";
import { ApplicantDocumentsCard } from "@/industries/education-consultancy/features/applicant-documents/documents-card";
import { canEditLeadWorkingData } from "@/lib/leads/lead-edit-scope";
import { consentProfileKey } from "@/lib/consent/readiness";
import { isOwnerOrAdmin } from "@/lib/roles";
import type { Lead, LeadChecklist, LeadList, LeadNote, PipelineStage, Tenant } from "@/types/database";
import type { LeadActivity } from "@/lib/supabase/queries";
import type { LeadSubmissionSnapshot } from "@/lib/leads/submission-history";
import { NavButton } from "../record-preview/record-preview";
import { shouldHandleNavKey } from "../record-preview/lib/nav";
import { LeftColumn, MoreMenu } from "./left-column";
import { MiddleColumn, type MiddleColumnHandle } from "./middle-column";
import { useLeadActions, type Assignee, type Person } from "./use-lead-actions";
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
  const [missingBeforeApplications, setMissingBeforeApplications] = useState<string[]>([]);
  const openStudentDetails = useCallback((missing?: string[]) => {
    if (!studentRecordActive) return false;
    setMissingBeforeApplications(missing ?? []);
    setDetailsOpen(true);
    return true;
  }, [studentRecordActive]);
  const actions = useLeadActions({
    lead: props.lead, userId, leadLists, activeLeadLists, bypassQualification, nextPositionMembers, revertTargetUserId, revertTargetName,
    revertTargetMembers, stageAssigneeMap, openStudentDetails,
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

  // Roster for the collaborator picker + the Activity feed's names (admins / assigners only; others never open the picker).
  const [roster, setRoster] = useState<TeamMember[]>([]);
  useEffect(() => {
    if (!isAdmin && !canAssign) return;
    fetch("/api/v1/team").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) setRoster(j.data || []); }).catch(() => {});
  }, [isAdmin, canAssign]);
  const teamMemberEmails = useMemo(() => roster.reduce<Record<string, string>>((a, m) => { a[m.user_id] = m.email; return a; }, {}), [roster]);
  const teamMemberNames = useMemo(() => roster.reduce<Record<string, string>>((a, m) => { if (m.name) a[m.user_id] = m.name; return a; }, { ...memberNames }), [roster, memberNames]);

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

  const name = getLeadFullName(lead, "Unnamed lead");
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
        <MoreMenu isAdmin={isAdmin} onCopyLink={copyLink} onCopyId={copyId} onDelete={() => setDeleteOpen(true)} />
      </header>

      <div className="flex min-h-0 flex-1 max-[767px]:flex-col max-[767px]:overflow-y-auto">
        {/* Left 320 */}
        <aside aria-label="Lead" className="w-[320px] flex-none overflow-y-auto [scrollbar-color:#d0d3d7_transparent] [scrollbar-width:thin] border-r border-[#e8e9eb] max-[767px]:w-full max-[767px]:overflow-visible max-[767px]:border-r-0">
          <LeftColumn
            lead={props.lead} actions={actions} stages={stages} leadLists={leadLists} activeLeadLists={activeLeadLists} userId={userId} memberNames={memberNames}
            isAdmin={isAdmin} leadScope={leadScope} canEdit={canEdit} isEditor={isEditor} canAssign={canAssign} canMoveWithoutChain={canMoveWithoutChain}
            revertTargetUserId={revertTargetUserId} consentEnabled={consentEnabled} consentSigned={consentSignedState}
            assignableMembers={assignableMembers} stageScopedAssignees={stageScopedAssignees} roster={roster}
            onNote={goNote} onTask={goTask} onEditProfile={openStudentDetails} onDelete={() => setDeleteOpen(true)} mainRef={mainRef}
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
            onOpenStudentDetails={() => { openStudentDetails(); }} onMerged={() => router.refresh()}
          />
        </main>

        {/* Right rail 280, from 1280px wide. Today's cards until the rail is rebuilt (Phase 3). */}
        <aside aria-label="Student file" className="hidden w-[280px] flex-none overflow-y-auto border-l border-[#e8e9eb] px-3 pb-4 pt-1 min-[1280px]:block">
          <div className="space-y-4 pt-3">
            {applicationsActive ? (
              <>
                {consentEnabled && (
                  <div id="lead-rail-consent">
                    <ConsentCard
                      leadId={lead.id} tenantId={tenant.id} consentEnabled={consentEnabled} consentSigned={consentSignedState} showCopyLink showCollapsedStatus
                      profileKey={consentProfileKey(lead)} onOpenStudentDetails={() => openStudentDetails()}
                      canManage={canManageApplications ?? isAdmin} canManageFee={isAdmin} canOverrideProfileCheck={isAdmin} onSignedChange={setConsentSignedState}
                      feeStatus={lead.pre_app_fee_status} feeAmount={lead.pre_app_fee_amount} feeNotes={lead.pre_app_fee_notes}
                    />
                  </div>
                )}
                <ApplicationsCard leadId={lead.id} canManage={canManageApplicationPanel ?? canManageApplications ?? isAdmin} disabled={consentEnabled && !consentSignedState} />
              </>
            ) : (
              <ManagementPanel lead={lead} />
            )}
            {classesActive && <ClassesCard leadId={lead.id} canManage={canEnroll ?? isAdmin} />}
            {checkInActive && <CheckInHistoryCard leadId={lead.id} teamMemberNames={teamMemberNames} teamMemberEmails={teamMemberEmails} />}
            {documentsActive && (
              <ApplicantDocumentsCard leadId={lead.id} canManage={canEdit} currentUserId={userId} isAdmin={isAdmin} variant="summary" onViewAll={() => middleRef.current?.openTab("documents")} />
            )}
          </div>
        </aside>
      </div>

      {actions.dialogs}

      {studentRecordActive && (
        <PersonalDetailsDialog
          lead={lead} open={detailsOpen}
          onOpenChange={(next) => { setDetailsOpen(next); if (!next) setMissingBeforeApplications([]); }}
          submissionHistory={submissionHistory}
          onLeadUpdate={(patch) => actions.setCurrentLead((prev) => ({ ...prev, ...patch } as Lead))}
          canUploadDocuments={getFeatureAccess(tenant.industry_id, FEATURES.APPLICANT_DOCUMENTS) && canEdit}
          openInEditMode isAdmin={isAdmin} missingBeforeApplications={missingBeforeApplications}
        />
      )}

      <AlertDialog open={deleteOpen} onOpenChange={(o) => { if (!deleting) setDeleteOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
            <AlertDialogDescription>The lead moves to the Recycle bin. Admins can restore it from there.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={(e) => { e.preventDefault(); void deleteLead(); }} className="bg-[#c4321f] text-white hover:bg-[#a82a1a]">{deleting ? "Deleting…" : "Delete lead"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
