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
import { getLeadFullName } from "./lead-name";
import { ItineraryBuilder } from "@/industries/travel-agency/features/itinerary/builder";
import type { Itinerary } from "@/industries/travel-agency/features/itinerary/types";
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
}

export interface LeadTabsRef {
  focusComposer: () => void;
}

export const LeadTabs = forwardRef<LeadTabsRef, LeadTabsProps>(
  function LeadTabs(
    { lead, notes, activities, teamMemberEmails, teamMemberNames, customFields, activeTab, onTabChange, onNotesChange, onCustomFieldsChange, checklists, onChecklistsChange, isAdmin, canEdit, canManageNotes, currentUserId, industryId, tenantName, tenantLogoUrl, onSaveItinerary },
    ref
  ) {
    const activitiesPanelRef = useRef<ActivitiesPanelRef>(null);
    const router = useRouter();

    useImperativeHandle(ref, () => ({
      focusComposer: () => {
        activitiesPanelRef.current?.openNotes(true);
      },
    }));

    const hasEmail = industryId === "education_consultancy" || industryId === "travel_agency";
    const { threads, setThreads, loading: threadsLoading } = useEmailThreads(hasEmail ? lead.id : "");
    const unreadEmailCount = useMemo(
      () => threads.reduce((n, t) => n + t.emails.filter((e) => e.direction === "inbound" && !e.read_at).length, 0),
      [threads]
    );
    // Roll-up of inner Activity sub-tab notification counts. Today only Emails contributes;
    // add future inner counts (unread calls/tasks/meetings) into this sum.
    const activityUnreadCount = unreadEmailCount;

    const location = [lead.city, lead.country].filter(Boolean).join(", ");

    return (
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
          {/* Personal Information */}
          <Card className="shadow-none rounded-lg py-0">
            <CardHeader className="pt-4 pb-3">
              <CardTitle className="text-base">Personal Information</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 pb-4">
              <InfoGridRow label="Full Name" value={getLeadFullName(lead, "—")} />
              {lead.display_id && <InfoGridRow label="Lead ID" value={lead.display_id} />}
              {industryId === "education_consultancy" && (
                <InfoGridRow
                  label="Tag"
                  value={
                    <TagSelector
                      leadId={lead.id}
                      currentTags={lead.tags || []}
                    />
                  }
                />
              )}
              <InfoGridRow label="Email" value={lead.email} isLink linkType="email" />
              <InfoGridRow label="Phone" value={lead.phone} isLink linkType="phone" />
              {location && <InfoGridRow label="Location" value={location} />}
              {lead.preferred_contact_method && (
                <InfoGridRow
                  label="Preferred Contact"
                  value={lead.preferred_contact_method.charAt(0).toUpperCase() + lead.preferred_contact_method.slice(1)}
                />
              )}
            </CardContent>
          </Card>

          {/* Professional Details (editable) */}
          <ProfessionalDetailsCard
            leadId={lead.id}
            customFields={customFields}
            onFieldsUpdate={onCustomFieldsChange}
            isAdmin={isAdmin}
            industryId={industryId}
          />

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

interface InfoGridRowProps {
  label: string;
  value: React.ReactNode | string | null | undefined;
  isLink?: boolean;
  linkType?: "email" | "phone";
}

function InfoGridRow({ label, value, isLink, linkType }: InfoGridRowProps) {
  if (!value) return null;

  const displayValue = isLink && typeof value === "string" ? (
    <a
      href={linkType === "email" ? `mailto:${value}` : `tel:${value}`}
      className="text-primary hover:underline"
    >
      {value}
    </a>
  ) : (
    value
  );

  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{displayValue}</span>
    </div>
  );
}

function TagSelector({ leadId, currentTags }: { leadId: string; currentTags: string[] }) {
  const [tags, setTags] = useState(currentTags);
  const [updating, setUpdating] = useState(false);

  async function handleToggle(tag: string) {
    setUpdating(true);
    const newTags = [tag];
    try {
      const res = await fetch(`/api/v1/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: newTags }),
      });
      if (res.ok) {
        setTags(newTags);
        toast.success(`Tagged as ${tag}`);
      }
    } catch {
      toast.error("Failed to update tag");
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="flex gap-1.5">
      {["student", "parent"].map((tag) => (
        <button
          key={tag}
          disabled={updating}
          onClick={() => handleToggle(tag)}
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
            tags.includes(tag)
              ? tag === "parent"
                ? "bg-green-100 text-green-700 ring-2 ring-green-300"
                : "bg-blue-100 text-blue-700 ring-2 ring-blue-300"
              : "bg-gray-100 text-gray-400 hover:bg-gray-200"
          }`}
        >
          {tag.charAt(0).toUpperCase() + tag.slice(1)}
        </button>
      ))}
    </div>
  );
}

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
