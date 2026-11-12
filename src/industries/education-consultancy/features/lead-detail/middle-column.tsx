"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  BriefcaseIcon, CheckSquareIcon, EnvelopeSimpleIcon, FileTextIcon, GraduationCapIcon, NoteIcon, PulseIcon, ShieldCheckIcon,
  SquaresFourIcon, UserCheckIcon,
} from "@/components/icons";
import { LogActivityModal } from "@/components/dashboard/lead/activities/log-activity-modal";
import { ActivitiesPanel } from "@/components/dashboard/lead/activities/activities-panel";
import { NotesTab, type NotesTabRef } from "@/components/dashboard/lead/notes-tab";
import { useEmailThreads } from "@/industries/_shared/features/email/hooks/use-email-threads";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { ApplicationsCard } from "@/industries/education-consultancy/features/application-tracking/components/applications-card";
import { ConsentCard } from "@/industries/education-consultancy/features/application-tracking/components/consent-card";
import { ClassesCard } from "@/industries/education-consultancy/features/classes/components/classes-card";
import { CheckInHistoryCard } from "@/industries/_shared/features/check-in/check-in-history-card";
import { ApplicantDocumentsCard } from "@/industries/education-consultancy/features/applicant-documents/documents-card";
import { consentProfileKey } from "@/lib/consent/readiness";
import { notifyTaskChanged, TASK_CHANGED_EVENT } from "@/lib/tasks/task-events";
import type { ActivityType, Lead, LeadActivityRecord, LeadChecklist, LeadList, LeadNote, PipelineStage } from "@/types/database";
import type { LeadActivity } from "@/lib/supabase/queries";
import { usePreviewData, useTaskChangedRefresh } from "../record-preview/use-preview-data";
import { ActivityTab } from "./activity-tab";
import { mergeFeed } from "./lib/activity-merge";
import { availableTabs, parseTab, TAB_LABEL, tabHref, type TabId } from "./lib/tabs";
import { mergeTasks, sendToggle, type TaskIn, type UnifiedTask } from "./lib/tasks-merge";
import { Overview } from "./overview";
import { PANEL_ID, TabBar, tabId, type TabDef } from "./tab-bar";
import { TasksTab } from "./tasks-tab";
import { CARD_FRAME } from "./ui";

export interface MiddleColumnHandle {
  goNote: () => void;
  goTask: () => void;
  openTab: (t: TabId) => void;
}

export interface MiddleColumnProps {
  lead: Lead;
  notes: LeadNote[];
  onNotesChange: (n: LeadNote[]) => void;
  checklists: LeadChecklist[];
  onChecklistsChange: (c: LeadChecklist[]) => void;
  audits: LeadActivity[];
  stages: PipelineStage[];
  leadLists: LeadList[];
  tenantId: string;
  currentUserId: string;
  memberNames: Record<string, string>;
  teamMemberNames: Record<string, string>;
  teamMemberEmails: Record<string, string>;
  isAdmin: boolean;
  canEdit: boolean;
  canManageNotes: boolean;
  aiEnabled: boolean;
  followUpStaleDays: number;
  projectBoardEnabled?: boolean;
  // unlock rules (computed by the page shell)
  applicationsActive?: boolean;
  classesActive?: boolean;
  checkInActive?: boolean;
  documentsActive?: boolean;
  consentEnabled: boolean;
  consentSigned: boolean;
  onConsentSignedChange: (v: boolean) => void;
  canManageApplications?: boolean;
  canManageApplicationPanel?: boolean;
  canEnroll?: boolean;
  onOpenStudentDetails: () => void;
  onMerged: () => void;
}

/**
 * The middle column (EDGEX-153): ONE 44px tab row (Overview · Activity · Tasks · Notes · Emails · Consent & fee ·
 * Applications · Classes · Documents · Check-ins; overflow in "+N more") over the active panel. Owns the data the tab
 * counts and the Overview need (merged feed, merged tasks, preview payload) so every tab agrees with its count.
 */
