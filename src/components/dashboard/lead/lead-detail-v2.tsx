"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trash2, UserCheck, Pencil, X, Check, Loader2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { createClient } from "@/lib/supabase/client";
import type { Lead, LeadList, LeadNote, LeadChecklist, PipelineStage, Tenant, TenantEntity, Industry } from "@/types/database";
import type { LeadActivity } from "@/lib/supabase/queries";
import { ConvertLeadDialog } from "@/industries/it-agency/features/crm-contacts/components/convert-lead-dialog";
import { validateLeadIdentity } from "@/lib/leads/lead-validation";
import { resolveEntitlements } from "@/lib/api/entitlements";
import { DEGREE_LEVELS } from "@/industries/_shared/features/lead-lists/taxonomies";
import { useEduTaxonomy } from "@/hooks/use-edu-taxonomy";

import { ContactCard } from "./contact-card";
import { KeyInfoSection } from "./key-info-section";
import { LeadTabs } from "./lead-tabs";
import { ManagementPanel } from "./management-panel";
import { getLeadFullName } from "./lead-name";
import { ApplicationsCard } from "@/industries/education-consultancy/features/application-tracking/components/applications-card";
import { ClassesCard } from "@/industries/education-consultancy/features/classes/components/classes-card";
import { ConsentCard } from "@/industries/education-consultancy/features/application-tracking/components/consent-card";
import { CheckInHistoryCard } from "@/industries/_shared/features/check-in/check-in-history-card";

interface TeamMember {
  id: string;
  user_id: string;
  role: string;
  email: string;
  name?: string | null;
}

interface LeadDetailV2Props {
  lead: Lead;
  memberNames?: Record<string, string>;
  notes: LeadNote[];
  checklists: LeadChecklist[];
  activities: LeadActivity[];
  stages: PipelineStage[];
  tenant: Tenant;
  role: string;
  userId: string;
  entity?: TenantEntity | null;
  industry?: Industry | null;
  userBranchId?: string | null;
  leadScope?: "all" | "own" | "team";
  canAssign?: boolean;
  canEditLeads?: boolean;
  /** Pre-filtered assignable members for the Assigned-To dropdown (full roster kept for display). */
  assignableMembers?: TeamMember[];
  /** Next-position members shown in the "Send to next" assignment picker. Empty = picker hidden. */
  nextPositionMembers?: TeamMember[];
  canManageApplications?: boolean;
  canEnroll?: boolean;
  leadLists?: LeadList[];
  activeLeadLists?: LeadList[];
  classesActive?: boolean;
  applicationsActive?: boolean;
  checkInActive?: boolean;
  consentEnabled?: boolean;
  consentSigned?: boolean;
}

interface LeadDraft {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  nationality: string;
  preferred_contact_method: string;
  // it_agency only
  salutation: string;
  company_name: string;
  company_email: string;
  designation: string;
  prospect_industry: string;
}

interface EditErrors {
  email?: string;
  phone?: string;
  general?: string;
}

function makeDraft(lead: Lead): LeadDraft {
  return {
    first_name: lead.first_name || "",
    last_name: lead.last_name || "",
    email: lead.email || "",
    phone: lead.phone || "",
    city: lead.city || "",
    country: lead.country || "",
    nationality: lead.nationality || "",
    preferred_contact_method: lead.preferred_contact_method || "",
    salutation: lead.salutation || "",
    company_name: lead.company_name || "",
    company_email: lead.company_email || "",
    designation: lead.designation || "",
    prospect_industry: lead.prospect_industry || "",
  };
}

