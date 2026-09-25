"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { GitMerge, X } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AISparkleIcon } from "@/components/ui/ai-sparkle";
import type { Lead, LeadNote, LeadChecklist } from "@/types/database";
import type { LeadActivity } from "@/lib/supabase/queries";
import { AIInsightsTab } from "./ai-insights-tab";
import { ProfessionalDetailsCard } from "./professional-details-card";
import { ActivitiesPanel, type ActivitiesPanelRef } from "./activities/activities-panel";
import { MergeDialog } from "./merge-dialog";
import { useEmailThreads } from "@/industries/_shared/features/email/hooks/use-email-threads";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { ItineraryBuilder } from "@/industries/travel-agency/features/itinerary/builder";
import type { Itinerary } from "@/industries/travel-agency/features/itinerary/types";
import { PersonalDetailsDialog } from "@/industries/education-consultancy/features/student-record/components/personal-details-dialog";
import { StudentDetailsSummaryCard } from "@/industries/education-consultancy/features/student-record/components/student-details-summary-card";
import type { LeadSubmissionSnapshot } from "@/lib/leads/submission-history";
interface LeadTabsProps {
  lead: Lead;
  notes: LeadNote[];
  activities: LeadActivity[];
  teamMemberEmails: Record<string, string>;
  teamMemberNames: Record<string, string>;
  customFields: Record<string, unknown>;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onNotesChange: (notes: LeadNote[]) => void;
  onCustomFieldsChange: (fields: Record<string, unknown>) => void;
  checklists: LeadChecklist[];
  onChecklistsChange: (checklists: LeadChecklist[]) => void;
  isAdmin: boolean;
  canEdit?: boolean;
  canManageNotes?: boolean;
  currentUserId: string;
  industryId?: string | null;
  tenantName?: string;
  tenantLogoUrl?: string | null;
  onSaveItinerary?: (itinerary: Itinerary) => Promise<void>;
  /** Gates whether a project-linked task's chip links to the cockpit — resolved server-side via getFeatureAccess, never re-derived here. */
  projectBoardEnabled?: boolean;
  /** Fallback source for Study Interest fields (destinations/field_of_study/degree_level) when the lead's dedicated columns are empty but a form submission already answered them. */
  submissionHistory?: LeadSubmissionSnapshot[];
  /** Keeps the parent's lead state in sync after the Student Details popup actually saves Study Interest/Academic fields, so the old Study Interest panel reflects it without a reload. */
  onLeadUpdate?: (patch: Partial<Lead>) => void;
}

export interface LeadTabsRef {
  focusComposer: () => void;
  focusTaskComposer: () => void;
}