export const MiddleColumn = forwardRef<MiddleColumnHandle, MiddleColumnProps>(function MiddleColumn(p, ref) {
  const { lead, currentUserId } = p;
  const router = useRouter();
  const searchParams = useSearchParams();

  const hasEmail = getFeatureAccess("education_consultancy", FEATURES.EMAIL);
  const unlocks = useMemo(() => ({
    emails: hasEmail,
    consent: !!p.applicationsActive && p.consentEnabled,
    applications: !!p.applicationsActive,
    classes: !!p.classesActive,
    documents: !!p.documentsActive,
    checkins: !!p.checkInActive,
  }), [hasEmail, p.applicationsActive, p.consentEnabled, p.classesActive, p.documentsActive, p.checkInActive]);
  const available = useMemo(() => availableTabs(unlocks), [unlocks]);

  // ── tab state + ?tab= deep link (in on mount, out via replaceState) ──
  const [tab, setTabState] = useState<TabId>(() => parseTab(searchParams.get("tab"), available));
  const activeTab: TabId = available.includes(tab) ? tab : "overview";
  const selectTab = useCallback((id: TabId) => {
    setTabState(id);
    try {
      window.history.replaceState(window.history.state, "", tabHref(window.location.href, id));
    } catch { /* URL sync is a convenience */ }
  }, []);

  // ── data ──
  const { data, invalidate } = usePreviewData(lead.id, null, "top");
  useTaskChangedRefresh(lead.id, invalidate);
  const stageKey = `${lead.list_id}|${lead.stage_id}|${lead.assigned_to}|${lead.pre_app_fee_status}|${p.consentSigned}`;
  const firstStageKey = useRef(stageKey);
  useEffect(() => {
    if (firstStageKey.current === stageKey) return;
    firstStageKey.current = stageKey;
    invalidate(lead.id);
  }, [stageKey, lead.id, invalidate]);

  const [logged, setLogged] = useState<LeadActivityRecord[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/leads/${lead.id}/activities`).then((r) => (r.ok ? r.json() : { data: [] })).then((j) => { if (!cancelled) setLogged(j.data ?? []); }).catch(() => { if (!cancelled) setLogged([]); });
    return () => { cancelled = true; };
  }, [lead.id]);

  const { threads, setThreads } = useEmailThreads(hasEmail ? lead.id : "");

  const [tasks, setTasks] = useState<TaskIn[] | null>(null);
  const loadTasks = useCallback(() => {
    fetch(`/api/v1/leads/${lead.id}/tasks`).then((r) => (r.ok ? r.json() : { data: [] })).then((j) => setTasks((j.data ?? []) as TaskIn[])).catch(() => setTasks((t) => t ?? []));
  }, [lead.id]);
  useEffect(() => { loadTasks(); }, [loadTasks]);
  useEffect(() => {
    window.addEventListener(TASK_CHANGED_EVENT, loadTasks);
    return () => window.removeEventListener(TASK_CHANGED_EVENT, loadTasks);
  }, [loadTasks]);

  const nameOf = useCallback((id: string | null | undefined, fallback?: string | null) => (id ? p.teamMemberNames[id] ?? fallback ?? null : fallback ?? null), [p.teamMemberNames]);
  const sourceLabel = data?.source_name ?? (lead.intake_source ? lead.intake_source.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : null);
  const feed = useMemo(() => (logged === null ? null : mergeFeed({
    notes: p.notes, logged, audits: p.audits, leadCreatedAt: lead.created_at, sourceLabel, nameOf,
    emails: threads.flatMap((t) => t.emails),
  })), [logged, p.notes, p.audits, lead.created_at, sourceLabel, nameOf, threads]);

  const merged = useMemo(() => (tasks === null ? null : mergeTasks(tasks, p.checklists)), [tasks, p.checklists]);

  const toggleTask = useCallback(async (t: UnifiedTask, done: boolean) => {
    const revert = () => {
      if (t.source === "checklist") p.onChecklistsChange(p.checklists.map((c) => (c.id === t.id ? { ...c, is_completed: !done } : c)));
      else setTasks((prev) => prev && prev.map((x) => (x.id === t.id ? { ...x, status: done ? "todo" : "done" } : x)));
      toast.error(done ? "Couldn’t complete the task" : "Couldn’t reopen the task");
    };
    if (t.source === "checklist") p.onChecklistsChange(p.checklists.map((c) => (c.id === t.id ? { ...c, is_completed: done } : c)));
    else setTasks((prev) => prev && prev.map((x) => (x.id === t.id ? { ...x, status: done ? "done" : "todo" } : x)));
    if (await sendToggle(t, lead.id, done)) { if (t.source === "task") notifyTaskChanged(); } else revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, p.checklists, p.onChecklistsChange]);

  // ── composers (N / T / left-column buttons) ──
  const notesRef = useRef<NotesTabRef>(null);
  const taskInputRef = useRef<HTMLInputElement | null>(null);
  const pendingFocus = useRef<"note" | "task" | null>(null);
  useEffect(() => {
    if (activeTab === "notes" && pendingFocus.current === "note") { pendingFocus.current = null; setTimeout(() => notesRef.current?.focusComposer(), 50); }
    if (activeTab === "tasks" && pendingFocus.current === "task") { pendingFocus.current = null; setTimeout(() => taskInputRef.current?.focus(), 50); }
  }, [activeTab]);
  const goNote = useCallback(() => { pendingFocus.current = "note"; if (activeTab === "notes") { pendingFocus.current = null; setTimeout(() => notesRef.current?.focusComposer(), 0); } else selectTab("notes"); }, [activeTab, selectTab]);
  const goTask = useCallback(() => { pendingFocus.current = "task"; if (activeTab === "tasks") { pendingFocus.current = null; setTimeout(() => taskInputRef.current?.focus(), 0); } else selectTab("tasks"); }, [activeTab, selectTab]);
  useImperativeHandle(ref, () => ({ goNote, goTask, openTab: (t) => { if (available.includes(t)) selectTab(t); } }), [goNote, goTask, available, selectTab]);

  const [logOpen, setLogOpen] = useState(false);
  const [logType, setLogType] = useState<ActivityType>("call");

  // ── tab definitions (counts, hints) ──
  const unreadEmails = useMemo(() => threads.reduce((n, t) => n + t.emails.filter((e) => e.direction === "inbound" && !e.read_at).length, 0), [threads]);
  const openCount = merged ? merged.filter((t) => !t.done).length : null;
  const left = data && !data.readiness.ready ? data.readiness.items.length : 0;
  const defs: TabDef[] = useMemo(() => {
    const icon: Record<TabId, React.ReactNode> = {
      overview: <SquaresFourIcon />, activity: <PulseIcon />, tasks: <CheckSquareIcon />, notes: <NoteIcon />, emails: <EnvelopeSimpleIcon />,
      consent: <ShieldCheckIcon />, applications: <BriefcaseIcon />, classes: <GraduationCapIcon />, documents: <FileTextIcon />, checkins: <UserCheckIcon />,
    };
    const count: Partial<Record<TabId, number | null>> = {
      activity: feed ? feed.length : null, tasks: openCount, notes: p.notes.length,
      emails: unreadEmails > 0 ? unreadEmails : null, applications: data ? data.applications.count : null,
    };
    return available.map((id) => ({
      id, label: TAB_LABEL[id], icon: icon[id], count: count[id] ?? null, hint: id === "consent" && left > 0 ? `${left} left` : null,
    }));
  }, [available, feed, openCount, p.notes.length, unreadEmails, data, left]);

  const cardCommon = { leadId: lead.id };
  const profileKey = consentProfileKey(lead);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TabBar tabs={defs} active={activeTab} onSelect={selectTab} />
      <div id={PANEL_ID} role="tabpanel" aria-labelledby={tabId(activeTab)} tabIndex={0} className="min-h-0 flex-1 overflow-y-auto outline-none max-[767px]:overflow-visible">
        {activeTab === "overview" && (
          <Overview
            lead={lead} data={data} aiEnabled={p.aiEnabled} currentUserId={currentUserId} memberNames={p.teamMemberNames} stages={p.stages} leadLists={p.leadLists}
            followUpStaleDays={p.followUpStaleDays} feed={feed} tasks={merged} noteCount={p.notes.length}
            latestNote={p.notes[0] ?? null} isAdmin={p.isAdmin} applicationsTabOpen={unlocks.applications}
            goTab={selectTab} onAddTask={goTask}
            onCompleteTask={(key) => { const t = merged?.find((x) => x.key === key); if (t) void toggleTask(t, true); }}
            onMerged={p.onMerged}
          />
        )}

        {activeTab === "activity" && (
          <ActivityTab feed={feed} currentUserId={currentUserId} onLog={(t) => { setLogType(t); setLogOpen(true); }} onAddNote={goNote} />
        )}

        {activeTab === "tasks" && (
          <TasksTab
            items={merged} leadId={lead.id} currentUserId={currentUserId} composerRef={taskInputRef} onToggle={(t, d) => void toggleTask(t, d)}
            onOpen={(t) => { if (t.source === "task") router.push(`/tasks/${t.id}`); }} onCreated={() => { loadTasks(); invalidate(lead.id); }}
          />
        )}

        {activeTab === "notes" && (
          <div className="px-4 pb-4 pt-1">
            <h3 className="m-0 mt-3 mb-2 px-1 text-[14px] font-medium leading-5 text-black/[.63]">Notes</h3>
            <NotesTab
              ref={notesRef} leadId={lead.id} notes={p.notes} onNotesChange={(n) => { p.onNotesChange(n); invalidate(lead.id); }}
              teamMemberNames={p.teamMemberNames} teamMemberEmails={p.teamMemberEmails} currentUserId={currentUserId} canManageNotes={p.canManageNotes}
            />
          </div>
        )}

        {activeTab === "emails" && (
          <div className="px-4 pb-4 pt-1">
            <h3 className="m-0 mt-3 mb-2 px-1 text-[14px] font-medium leading-5 text-black/[.63]">Emails</h3>
            <ActivitiesPanel
              forcedTab="emails" leadId={lead.id} notes={p.notes} systemActivities={p.audits} teamMemberEmails={p.teamMemberEmails} teamMemberNames={p.teamMemberNames}
              isAdmin={p.isAdmin} canEdit={p.canEdit} canManageNotes={p.canManageNotes} onNotesChange={p.onNotesChange}
              checklists={p.checklists} onChecklistsChange={p.onChecklistsChange} currentUserId={currentUserId} industryId="education_consultancy"
              leadEmail={lead.email} leadFirstName={lead.first_name} leadLastName={lead.last_name}
              threads={threads} setThreads={setThreads} threadsLoading={false} projectBoardEnabled={p.projectBoardEnabled}
              onActivityLogged={(a) => setLogged((prev) => (prev ? [a, ...prev] : [a]))}
              onActivityDeleted={(id) => setLogged((prev) => (prev ? prev.filter((a) => a.id !== id) : prev))}
            />
          </div>
        )}

        {activeTab === "consent" && (
          <div className={`px-4 pb-4 pt-1 ${CARD_FRAME}`}>
            <h3 className="m-0 mt-3 mb-2 px-1 text-[14px] font-medium leading-5 text-black/[.63]">Consent &amp; fee</h3>
            <ConsentCard
              {...cardCommon} tenantId={p.tenantId} consentEnabled={p.consentEnabled} consentSigned={p.consentSigned} showCopyLink showCollapsedStatus
              profileKey={profileKey} onOpenStudentDetails={p.onOpenStudentDetails}
              canManage={p.canManageApplications ?? p.isAdmin} canManageFee={p.isAdmin} canOverrideProfileCheck={p.isAdmin} onSignedChange={p.onConsentSignedChange}
              feeStatus={lead.pre_app_fee_status} feeAmount={lead.pre_app_fee_amount} feeNotes={lead.pre_app_fee_notes}
            />
          </div>
        )}

        {activeTab === "applications" && (
          <div className={`px-4 pb-4 pt-1 ${CARD_FRAME}`}>
            <h3 className="m-0 mt-3 mb-2 px-1 text-[14px] font-medium leading-5 text-black/[.63]">Applications</h3>
            <ApplicationsCard {...cardCommon} canManage={p.canManageApplicationPanel ?? p.canManageApplications ?? p.isAdmin} disabled={p.consentEnabled && !p.consentSigned} />
          </div>
        )}

        {activeTab === "classes" && (
          <div className={`px-4 pb-4 pt-1 ${CARD_FRAME}`}>
            <h3 className="m-0 mt-3 mb-2 px-1 text-[14px] font-medium leading-5 text-black/[.63]">Classes</h3>
            <ClassesCard {...cardCommon} canManage={p.canEnroll ?? p.isAdmin} />
          </div>
        )}

        {activeTab === "documents" && (
          <div className={`px-4 pb-4 pt-1 ${CARD_FRAME}`}>
            <h3 className="m-0 mt-3 mb-2 px-1 text-[14px] font-medium leading-5 text-black/[.63]">Documents</h3>
            <ApplicantDocumentsCard {...cardCommon} canManage={p.canEdit} currentUserId={currentUserId} isAdmin={p.isAdmin} />
          </div>
        )}

        {activeTab === "checkins" && (
          <div className={`px-4 pb-4 pt-1 ${CARD_FRAME}`}>
            <h3 className="m-0 mt-3 mb-2 px-1 text-[14px] font-medium leading-5 text-black/[.63]">Check-ins</h3>
            <CheckInHistoryCard {...cardCommon} teamMemberNames={p.teamMemberNames} teamMemberEmails={p.teamMemberEmails} />
          </div>
        )}
      </div>

      <LogActivityModal
        open={logOpen} onOpenChange={setLogOpen} leadId={lead.id} activityType={logType}
        onActivityLogged={(a) => setLogged((prev) => (prev ? [a, ...prev] : [a]))}
      />
    </div>
  );
});