export function LeadDetailV2({
  lead,
  memberNames = {},
  notes: initialNotes,
  checklists: initialChecklists,
  activities,
  stages,
  tenant,
  role,
  userId,
  entity,
  industry,
  userBranchId,
  leadScope,
  canAssign = false,
  canEditLeads = false,
  assignableMembers,
  nextPositionMembers,
  canManageApplications,
  canEnroll,
  leadLists,
  activeLeadLists,
  classesActive,
  applicationsActive,
  checkInActive,
  consentEnabled = false,
  consentSigned = false,
}: LeadDetailV2Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const notesTabRef = useRef<{ focusComposer: () => void }>(null);
  const checklistRef = useRef<{ focusInput: () => void }>(null);
  const { destinations: destOptions, fieldsOfStudy } = useEduTaxonomy();

  const [notes, setNotes] = useState(initialNotes);
  const [checklists, setChecklists] = useState(initialChecklists);
  const [customFields, setCustomFields] = useState<Record<string, unknown>>(lead.custom_fields || {});
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_status, setStatus] = useState(lead.status);
  const [stageId, setStageId] = useState(lead.stage_id);
  const [assignedTo, setAssignedTo] = useState(lead.assigned_to || "");
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState("activity");
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [convertedContactName, setConvertedContactName] = useState<string | null>(null);
  const [consentSignedState, setConsentSignedState] = useState(consentSigned);
  useEffect(() => { setConsentSignedState(consentSigned); }, [consentSigned]);

  // Qualify dialog state (education_consultancy only)
  const [qualifyOpen, setQualifyOpen] = useState(false);
  const [qualifyDests, setQualifyDests] = useState<string[]>([]);
  const [qualifyField, setQualifyField] = useState("");
  const [qualifyDegree, setQualifyDegree] = useState("");
  const [qualifyNote, setQualifyNote] = useState("");
  const [qualifyDestOpen, setQualifyDestOpen] = useState(false);
  const [qualifying, setQualifying] = useState(false);

  // Edit mode state
  const [currentLead, setCurrentLead] = useState(lead);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState<LeadDraft>(() => makeDraft(lead));
  const [editErrors, setEditErrors] = useState<EditErrors>({});

  const isItAgency = tenant.industry_id === "it_agency";

  const isAdmin = role === "owner" || role === "admin";
  // Position-derived edit capability: admins always, plus members whose position grants
  // canEditLeads. Gates the same lead working-data controls (stage, tasks) that isAdmin did.
  const canEdit = isAdmin || canEditLeads;
  // Note-editing gate: owner/admin, branch-manager, or the lead's own-scope assignee.
  // Author-of-the-note is a separate, per-note check made in NoteCard itself.
  const canManageNotes = isAdmin || leadScope === "team" || userId === currentLead.assigned_to;
  const maxBranches = resolveEntitlements({
    plan: tenant.plan,
    entitlement_overrides: tenant.entitlement_overrides,
  }).maxBranches;
  const currentStage = stages.find((s) => s.id === stageId);

  // Create email lookup map for activity display
  const teamMemberEmails = teamMembers.reduce<Record<string, string>>(
    (acc, member) => {
      acc[member.user_id] = member.email;
      return acc;
    },
    {}
  );

  // Seed with the server-resolved full roster (works for non-admins, who can't
  // call /api/v1/team), then overlay any client-fetched names.
  const teamMemberNames = teamMembers.reduce<Record<string, string>>(
    (acc, member) => {
      if (member.name) acc[member.user_id] = member.name;
      return acc;
    },
    { ...memberNames }
  );

  // Fetch team members for assignment
  const fetchTeamMembers = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/team");
      if (res.ok) {
        const json = await res.json();
        setTeamMembers(json.data || []);
      }
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    if (isAdmin || canAssign) {
      fetchTeamMembers();
    }
  }, [isAdmin, canAssign, fetchTeamMembers]);

  useEffect(() => {
    if (!lead.converted_contact_id || !isItAgency) return;
    fetch(`/api/v1/contacts/${lead.converted_contact_id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json?.data) {
          const c = json.data as { first_name?: string; last_name?: string };
          setConvertedContactName(`${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Contact");
        }
      })
      .catch(() => {});
  }, [lead.converted_contact_id, isItAgency]);

  // Opening a lead clears its notifications (e.g. "New lead"), like reading a
  // message thread clears its unread count. The sidebar/bell badges pick up the
  // change on their next poll.
  useEffect(() => {
    fetch("/api/v1/notifications/read-by-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ link: `/leads/${lead.id}` }),
    }).catch(() => {});
  }, [lead.id]);

  // Auto-open edit mode when ?edit=1 is present, then strip the param
  useEffect(() => {
    if (searchParams.get("edit") === "1") {
      setIsEditing(true);
      setDraft(makeDraft(currentLead));
      const url = new URL(window.location.href);
      url.searchParams.delete("edit");
      router.replace(url.pathname + url.search);
    }
  // Run once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startEditing = () => {
    setDraft(makeDraft(currentLead));
    setEditErrors({});
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditErrors({});
  };

  const updateDraft = (field: keyof LeadDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setEditErrors((prev) => {
      if (field === "email" || field === "phone") {
        const next = { ...prev };
        delete next[field];
        return next;
      }
      return prev;
    });
  };

  const validateDraft = (): boolean => {
    const errors: EditErrors = validateLeadIdentity({
      email: draft.email,
      firstName: draft.first_name,
      phone: draft.phone,
    });
    setEditErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateDraft()) return;

    // Build diff — only send changed fields
    const original = makeDraft(currentLead);
    const changedFields: Record<string, string | null> = {};
    for (const key of Object.keys(draft) as Array<keyof LeadDraft>) {
      const draftVal = draft[key] || null;
      const origVal = original[key] || null;
      if (draftVal !== origVal) {
        changedFields[key] = draftVal;
      }
    }

    if (Object.keys(changedFields).length === 0) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch(`/api/v1/leads/${currentLead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changedFields),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const msg = json?.error?.message || "Failed to save changes";
        toast.error(msg);
        return;
      }
      const json = await res.json();
      setCurrentLead(json.data as Lead);
      setIsEditing(false);
      toast.success("Lead updated");
    } catch {
      toast.error("Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  // Handlers
  const handleNoteClick = () => {
    // Notes now live in the Activity tab's Notes sub-tab; switch there, then
    // focusComposer routes through LeadTabs → ActivitiesPanel.openNotes(true).
    setActiveTab("activity");
    setTimeout(() => {
      notesTabRef.current?.focusComposer();
    }, 100);
  };

  const handleTaskClick = () => {
    setTimeout(() => {
      checklistRef.current?.focusInput();
    }, 100);
  };

  const handleStageChange = async (newStageId: string) => {
    const newStage = stages.find((s) => s.id === newStageId);
    if (!newStage) return;

    setStageId(newStageId);
    setStatus(newStage.slug);

    try {
      const res = await fetch(`/api/v1/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage_id: newStageId }),
      });
      if (!res.ok) throw new Error("Failed to update stage");
      toast.success("Stage updated");
    } catch {
      toast.error("Failed to update stage");
      setStageId(lead.stage_id);
      setStatus(lead.status);
    }
  };

  const handleAssignmentChange = async (newUserId: string) => {
    const value = newUserId === "unassigned" ? null : newUserId;
    setAssignedTo(value || "");

    try {
      const res = await fetch(`/api/v1/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigned_to: value }),
      });
      if (!res.ok) throw new Error();
      toast.success("Assignment updated");
    } catch {
      toast.error("Failed to update assignment");
      setAssignedTo(lead.assigned_to || "");
    }
  };

  const handleDeleteLead = async () => {
    if (!confirm("Are you sure you want to delete this lead? This cannot be undone.")) return;
    setDeleting(true);

    try {
      const res = await fetch(`/api/v1/leads/${lead.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete lead");
      toast.success("Lead deleted");
      router.push("/leads");
      router.refresh();
    } catch {
      toast.error("Failed to delete lead");
      setDeleting(false);
    }
  };

  const openQualifyDialog = () => {
    const leadWithEdu = currentLead as {
      destinations?: string[] | null;
      field_of_study?: string | null;
      degree_level?: string | null;
    };
    setQualifyDests(leadWithEdu.destinations ?? []);
    setQualifyField(leadWithEdu.field_of_study ?? "");
    setQualifyDegree(leadWithEdu.degree_level ?? "");
    setQualifyNote("");
    setQualifyDestOpen(false);
    setQualifyOpen(true);
  };

  const handleQualifySubmit = async () => {
    const qualifiedList = leadLists?.find((l) => l.slug === "qualified");
    if (!qualifiedList) {
      toast.error("Qualified list not found");
      return;
    }
    setQualifying(true);
    try {
      const res = await fetch(`/api/v1/leads/${currentLead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          list_id: qualifiedList.id,
          destinations: qualifyDests,
          field_of_study: qualifyField || null,
          degree_level: qualifyDegree || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to qualify lead");
      const json = await res.json();
      setCurrentLead(json.data as Lead);

      // Insert note if provided
      if (qualifyNote.trim()) {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("lead_notes").insert({
            lead_id: currentLead.id,
            user_id: user.id,
            user_email: user.email ?? "",
            content: qualifyNote.trim(),
          });
        }
      }

      toast.success(`Moved to ${qualifiedList.name}`);
      setQualifyOpen(false);
    } catch {
      toast.error("Failed to qualify lead");
    } finally {
      setQualifying(false);
    }
  };

  const handleNotesChange = (newNotes: LeadNote[]) => {
    setNotes(newNotes);
  };

  const handleChecklistsChange = (newChecklists: LeadChecklist[]) => {
    setChecklists(newChecklists);
  };

  const handleCustomFieldsChange = (newFields: Record<string, unknown>) => {
    setCustomFields(newFields);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">
                {getLeadFullName(currentLead)}
              </h1>
              {tenant.industry_id === "education_consultancy" && currentLead.display_id && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-gray-100 text-gray-600 font-medium">
                  {currentLead.display_id}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Submitted {new Date(currentLead.created_at).toLocaleDateString()} at{" "}
              {new Date(currentLead.created_at).toLocaleTimeString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isItAgency && !isEditing && (
            currentLead.converted_contact_id ? (
              <Link href={`/contacts/${currentLead.converted_contact_id}`}>
                <Button variant="outline" size="sm">
                  <UserCheck className="h-4 w-4 mr-2" />
                  Converted to {convertedContactName ?? "Contact"}
                </Button>
              </Link>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConvertDialogOpen(true)}
              >
                <UserCheck className="h-4 w-4 mr-2" />
                Convert to Contact
              </Button>
            )
          )}
          {!isEditing && (
            <Button
              variant="outline"
              size="sm"
              onClick={startEditing}
            >
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </Button>
          )}
          {isEditing && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={cancelEditing}
                disabled={isSaving}
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isSaving || Object.keys(editErrors).length > 0}
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                {isSaving ? "Saving..." : "Save"}
              </Button>
            </>
          )}
          {isAdmin && !isEditing && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteLead}
              disabled={deleting}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          )}
        </div>
      </div>

      {/* 3-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] xl:grid-cols-[280px_1fr_320px] gap-6">
        {/* Left Sidebar */}
        <div className="space-y-4">
          {/* Contact Card */}
          <ContactCard
            lead={currentLead}
            currentStage={currentStage}
            onNoteClick={handleNoteClick}
            onTaskClick={handleTaskClick}
            isEditing={isEditing}
            draft={draft}
            editErrors={editErrors}
            onDraftChange={updateDraft}
            industryId={tenant.industry_id}
          />

          {/* Key Information (includes Stage, Assigned To, and all lead details) */}
          <KeyInfoSection
            lead={currentLead}
            stages={stages}
            currentStage={currentStage}
            stageId={stageId}
            assignedTo={assignedTo}
            teamMembers={teamMembers}
            assignableMembers={assignableMembers}
            userId={userId}
            isAdmin={isAdmin}
            canEdit={canEdit}
            canAssign={canAssign}
            onStageChange={handleStageChange}
            onAssignmentChange={handleAssignmentChange}
            entity={entity}
            industry={industry}
            industryId={tenant.industry_id}
            isEditing={isEditing}
            draft={draft}
            editErrors={editErrors}
            onDraftChange={updateDraft}
            maxBranches={maxBranches}
            userBranchId={userBranchId ?? null}
            leadScope={leadScope ?? "all"}
            onLeadTypeChange={async (newType) => {
              try {
                await fetch(`/api/v1/leads/${currentLead.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ lead_type: newType }),
                });
                toast.success(`Changed to ${newType}`);
              } catch {
                toast.error("Failed to update lead type");
              }
            }}
            leadLists={leadLists}
            activeLeadLists={activeLeadLists}
            nextPositionMembers={nextPositionMembers}
            onListChange={async (listId, archiveReason, assignToUserId) => {
              const prevLead = currentLead;
              const prevStageId = stageId;
              const targetList = leadLists?.find((l) => l.id === listId);
              const newLeadType = targetList?.slug === "prospects" ? "prospect" : "lead";
              setCurrentLead((prev) => ({
                ...prev,
                list_id: listId,
                lead_type: newLeadType,
                archive_reason: archiveReason ?? null,
                ...(assignToUserId !== undefined ? { assigned_to: assignToUserId } : {}),
              } as Lead));
              if (assignToUserId !== undefined) setAssignedTo(assignToUserId ?? "");
              try {
                const body: Record<string, unknown> = { list_id: listId, archive_reason: archiveReason ?? null };
                if (assignToUserId !== undefined) body.assigned_to = assignToUserId;
                const res = await fetch(`/api/v1/leads/${currentLead.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(body),
                });
                if (!res.ok) throw new Error("Failed to move lead");
                const json = await res.json();
                const updated = json.data as Lead;
                // Sync stage_id — server resets it to default for new list's pipeline (or null if no pipeline)
                if (updated.stage_id !== stageId) {
                  setStageId(updated.stage_id);
                  setCurrentLead((prev) => ({ ...prev, stage_id: updated.stage_id, status: updated.status } as Lead));
                }
                toast.success(`Moved to ${targetList?.name ?? "list"}`);
              } catch {
                setCurrentLead(prevLead);
                setStageId(prevStageId);
                if (assignToUserId !== undefined) setAssignedTo(prevLead.assigned_to ?? "");
                toast.error("Failed to move lead");
              }
            }}
            onSaveTripFields={async (fields) => {
              // Merge against live state (not the stale `lead` prop) so a trip
              // save doesn't clobber an itinerary saved earlier this session.
              const merged = { ...customFields, ...fields };
              const res = await fetch(`/api/v1/leads/${currentLead.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ custom_fields: merged }),
              });
              if (!res.ok) throw new Error("Failed to save trip details");
              setCustomFields(merged);
              toast.success("Trip details saved");
            }}
            onSaveStudyFields={async (fields) => {
              const res = await fetch(`/api/v1/leads/${currentLead.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(fields),
              });
              if (!res.ok) throw new Error("Failed to save study details");
              const json = await res.json();
              setCurrentLead(json.data as Lead);
              toast.success("Study details saved");
            }}
            onSaveSourceFields={async (fields) => {
              const res = await fetch(`/api/v1/leads/${currentLead.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(fields),
              });
              if (!res.ok) throw new Error("Failed to save source details");
              const json = await res.json();
              setCurrentLead(json.data as Lead);
              toast.success("Lead source saved");
            }}
            onQualify={openQualifyDialog}
          />
        </div>

        {/* Center Content */}
        <div className="min-w-0">
          <LeadTabs
            ref={notesTabRef}
            lead={currentLead}
            notes={notes}
            activities={activities}
            teamMemberEmails={teamMemberEmails}
            teamMemberNames={teamMemberNames}
            customFields={customFields}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onNotesChange={handleNotesChange}
            onCustomFieldsChange={handleCustomFieldsChange}
            checklists={checklists}
            onChecklistsChange={handleChecklistsChange}
            isAdmin={isAdmin}
            canEdit={canEdit}
            canManageNotes={canManageNotes}
            currentUserId={userId}
            industryId={tenant.industry_id}
            tenantName={tenant.name}
            tenantLogoUrl={tenant.logo_url}
            onSaveItinerary={async (itinerary) => {
              // Merge against live state (not the stale `lead` prop) so saving the
              // itinerary doesn't clobber trip fields saved earlier this session.
              const merged = { ...customFields, itinerary };
              const res = await fetch(`/api/v1/leads/${currentLead.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ custom_fields: merged }),
              });
              if (!res.ok) throw new Error("Failed to save itinerary");
              setCustomFields(merged);
            }}
          />
        </div>

        {/* Right Sidebar */}
        <div className="lg:col-span-full xl:col-span-1">
          {tenant.industry_id === "education_consultancy" ? (
            <div className="space-y-4">
              {applicationsActive ? (
                <>
                  {consentEnabled && (
                    <ConsentCard
                      leadId={currentLead.id}
                      tenantId={tenant.id}
                      consentEnabled={consentEnabled}
                      consentSigned={consentSigned}
                      canManage={canManageApplications ?? isAdmin}
                      onSignedChange={setConsentSignedState}
                      feeStatus={currentLead.pre_app_fee_status}
                      feeAmount={currentLead.pre_app_fee_amount}
                      feeNotes={currentLead.pre_app_fee_notes}
                    />
                  )}
                  <ApplicationsCard
                    leadId={currentLead.id}
                    canManage={canManageApplications ?? isAdmin}
                    disabled={consentEnabled && !consentSignedState}
                  />
                </>
              ) : (
                <ManagementPanel
                  ref={checklistRef}
                  lead={currentLead}
                  checklists={checklists}
                  isAdmin={isAdmin}
                  canEdit={canEdit}
                  onChecklistsChange={handleChecklistsChange}
                />
              )}
              {classesActive && (
                <ClassesCard
                  leadId={currentLead.id}
                  canManage={canEnroll ?? isAdmin}
                />
              )}
              {checkInActive && <CheckInHistoryCard leadId={currentLead.id} />}
            </div>
          ) : (
            <ManagementPanel
              ref={checklistRef}
              lead={currentLead}
              checklists={checklists}
              isAdmin={isAdmin}
              canEdit={canEdit}
              onChecklistsChange={handleChecklistsChange}
            />
          )}
        </div>
      </div>

      {isItAgency && !lead.converted_contact_id && (
        <ConvertLeadDialog
          leadId={currentLead.id}
          leadFirstName={currentLead.first_name}
          leadLastName={currentLead.last_name}
          leadEmail={currentLead.email}
          leadPhone={currentLead.phone}
          leadAccountId={currentLead.account_id}
          open={convertDialogOpen}
          onOpenChange={setConvertDialogOpen}
        />
      )}

      {/* Qualify dialog — education_consultancy only */}
      <Dialog open={qualifyOpen} onOpenChange={setQualifyOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Qualify Lead</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Destinations multi-select */}
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Interested Destinations</p>
              <button
                type="button"
                onClick={() => setQualifyDestOpen((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 border border-input rounded-md text-sm bg-background"
              >
                <span className={qualifyDests.length === 0 ? "text-muted-foreground" : ""}>
                  {qualifyDests.length === 0 ? "Select destinations" : qualifyDests.join(", ")}
                </span>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${qualifyDestOpen ? "rotate-180" : ""}`} />
              </button>
              {qualifyDestOpen && (
                <div className="border border-input rounded-md p-2 grid grid-cols-2 gap-1.5 bg-background">
                  {destOptions.map((dest) => (
                    <div key={dest} className="flex items-center gap-2">
                      <Checkbox
                        id={`qd-${dest}`}
                        checked={qualifyDests.includes(dest)}
                        onCheckedChange={() =>
                          setQualifyDests((prev) =>
                            prev.includes(dest) ? prev.filter((d) => d !== dest) : [...prev, dest]
                          )
                        }
                      />
                      <label htmlFor={`qd-${dest}`} className="text-sm cursor-pointer">{dest}</label>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Field of Study */}
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Field of Study</p>
              <Select value={qualifyField || "__none__"} onValueChange={(v) => setQualifyField(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select field" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    <span className="text-muted-foreground">Not specified</span>
                  </SelectItem>
                  {fieldsOfStudy.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Degree Level */}
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Degree Level</p>
              <Select value={qualifyDegree || "__none__"} onValueChange={(v) => setQualifyDegree(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    <span className="text-muted-foreground">Not specified</span>
                  </SelectItem>
                  {DEGREE_LEVELS.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Optional note */}
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Note <span className="text-muted-foreground font-normal">(optional)</span></p>
              <textarea
                value={qualifyNote}
                onChange={(e) => setQualifyNote(e.target.value)}
                placeholder="Add a note about this qualification…"
                rows={3}
                className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setQualifyOpen(false)} disabled={qualifying}>
              Cancel
            </Button>
            <Button onClick={handleQualifySubmit} disabled={qualifying}>
              {qualifying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Qualifying…
                </>
              ) : (
                "Qualify →"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