export const LeadTabs = forwardRef<LeadTabsRef, LeadTabsProps>(
  function LeadTabs(
    { lead, notes, activities, teamMemberEmails, teamMemberNames, customFields, activeTab, onTabChange, onNotesChange, onCustomFieldsChange, checklists, onChecklistsChange, isAdmin, canEdit, canManageNotes, currentUserId, industryId, tenantName, tenantLogoUrl, onSaveItinerary, projectBoardEnabled, submissionHistory, onLeadUpdate },
    ref
  ) {
    const activitiesPanelRef = useRef<ActivitiesPanelRef>(null);
    const router = useRouter();
    const [isPersonalDetailsOpen, setIsPersonalDetailsOpen] = useState(false);
    // True only when opened via the Student Details summary card's own "Edit"
    // button, so that path skips straight to the editable form instead of the
    // preview — the top-of-tab "Details" button still opens to preview first.
    const [personalDetailsOpenInEditMode, setPersonalDetailsOpenInEditMode] = useState(false);

    useImperativeHandle(ref, () => ({
      focusComposer: () => {
        activitiesPanelRef.current?.openNotes(true);
      },
      focusTaskComposer: () => {
        activitiesPanelRef.current?.openTasks(true);
      },
    }));

    const canUploadDocuments = getFeatureAccess(industryId, FEATURES.APPLICANT_DOCUMENTS) && (canEdit ?? isAdmin);
    const studentRecordActive = getFeatureAccess(industryId, FEATURES.STUDENT_RECORD);

    const hasEmail = getFeatureAccess(industryId, FEATURES.EMAIL);
    const { threads, setThreads, loading: threadsLoading } = useEmailThreads(hasEmail ? lead.id : "");
    const unreadEmailCount = useMemo(
      () => threads.reduce((n, t) => n + t.emails.filter((e) => e.direction === "inbound" && !e.read_at).length, 0),
      [threads]
    );
    // Roll-up of inner Activity sub-tab notification counts. Today only Emails contributes;
    // add future inner counts (unread calls/tasks/meetings) into this sum.
    const activityUnreadCount = unreadEmailCount;

    return (
      <>
      <Tabs value={activeTab} onValueChange={onTabChange}>
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activity" className="gap-2">
            Activity
            {activityUnreadCount > 0 ? (
              <Badge variant="destructive" className="h-5 min-w-5 px-1.5 text-xs">
                {activityUnreadCount > 9 ? "9+" : activityUnreadCount}
              </Badge>
            ) : activities.length > 0 ? (
              <Badge variant="secondary" className="h-5 px-1.5 text-xs">{activities.length}</Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="ai-insights" className="gap-1.5">
            <AISparkleIcon className="size-4" />
            AI Insights
            <Badge variant="secondary" className="h-4 px-1 text-[10px] font-medium bg-purple-100 text-purple-700">
              Beta
            </Badge>
          </TabsTrigger>
          {industryId === "travel_agency" && (
            <TabsTrigger value="itinerary">Itinerary</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-0">
          {/* Professional Details (editable) — generic B2B fields (Company/
              Designation/Office Phone), not relevant to education_consultancy
              leads. That industry's own Professional Information (Work
              Experience/References) lives in the Student Details popup instead. */}
          {industryId !== "education_consultancy" && (
            <ProfessionalDetailsCard
              leadId={lead.id}
              customFields={customFields}
              onFieldsUpdate={onCustomFieldsChange}
              isAdmin={isAdmin}
              industryId={industryId}
            />
          )}

          {/* Recent Notes Preview */}
          {notes.length > 0 && (
            <Card className="shadow-none rounded-lg py-0">
              <CardHeader className="pt-4 pb-3">
                <CardTitle className="text-base">Recent Notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pb-4">
                {notes.slice(0, 2).map((note) => (
                  <div key={note.id} className="border-l-2 border-muted pl-3 py-1">
                    <p className="text-sm text-foreground line-clamp-2">{note.content}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {teamMemberNames[note.user_id] || teamMemberEmails[note.user_id] || note.user_email} · {formatRelativeTime(note.created_at)}
                    </p>
                  </div>
                ))}
                {notes.length > 2 && (
                  <button
                    type="button"
                    className="text-sm text-primary hover:underline"
                    onClick={() => {
                      onTabChange("activity");
                      setTimeout(() => activitiesPanelRef.current?.openNotes(), 50);
                    }}
                  >
                    View all {notes.length} notes →
                  </button>
                )}
              </CardContent>
            </Card>
          )}

          {/* Student Details summary — read-only; Edit opens the same Student Details dialog as the "Details" button above */}
          {studentRecordActive && (
            <StudentDetailsSummaryCard
              onEdit={() => {
                setPersonalDetailsOpenInEditMode(true);
                setIsPersonalDetailsOpen(true);
              }}
            />
          )}

          {/* Possible Duplicates — admin-only */}
          {isAdmin && <PossibleDuplicatesCard lead={lead} onMerged={() => router.refresh()} />}
        </TabsContent>

        <TabsContent value="activity" className="mt-0">
          <ActivitiesPanel
            ref={activitiesPanelRef}
            leadId={lead.id}
            notes={notes}
            systemActivities={activities}
            teamMemberEmails={teamMemberEmails}
            teamMemberNames={teamMemberNames}
            isAdmin={isAdmin}
            canEdit={canEdit}
            canManageNotes={canManageNotes}
            onNotesChange={onNotesChange}
            checklists={checklists}
            onChecklistsChange={onChecklistsChange}
            currentUserId={currentUserId}
            industryId={industryId}
            leadEmail={lead.email}
            leadFirstName={lead.first_name}
            leadLastName={lead.last_name}
            threads={threads}
            setThreads={setThreads}
            threadsLoading={threadsLoading}
            projectBoardEnabled={projectBoardEnabled}
          />
        </TabsContent>

        <TabsContent value="ai-insights" className="mt-0">
          <AIInsightsTab lead={lead} notes={notes} />
        </TabsContent>

        {industryId === "travel_agency" && onSaveItinerary && (
          <TabsContent value="itinerary" className="mt-0">
            <ItineraryBuilder
              lead={lead}
              tenantName={tenantName ?? ""}
              tenantLogoUrl={tenantLogoUrl}
              onSave={onSaveItinerary}
            />
          </TabsContent>
        )}
      </Tabs>
      {studentRecordActive && (
        <PersonalDetailsDialog
          lead={lead}
          open={isPersonalDetailsOpen}
          onOpenChange={(next) => {
            setIsPersonalDetailsOpen(next);
            if (!next) setPersonalDetailsOpenInEditMode(false);
          }}
          submissionHistory={submissionHistory}
          onLeadUpdate={onLeadUpdate}
          canUploadDocuments={canUploadDocuments}
          openInEditMode={personalDetailsOpenInEditMode}
        />
      )}
      </>
    );
  }
);

// ── Possible Duplicates Card ────────────────────────────────────────────────

interface DuplicateSuggestion {
  id: string;
  reason: string;
  status: string;
  created_at: string;
  other_lead: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    created_at: string;
  };
}

function PossibleDuplicatesCard({ lead, onMerged }: { lead: Lead; onMerged?: () => void }) {
  const [suggestions, setSuggestions] = useState<DuplicateSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<Lead | null>(null);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);

  const fetchSuggestions = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/leads/${lead.id}/duplicates`);
      if (res.ok) {
        const json = await res.json();
        setSuggestions(json.data ?? []);
      }
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }, [lead.id]);

  useEffect(() => { fetchSuggestions(); }, [fetchSuggestions]);

  async function handleDismiss(suggestionId: string) {
    setDismissing(suggestionId);
    try {
      const res = await fetch(`/api/v1/leads/duplicates/${suggestionId}`, { method: "PATCH" });
      if (res.ok) {
        setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
        toast.success("Suggestion dismissed");
      } else {
        toast.error("Failed to dismiss");
      }
    } catch { toast.error("Failed to dismiss"); }
    finally { setDismissing(null); }
  }

  function handleMergeClick(otherLead: DuplicateSuggestion["other_lead"]) {
    // Build a minimal Lead-shaped object for the merge dialog
    const partial: Lead = {
      id: otherLead.id,
      first_name: otherLead.first_name,
      last_name: otherLead.last_name,
      email: otherLead.email,
      phone: otherLead.phone,
      created_at: otherLead.created_at,
      // required fields with safe defaults
      tenant_id: lead.tenant_id,
      pipeline_id: lead.pipeline_id,
      session_id: null,
      step: 1,
      is_final: true,
      status: lead.status,
      city: null,
      country: null,
      custom_fields: {},
      file_urls: {},
      stage_id: lead.stage_id,
      assigned_to: null,
      entity_id: null,
      intake_source: null,
      intake_medium: null,
      intake_campaign: null,
      preferred_contact_method: null,
      tags: [],
      lead_type: "lead",
      display_id: null,
      account_id: null,
      form_config_id: null,
      deleted_at: null,
      converted_at: null,
      converted_contact_id: null,
      idempotency_key: null,
      ai_score: null,
      ai_priority: null,
      ai_score_updated_at: null,
      normalized_email: null,
      merged_into: null,
      company_name: null,
      designation: null,
      prospect_industry: null,
      owner_id: null,
      salutation: null,
      company_email: null,
      branch_id: null,
      last_activity_at: otherLead.created_at,
      stage_changed_at: otherLead.created_at,
      updated_at: otherLead.created_at,
      list_id: null,
      destinations: [],
      field_of_study: null,
      degree_level: null,
      pre_app_fee_status: null,
      pre_app_fee_amount: null,
      pre_app_fee_notes: null,
      archive_reason: null,
      archived_by: null,
      archived_at: null,
      archived_from_list_id: null,
      archived_from_status: null,
      nationality: null,
      intake_account: null,
      ref_code: null,
      form_source: null,
      see_gpa: null,
      see_institution: null,
      see_passed_year: null,
      plus_two_gpa: null,
      plus_two_institution: null,
      plus_two_passed_year: null,
      bachelor_gpa: null,
      bachelor_institution: null,
      bachelor_passed_year: null,
      masters_gpa: null,
      masters_institution: null,
      masters_passed_year: null,
      ielts_score: null,
      pte_score: null,
      toefl_score: null,
      sat_score: null,
      gre_gmat_score: null,
    };
    setMergeTarget(partial);
    setMergeDialogOpen(true);
  }

  if (loading || suggestions.length === 0) return null;

  return (
    <>
      <Card className="shadow-none rounded-lg py-0 border-amber-200 bg-amber-50/30">
        <CardHeader className="pt-4 pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <GitMerge className="h-4 w-4 text-amber-600" />
            Possible duplicates
            <Badge variant="secondary" className="h-5 px-1.5 text-xs bg-amber-100 text-amber-700">
              {suggestions.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pb-4">
          {suggestions.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 rounded-md border border-amber-100 bg-white px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {`${s.other_lead.first_name ?? ""} ${s.other_lead.last_name ?? ""}`.trim() || "—"}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {s.other_lead.email ?? s.other_lead.phone ?? "—"}
                  {" · "}
                  <span className="capitalize">{s.reason} match</span>
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => handleMergeClick(s.other_lead)}
                >
                  <GitMerge className="h-3 w-3 mr-1" />
                  Merge
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  disabled={dismissing === s.id}
                  onClick={() => handleDismiss(s.id)}
                >
                  <X className="h-3 w-3 mr-1" />
                  Dismiss
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {mergeTarget && (
        <MergeDialog
          leadA={lead}
          leadB={mergeTarget}
          open={mergeDialogOpen}
          onOpenChange={setMergeDialogOpen}
          onMerged={() => {
            setSuggestions([]);
            onMerged?.();
          }}
        />
      )}
    </>
  );
}

// ── Helper components ────────────────────────────────────────────────────────

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      return diffMinutes <= 1 ? "Just now" : `${diffMinutes}m ago`;
    }
    return `${diffHours}h ago`;
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
