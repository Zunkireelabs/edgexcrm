"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trash2, UserCheck, Pencil, X, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { Lead, LeadNote, LeadChecklist, PipelineStage, Tenant, TenantEntity, Industry } from "@/types/database";
import type { LeadActivity } from "@/lib/supabase/queries";
import { ConvertLeadDialog } from "@/industries/it-agency/features/crm-contacts/components/convert-lead-dialog";
import { validateLeadIdentity } from "@/lib/leads/lead-validation";
import { resolveEntitlements } from "@/lib/api/entitlements";

import { ContactCard } from "./contact-card";
import { KeyInfoSection } from "./key-info-section";
import { LeadTabs } from "./lead-tabs";
import { ManagementPanel } from "./management-panel";
import { getLeadFullName } from "./lead-name";
import { ApplicationsCard } from "@/industries/education-consultancy/features/application-tracking/components/applications-card";

interface TeamMember {
  id: string;
  user_id: string;
  role: string;
  email: string;
}

interface LeadDetailV2Props {
  lead: Lead;
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
  canManageApplications?: boolean;
}

interface LeadDraft {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  intake_source: string;
  intake_campaign: string;
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
    intake_source: lead.intake_source || "",
    intake_campaign: lead.intake_campaign || "",
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
  canManageApplications,
}: LeadDetailV2Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const notesTabRef = useRef<{ focusComposer: () => void }>(null);
  const checklistRef = useRef<{ focusInput: () => void }>(null);

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

  // Edit mode state
  const [currentLead, setCurrentLead] = useState(lead);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState<LeadDraft>(() => makeDraft(lead));
  const [editErrors, setEditErrors] = useState<EditErrors>({});

  const isItAgency = tenant.industry_id === "it_agency";

  const isAdmin = role === "owner" || role === "admin";
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
    if (isAdmin) {
      fetchTeamMembers();
    }
  }, [isAdmin, fetchTeamMembers]);

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
    setActiveTab("notes");
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
        body: JSON.stringify({ status: newStage.slug }),
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
          <Link href="/leads">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">
              {getLeadFullName(currentLead)}
            </h1>
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
          />

          {/* Key Information (includes Stage, Assigned To, and all lead details) */}
          <KeyInfoSection
            lead={currentLead}
            stages={stages}
            currentStage={currentStage}
            stageId={stageId}
            assignedTo={assignedTo}
            teamMembers={teamMembers}
            isAdmin={isAdmin}
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
            customFields={customFields}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onNotesChange={handleNotesChange}
            onCustomFieldsChange={handleCustomFieldsChange}
            isAdmin={isAdmin}
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
          {tenant.industry_id === "education_consultancy" && currentLead.lead_type === "prospect" ? (
            <div className="space-y-4">
              <ApplicationsCard
                leadId={currentLead.id}
                canManage={canManageApplications ?? isAdmin}
              />
            </div>
          ) : (
            <ManagementPanel
              ref={checklistRef}
              lead={currentLead}
              checklists={checklists}
              isAdmin={isAdmin}
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
    </div>
  );
}
