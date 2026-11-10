"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogKeyHint,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CaretRightIcon,
  CircleNotchIcon,
  PlusIcon,
  WarningCircleIcon,
} from "@/components/icons";
import { toast } from "sonner";
import type { Branch, LeadList, PipelineStage, TenantEntity, UserRole } from "@/types/database";
import {
  PROSPECT_INDUSTRIES,
} from "@/industries/it-agency/leads/prospect-industries";
import { SALUTATIONS } from "@/industries/it-agency/leads/salutations";
import {
  INTAKE_SOURCES,
} from "@/industries/_shared/features/lead-lists/taxonomies";
import { useEduTaxonomy } from "@/hooks/use-edu-taxonomy";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { DestinationsMultiSelect } from "@/components/dashboard/destinations-multi-select";
import { positionsForStage } from "@/industries/education-consultancy/lead-assignment-by-stage";
import { validateLeadIdentity } from "@/lib/leads/lead-validation";
import { COUNTRY_CODES } from "@/lib/country-codes";
import { parseStoredPhone } from "@/lib/phone-utils";
import {
  ACADEMIC_LEVELS,
  TEST_TYPES,
  hasProspectQualification,
  canBypassProspectQualification,
} from "@/lib/leads/prospect-qualification";

interface TeamMember {
  user_id: string;
  email: string;
  role: string;
  name: string;
  canEditLeads?: boolean;
  position_slug?: string | null;
  branch_id?: string | null;
}

// Stable reference for the `leadLists` default — an inline `= []` default creates a new
// array every render, which re-triggers the pre-select effect below (it depends on
// `leadLists`) in an infinite loop whenever a caller (e.g. KanbanBoard) omits the prop.
const EMPTY_LEAD_LISTS: LeadList[] = [];

interface AddLeadSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  pipelineId?: string;
  stages: PipelineStage[];
  leadLists?: LeadList[];
  teamMembers: TeamMember[];
  entities?: TenantEntity[];
  entityLabel?: string;
  role: UserRole;
  currentUserId: string;
  industryId?: string | null;
  branches?: Branch[];
  selectedBranchId?: string | null;
  userBranchId?: string | null;
  /** Current user's position slug — gates the education stage→team assignment cascade. */
  currentUserPositionSlug?: string | null;
  /** Id of the current stage view (when it's a visible, non-staging/archive list) —
   *  pre-selects the Stage dropdown so the new lead lands where the creator is looking. */
  defaultListId?: string;
  /** When set, the Stage is locked to this list (the page the user opened Add Lead from):
   *  a read-only label instead of the dropdown, and the new lead can only land here.
   *  Works for staging/archive lists the dropdown normally hides. */
  lockedList?: { id: string; name: string; is_archive: boolean };
}

interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  stageId: string;
  listId: string;
  assignedTo: string;
  entityId: string;
  branchId: string;
  intakeSource: string;
  intakeMedium: string;
  intakeCampaign: string;
  preferredContact: string;
  initialNotes: string;
  companyName: string;
  designation: string;
  prospectIndustry: string;
  ownerId: string;
  salutation: string;
  companyEmail: string;
  // education_consultancy only
  destinations: string[];
  fieldOfStudy: string;
  degreeLevel: string;
  intakeMonth: string;
  intakeYear: string;
  archiveReason: string;
}

interface FormErrors {
  firstName?: string;
  email?: string;
  phone?: string;
  general?: string;
  archiveReason?: string;
  listId?: string;
}

const CONTACT_METHODS = [
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "any", label: "Any" },
];

const initialFormData: FormData = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  city: "",
  country: "",
  stageId: "",
  listId: "",
  assignedTo: "",
  entityId: "",
  branchId: "",
  intakeSource: "manual_entry",
  intakeMedium: "dashboard",
  intakeCampaign: "",
  preferredContact: "",
  initialNotes: "",
  companyName: "",
  designation: "",
  prospectIndustry: "",
  ownerId: "",
  salutation: "",
  companyEmail: "",
  destinations: [],
  fieldOfStudy: "",
  degreeLevel: "",
  intakeMonth: "",
  intakeYear: "",
  archiveReason: "",
};

export function AddLeadSheet({
  open,
  onOpenChange,
  tenantId,
  pipelineId,
  stages,
  leadLists = EMPTY_LEAD_LISTS,
  teamMembers,
  entities = [],
  entityLabel = "Entity",
  role,
  currentUserId,
  industryId,
  branches = [],
  selectedBranchId = null,
  userBranchId = null,
  currentUserPositionSlug = null,
  defaultListId,
  lockedList,
}: AddLeadSheetProps) {
  const router = useRouter();
  // Owner/admin + branch managers skip the Prospects academic-qualification dialog.
  const bypassQualification = canBypassProspectQualification(
    role === "owner" ? "owner" : role === "admin" ? "admin" : "member",
    currentUserPositionSlug,
  );
  const { destinations: destOptions, fieldsOfStudy, studyLevels, intakeMonths, intakeYears } = useEduTaxonomy();
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [academicsOpen, setAcademicsOpen] = useState(false);
  const [academicsError, setAcademicsError] = useState(false);
  // EDGEX-145: keep the dialog open and reset the form after a successful add.
  const [addAnother, setAddAnother] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [academics, setAcademics] = useState<Record<string, string>>({});
  const [testScores, setTestScores] = useState<Record<string, string>>({});
  const updateAcademic = (col: string, value: string) =>
    setAcademics((prev) => ({ ...prev, [col]: value }));
  const updateTestScore = (col: string, value: string) =>
    setTestScores((prev) => ({ ...prev, [col]: value }));

  const isAdmin = role === "owner" || role === "admin";
  // Education: Lead Source / Campaign are owner/admin-only. Other industries keep them for everyone.
  const canSetLeadSource = isAdmin || industryId !== "education_consultancy";
  const defaultStage = stages.find((s) => s.is_default) || stages[0];

  // Fresh form: used when the dialog opens and after a successful "Add another".
  const resetForm = () => {
    // Only pre-select a Stage the dropdown will actually offer (mirrors its own
    // !is_staging && !is_archive filter) — an id from a hidden/archive list, or one
    // that's since disappeared from leadLists, must fall back to blank, not a dead value.
    const validDefaultListId =
      defaultListId && leadLists.some((l) => l.id === defaultListId && !l.is_staging && !l.is_archive)
        ? defaultListId
        : "";
    setFormData({
      ...initialFormData,
      stageId: defaultStage?.id || "",
      listId: lockedList ? lockedList.id : validDefaultListId,
      assignedTo: role === "staff" ? currentUserId : "",
      ownerId: currentUserId,
      // Always seed from creator's own branch first; fall back to active branch switcher
      branchId: userBranchId || selectedBranchId || "",
    });
    setErrors({});
    setIsDirty(false);
    setSourceOpen(false);
    setNotesOpen(false);
    setAcademicsOpen(false);
    setAcademicsError(false);
    setAcademics({});
    setTestScores({});
  };

  useEffect(() => {
    if (open) {
      resetForm();
      setAddAnother(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultStage?.id, role, currentUserId, isAdmin, userBranchId, selectedBranchId, defaultListId, leadLists]);

  const updateField = (field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setIsDirty(true);
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const setDestinations = (next: string[]) => {
    setFormData((prev) => ({ ...prev, destinations: next }));
    setIsDirty(true);
  };

  const validate = (): boolean => {
    const newErrors: FormErrors = validateLeadIdentity({
      email: formData.email,
      firstName: formData.firstName,
      phone: formData.phone,
      industryId,
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    if (
      industryId === "education_consultancy" &&
      !bypassQualification &&
      selectedStageSlug === "prospects" &&
      !hasProspectQualification(academics)
    ) {
      setAcademicsOpen(true);
      setAcademicsError(true);
      toast.error(
        "Enter the student's highest qualification (%/GPA) before moving to Prospects."
      );
      return;
    }
    setAcademicsError(false);

    if (lockedList?.is_archive && !formData.archiveReason.trim()) {
      setErrors({ archiveReason: "Archive reason is required." });
      return;
    }

    // Non-admins can't see the staging list ("New Leads"). Without a Stage the lead
    // would be routed there and disappear from the creator's view.
    if (
      isEducation &&
      !isAdmin &&
      !lockedList &&
      !formData.listId &&
      leadLists.some((l) => !l.is_staging && !l.is_archive)
    ) {
      setErrors({ listId: "Choose a stage so the lead stays in your view." });
      return;
    }

    setIsSubmitting(true);
    setErrors({});

    try {
      const { dialCode } = parseStoredPhone(formData.phone || "");
      const derivedCountry = COUNTRY_CODES.find((cc) => cc.dialCode === dialCode)?.label || null;

      const payload = {
        tenant_id: tenantId,
        pipeline_id: pipelineId || undefined,
        first_name: formData.firstName || null,
        last_name: formData.lastName || null,
        email: formData.email || null,
        phone: formData.phone || null,
        city: formData.city || null,
        country: derivedCountry,
        list_id: formData.listId || undefined,
        archive_reason: lockedList?.is_archive ? formData.archiveReason.trim() : undefined,
        stage_id: formData.stageId || undefined,
        assigned_to: formData.assignedTo || null,
        entity_id: formData.entityId || null,
        branch_id: formData.branchId || null,
        // Lead Source is owner/admin-only for education: everyone else there gets the default.
        intake_source: (canSetLeadSource && formData.intakeSource) || "manual_entry",
        intake_medium: "dashboard",
        tags: industryId === "education_consultancy" ? ["student"] : [],
        intake_campaign: (canSetLeadSource && formData.intakeCampaign) || null,
        preferred_contact_method: formData.preferredContact || null,
        custom_fields: formData.initialNotes
          ? { initial_notes: formData.initialNotes }
          : {},
        company_name: industryId === "it_agency" ? (formData.companyName || null) : undefined,
        designation: industryId === "it_agency" ? (formData.designation || null) : undefined,
        prospect_industry: industryId === "it_agency" ? (formData.prospectIndustry || null) : undefined,
        owner_id: industryId === "it_agency" ? (formData.ownerId || null) : undefined,
        salutation: industryId === "it_agency" ? (formData.salutation || null) : undefined,
        company_email: industryId === "it_agency" ? (formData.companyEmail || null) : undefined,
        destinations: industryId === "education_consultancy" ? formData.destinations : undefined,
        field_of_study: industryId === "education_consultancy" ? (formData.fieldOfStudy || null) : undefined,
        degree_level: industryId === "education_consultancy" ? (formData.degreeLevel || null) : undefined,
        intake_term: industryId === "education_consultancy"
          ? ([formData.intakeMonth, formData.intakeYear].filter(Boolean).join(" ") || null)
          : undefined,
        ...(industryId === "education_consultancy" ? { ...academics, ...testScores } : {}),
        is_final: true,
        step: 1,
      };

      const response = await fetch("/api/v1/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || "Failed to create lead");
      }

      toast.success("Lead created successfully", {
        description: `${formData.firstName || formData.email || "New lead"} has been added.`,
        action: {
          label: "View",
          onClick: () => router.push(`/leads/${data.data.id}`),
        },
      });

      if (addAnother) {
        resetForm();
        bodyRef.current?.closest("[data-slot=dialog-scroll]")?.scrollTo({ top: 0 });
        setTimeout(() => document.getElementById("firstName")?.focus(), 0);
      } else {
        onOpenChange(false);
      }
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create lead";
      setErrors({ general: message });
      toast.error("Failed to create lead", { description: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (isDirty && !isSubmitting) {
      if (confirm("You have unsaved changes. Discard them?")) {
        onOpenChange(false);
      }
    } else {
      onOpenChange(false);
    }
  };

  // Caller passes a pre-chain-filtered set; keep canEditLeads guard as a safety net.
  const assignableMembers = teamMembers.filter((m) => m.canEditLeads !== false);

  // ── Education: stage-cascaded, branch-scoped assignment ──────────────────
  // For education tenants the "Assigned To" options are driven by the chosen Stage
  // (which positions handle that stage) intersected with the selected Branch, plus that
  // branch's manager. Admin picks Branch first; a branch-manager creates within their own
  // branch (no Branch field). All of this is gated to education — it_agency is untouched.
  const isEducation = industryId === "education_consultancy";
  const isBranchManager = currentUserPositionSlug === "branch-manager";
  const canPickAssignee = isAdmin || (isEducation && isBranchManager);
  // Whose branch scopes the assignee list: admin uses the picked branch, others their own.
  const effectiveBranchId = isAdmin ? (formData.branchId || null) : (userBranchId || null);
  const selectedStageSlug = formData.listId
    ? (leadLists.find((l) => l.id === formData.listId)?.slug ?? null)
    : null;
  const eduAllowedPositions = positionsForStage(selectedStageSlug);
  const selectedBranch = effectiveBranchId
    ? branches.find((b) => b.id === effectiveBranchId) ?? null
    : null;

  const eduAssignableMembersScoped = !isEducation
    ? assignableMembers
    : !selectedStageSlug
      ? [] // no Stage chosen yet → nothing to assign to
      : assignableMembers.filter((m) => {
          const inBranch = !effectiveBranchId || m.branch_id === effectiveBranchId;
          const positionAllowed =
            !!m.position_slug && eduAllowedPositions.includes(m.position_slug);
          const isSelectedBranchMgr =
            !!selectedBranch && m.user_id === selectedBranch.manager_user_id;
          // Branch manager of the selected branch is always assignable; everyone else must
          // both hold an allowed position AND belong to the selected branch.
          return isSelectedBranchMgr || (positionAllowed && inBranch);
        });
  // Admins are always assignable at any education stage, appended after the normal team.
  const eduAssignableMembers =
    isEducation && selectedStageSlug
      ? [
          ...eduAssignableMembersScoped,
          ...assignableMembers.filter(
            (m) => m.role === "admin" && !eduAssignableMembersScoped.some((s) => s.user_id === m.user_id),
          ),
        ]
      : eduAssignableMembersScoped;

  const assigneeOptions = isEducation ? eduAssignableMembers : assignableMembers;
  // "Role · Branch" secondary text for the people picker.
  const assigneeSecondary = (m: TeamMember) => {
    const role = (m.position_slug || m.role || "").replace(/[-_]/g, " ");
    const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : "";
    const branch = m.branch_id ? branches.find((b) => b.id === m.branch_id)?.name : "";
    return [roleLabel, branch].filter(Boolean).join(" · ") || undefined;
  };
  const assigneeDisabled =
    isSubmitting || !canPickAssignee || (isEducation && !formData.listId);

  // Clearing a stale assignee when Stage/Branch changes (education cascade only).
  const updateListId = (value: string) => {
    if (isEducation) {
      setFormData((prev) => ({ ...prev, listId: value, assignedTo: "" }));
      setIsDirty(true);
    } else {
      updateField("listId", value);
    }
  };
  const updateBranchId = (value: string) => {
    if (isEducation) {
      setFormData((prev) => ({ ...prev, branchId: value, assignedTo: "" }));
      setIsDirty(true);
    } else {
      updateField("branchId", value);
    }
  };

  // Education admin always sees a Branch field (Admizz is multi-branch); it comes first.
  const showEduBranchField = isEducation && isAdmin && branches.length >= 1;

  // ── Shared render helpers ────────────────────────────────────────────────

  const renderEmailPhoneRow = () => (
    <div className="grid grid-cols-1 gap-x-3 gap-y-5 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="email" className="text-xs text-gray-600">
          Email
        </Label>
        <Input
          id="email"
          type="email"
          value={formData.email}
          onChange={(e) => updateField("email", e.target.value)}
          placeholder="Set email"
          disabled={isSubmitting}
          className={errors.email ? "border-red-500" : ""}
        />
        {errors.email && (
          <p className="text-xs text-red-500">{errors.email}</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="phone" className="text-xs text-gray-600">
          Phone
        </Label>
        <PhoneInput
          value={formData.phone}
          onChange={(v) => updateField("phone", v)}
          disabled={isSubmitting}
          error={!!errors.phone}
          placeholder="Set phone number"
        />
        {errors.phone && (
          <p className="text-xs text-red-500">{errors.phone}</p>
        )}
      </div>
    </div>
  );

  const renderLocationRow = () => (
    <div className="space-y-1.5">
      <Label htmlFor="city" className="text-xs text-gray-600">
        City
      </Label>
      <Input
        id="city"
        value={formData.city}
        onChange={(e) => updateField("city", e.target.value)}
        placeholder="Set city"
        disabled={isSubmitting}
      />
    </div>
  );

  const renderAssignmentSection = () => (
    <div className="flex flex-col gap-5 [&>h3]:-mb-2">
      <h3 className="pl-1 text-[13px] font-medium text-ds-ink">Assignment &amp; Status</h3>

      {/* Education admin: Branch is chosen first and scopes the assignee list */}
      {showEduBranchField && (
        <div className="space-y-1.5">
          <Label htmlFor="branchId" className="text-xs text-gray-600">
            Branch
          </Label>
          <SearchableSelect
            options={[{ value: "__none__", label: "No branch" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
            value={formData.branchId}
            onValueChange={(v) => updateBranchId(v === "__none__" ? "" : v)}
            placeholder="Select branch"
            searchPlaceholder="Search branches…"
            disabled={isSubmitting}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-x-3 gap-y-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="stage" className="text-xs text-gray-600">
            Stage
          </Label>
          {lockedList ? (
            <>
              <div
                className="flex h-9 w-full items-center rounded-md border border-input bg-gray-50 px-3 text-sm text-gray-700"
                aria-readonly="true"
              >
                {lockedList.name}
              </div>
              {lockedList.is_archive && (
                <div className="space-y-1.5 pt-2">
                  <Label htmlFor="archiveReason" className="text-xs text-gray-600">
                    Archive reason <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="archiveReason"
                    value={formData.archiveReason}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, archiveReason: e.target.value }))
                    }
                    placeholder="Why is this lead being archived?"
                    disabled={isSubmitting}
                  />
                  {errors.archiveReason && (
                    <p className="text-xs text-red-500">{errors.archiveReason}</p>
                  )}
                </div>
              )}
            </>
          ) : (
            <SearchableSelect
              options={leadLists.filter((l) => !l.is_staging && !l.is_archive).map((list) => ({ value: list.id, label: list.name }))}
              value={formData.listId}
              onValueChange={updateListId}
              placeholder="Select stage"
              searchPlaceholder="Search stages…"
              disabled={isSubmitting}
            />
          )}
          {errors.listId && <p className="text-xs text-red-500">{errors.listId}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="assignedTo" className="text-xs text-gray-600">
            Assigned to
            {!canPickAssignee && (
              <span className="ml-1 text-gray-400">(auto)</span>
            )}
          </Label>
          <SearchableSelect
            options={[
              { value: "__none__", label: "Unassigned" },
              ...assigneeOptions.map((member) => ({
                value: member.user_id,
                label: member.name + (member.user_id === currentUserId ? " (You)" : ""),
                secondary: assigneeSecondary(member),
                icon: (
                  <span
                    aria-hidden
                    className="grid size-4 shrink-0 place-items-center rounded-full bg-ds-hover text-[9px] font-semibold text-ds-muted"
                  >
                    {member.name.trim().slice(0, 1).toUpperCase()}
                  </span>
                ),
              })),
            ]}
            value={formData.assignedTo}
            onValueChange={(v) => updateField("assignedTo", v === "__none__" ? "" : v)}
            placeholder={isEducation && !formData.listId ? "Select a stage first" : "Select team member"}
            searchPlaceholder="Find someone…"
            disabled={assigneeDisabled}
          />
        </div>
      </div>

      {/* Branch picker — non-education tenants with >1 branch (original behavior) */}
      {!isEducation && branches.length > 1 && (
        <div className="space-y-1.5">
          <Label htmlFor="branchId" className="text-xs text-gray-600">
            Branch
            {userBranchId && (
              <span className="ml-1 text-gray-400">(auto)</span>
            )}
          </Label>
          <SearchableSelect
            options={[{ value: "__none__", label: "No branch" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
            value={formData.branchId}
            onValueChange={(v) => updateField("branchId", v === "__none__" ? "" : v)}
            placeholder="No branch"
            searchPlaceholder="Search branches…"
            disabled={isSubmitting || !!userBranchId}
          />
        </div>
      )}

      {entities.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="entity" className="text-xs text-gray-600">
            {entityLabel}
          </Label>
          <SearchableSelect
            options={[{ value: "__none__", label: "None" }, ...entities.filter((e) => e.is_active).map((entity) => ({ value: entity.id, label: entity.name }))]}
            value={formData.entityId}
            onValueChange={(v) => updateField("entityId", v === "__none__" ? "" : v)}
            placeholder={`Select ${entityLabel.toLowerCase()}`}
            searchPlaceholder="Search…"
            disabled={isSubmitting}
          />
        </div>
      )}
    </div>
  );

  const renderCollapsibles = () => (
    <>
      <Collapsible open={sourceOpen} onOpenChange={setSourceOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 pl-1 text-[13px] font-medium text-ds-ink">
          <CaretRightIcon
            className={`h-4 w-4 transition-transform ${
              sourceOpen ? "rotate-90" : ""
            }`}
          />
          {canSetLeadSource ? "Lead Source" : "Contact Preference"}
          <span className="text-xs text-gray-400 font-normal">(optional)</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-5 pt-3">
          <div className="grid grid-cols-1 gap-x-3 gap-y-5 sm:grid-cols-2">
            {canSetLeadSource && (
            <div className="space-y-1.5">
              <Label htmlFor="source" className="text-xs text-gray-600">
                Source
              </Label>
              <SearchableSelect
                options={INTAKE_SOURCES.map((s) => ({ value: s.value, label: s.label }))}
                value={formData.intakeSource}
                onValueChange={(v) => updateField("intakeSource", v)}
                placeholder="Select source"
                searchPlaceholder="Search sources…"
                disabled={isSubmitting}
              />
            </div>
            )}
            {/* The client dropped Preferred Contact for education (one less field for counselors to fill). */}
            {!isEducation && (
            <div className="space-y-1.5">
              <Label htmlFor="preferredContact" className="text-xs text-gray-600">
                Preferred Contact
              </Label>
              <SearchableSelect
                options={CONTACT_METHODS.map((m) => ({ value: m.value, label: m.label }))}
                value={formData.preferredContact}
                onValueChange={(v) => updateField("preferredContact", v)}
                placeholder="Select method"
                searchPlaceholder="Search methods…"
                disabled={isSubmitting}
              />
            </div>
            )}
          </div>
          {canSetLeadSource && (
          <div className="space-y-1.5">
            <Label htmlFor="campaign" className="text-xs text-gray-600">
              Campaign / Referrer
            </Label>
            <Input
              id="campaign"
              value={formData.intakeCampaign}
              onChange={(e) => updateField("intakeCampaign", e.target.value)}
              placeholder="e.g., Spring 2024 Fair, John Smith referral"
              disabled={isSubmitting}
            />
          </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      <Collapsible open={notesOpen} onOpenChange={setNotesOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 pl-1 text-[13px] font-medium text-ds-ink">
          <CaretRightIcon
            className={`h-4 w-4 transition-transform ${
              notesOpen ? "rotate-90" : ""
            }`}
          />
          Initial Notes
          <span className="text-xs text-gray-400 font-normal">(optional)</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <textarea
            value={formData.initialNotes}
            onChange={(e) => updateField("initialNotes", e.target.value)}
            placeholder="Add any initial notes about this lead..."
            rows={3}
            disabled={isSubmitting}
            className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </CollapsibleContent>
      </Collapsible>

      {industryId === "education_consultancy" && (
        <Collapsible open={academicsOpen} onOpenChange={setAcademicsOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 pl-1 text-[13px] font-medium text-ds-ink">
            <CaretRightIcon
              className={`h-4 w-4 transition-transform ${
                academicsOpen ? "rotate-90" : ""
              }`}
            />
            Academic &amp; test details
            <span className="text-xs text-gray-400 font-normal">(optional)</span>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2">
            <div className="rounded-md border bg-muted/30 p-3 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Academic Qualification
              </p>
              {ACADEMIC_LEVELS.map((level) => (
                <div key={level.key} className="space-y-1">
                  <Label className="text-xs text-gray-600">{level.label}</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      placeholder="%/GPA"
                      value={academics[`${level.key}_gpa`] || ""}
                      onChange={(e) => updateAcademic(`${level.key}_gpa`, e.target.value)}
                      disabled={isSubmitting}
                      className={`h-9 text-sm ${
                        academicsError && level.gateEligible ? "border-red-500 ring-2 ring-red-200" : ""
                      }`}
                    />
                    <Input
                      placeholder="School / College"
                      value={academics[`${level.key}_institution`] || ""}
                      onChange={(e) => updateAcademic(`${level.key}_institution`, e.target.value)}
                      disabled={isSubmitting}
                      className="h-9 text-sm"
                    />
                    <Input
                      placeholder="Passed year"
                      inputMode="numeric"
                      value={academics[`${level.key}_passed_year`] || ""}
                      onChange={(e) => updateAcademic(`${level.key}_passed_year`, e.target.value)}
                      disabled={isSubmitting}
                      className="h-9 text-sm"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-md border bg-muted/30 p-3 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Test Report &amp; Score
              </p>
              <div className="grid grid-cols-2 gap-3">
                {TEST_TYPES.map((t) => (
                  <div key={t.key} className="space-y-1">
                    <Label className="text-xs text-gray-600">{t.label}</Label>
                    <Input
                      placeholder="Score"
                      value={testScores[`${t.key}_score`] || ""}
                      onChange={(e) => updateTestScore(`${t.key}_score`, e.target.value)}
                      disabled={isSubmitting}
                      className="h-9 text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </>
  );

  // ── Layout ───────────────────────────────────────────────────────────────

  const renderItAgencyForm = () => (
    <>
      {/* 1. Lead Information */}
      <div className="flex flex-col gap-5 [&>h3]:-mb-2">
        <h3 className="pl-1 text-[13px] font-medium text-ds-ink">Lead Information</h3>
        <div className="grid grid-cols-1 gap-x-3 gap-y-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ownerId" className="text-xs text-gray-600">
              Lead Owner
              {!isAdmin && (
                <span className="ml-1 text-gray-400">(auto)</span>
              )}
            </Label>
            <SearchableSelect
              options={assignableMembers.map((member) => ({ value: member.user_id, label: member.name + (member.user_id === currentUserId ? " (You)" : "") }))}
              value={formData.ownerId || currentUserId}
              onValueChange={(v) => updateField("ownerId", v)}
              placeholder="Select owner"
              searchPlaceholder="Find someone…"
              disabled={isSubmitting || !isAdmin}
            />
          </div>
        </div>
      </div>

      {/* 2. Company Information */}
      <div className="flex flex-col gap-5 [&>h3]:-mb-2">
        <h3 className="pl-1 text-[13px] font-medium text-ds-ink">Company Information</h3>

        <div className="grid grid-cols-1 gap-x-3 gap-y-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="companyName" className="text-xs text-gray-600">
              Company Name
            </Label>
            <Input
              id="companyName"
              value={formData.companyName}
              onChange={(e) => updateField("companyName", e.target.value)}
              placeholder="Acme Corp"
              disabled={isSubmitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prospectIndustry" className="text-xs text-gray-600">
              Industry
            </Label>
            <SearchableSelect
              options={[{ value: "__none__", label: "None" }, ...PROSPECT_INDUSTRIES.map((ind) => ({ value: ind.value, label: ind.label }))]}
              value={formData.prospectIndustry}
              onValueChange={(v) => updateField("prospectIndustry", v === "__none__" ? "" : v)}
              placeholder="Select industry"
              searchPlaceholder="Search industries…"
              disabled={isSubmitting}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="companyEmail" className="text-xs text-gray-600">
            Company Email
          </Label>
          <Input
            id="companyEmail"
            type="email"
            value={formData.companyEmail}
            onChange={(e) => updateField("companyEmail", e.target.value)}
            placeholder="hello@acme.com"
            disabled={isSubmitting}
          />
        </div>
      </div>

      {/* 3. Contact Details */}
      <div className="flex flex-col gap-5 [&>h3]:-mb-2">
        <h3 className="pl-1 text-[13px] font-medium text-ds-ink">Contact Details</h3>

        {/* [Salutation] First Name | Last Name */}
        <div className="grid grid-cols-1 gap-x-3 gap-y-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="firstName" className="text-xs text-gray-600">
              First name
            </Label>
            <div className="flex gap-2">
              <SearchableSelect
                options={[{ value: "__none__", label: "—" }, ...SALUTATIONS.map((s) => ({ value: s, label: s }))]}
                value={formData.salutation}
                onValueChange={(v) => updateField("salutation", v === "__none__" ? "" : v)}
                placeholder="—"
                searchPlaceholder="Search…"
                disabled={isSubmitting}
                className="w-24 shrink-0"
              />
              <Input
                id="firstName"
                value={formData.firstName}
                onChange={(e) => updateField("firstName", e.target.value)}
                placeholder="Set first name"
                disabled={isSubmitting}
                className={`flex-1 ${errors.firstName ? "border-red-500" : ""}`}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lastName" className="text-xs text-gray-600">
              Last name
            </Label>
            <Input
              id="lastName"
              value={formData.lastName}
              onChange={(e) => updateField("lastName", e.target.value)}
              placeholder="Set last name"
              disabled={isSubmitting}
            />
          </div>
        </div>

        {/* Designation | Email */}
        <div className="grid grid-cols-1 gap-x-3 gap-y-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="designation" className="text-xs text-gray-600">
              Designation
            </Label>
            <Input
              id="designation"
              value={formData.designation}
              onChange={(e) => updateField("designation", e.target.value)}
              placeholder="CEO, CTO, Manager..."
              disabled={isSubmitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs text-gray-600">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => updateField("email", e.target.value)}
              placeholder="Set email"
              disabled={isSubmitting}
              className={errors.email ? "border-red-500" : ""}
            />
            {errors.email && (
              <p className="text-xs text-red-500">{errors.email}</p>
            )}
          </div>
        </div>

        {/* Phone | City */}
        <div className="grid grid-cols-1 gap-x-3 gap-y-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="phone" className="text-xs text-gray-600">
              Phone
            </Label>
            <PhoneInput
              value={formData.phone}
              onChange={(v) => updateField("phone", v)}
              disabled={isSubmitting}
              error={!!errors.phone}
            />
            {errors.phone && (
              <p className="text-xs text-red-500">{errors.phone}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="city" className="text-xs text-gray-600">
              City
            </Label>
            <Input
              id="city"
              value={formData.city}
              onChange={(e) => updateField("city", e.target.value)}
              placeholder="New York"
              disabled={isSubmitting}
            />
          </div>
        </div>
      </div>

      {/* 4. Assignment & Status */}
      {renderAssignmentSection()}

      {/* 5. Collapsibles */}
      {renderCollapsibles()}
    </>
  );

  const renderDefaultForm = () => (
    <>
      {/* Contact Information */}
      <div className="flex flex-col gap-5 [&>h3]:-mb-2">
        <h3 className="pl-1 text-[13px] font-medium text-ds-ink">Contact Information</h3>

        <div className="grid grid-cols-1 gap-x-3 gap-y-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="firstName" className="text-xs text-gray-600">
              First name
            </Label>
            <Input
              id="firstName"
              value={formData.firstName}
              onChange={(e) => updateField("firstName", e.target.value)}
              placeholder="Set first name"
              disabled={isSubmitting}
              className={errors.firstName ? "border-red-500" : ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lastName" className="text-xs text-gray-600">
              Last name
            </Label>
            <Input
              id="lastName"
              value={formData.lastName}
              onChange={(e) => updateField("lastName", e.target.value)}
              placeholder="Set last name"
              disabled={isSubmitting}
            />
          </div>
        </div>

        {/* Study Interest — education_consultancy only */}
        {industryId === "education_consultancy" && (
          <DestinationsMultiSelect
            selected={formData.destinations}
            onChange={setDestinations}
            disabled={isSubmitting}
            options={destOptions}
          />
        )}
        {industryId === "education_consultancy" && (
          <div className="grid grid-cols-1 gap-x-3 gap-y-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-600">Field of study</Label>
              <SearchableSelect
                options={[{ value: "__none__", label: "None" }, ...fieldsOfStudy.map((x) => ({ value: x, label: x }))]}
                value={formData.fieldOfStudy}
                onValueChange={(v) => updateField("fieldOfStudy", v === "__none__" ? "" : v)}
                placeholder="Select field"
                searchPlaceholder="Search fields…"
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-600">Interested degree level</Label>
              <SearchableSelect
                options={[{ value: "__none__", label: "None" }, ...studyLevels.map((x) => ({ value: x, label: x }))]}
                value={formData.degreeLevel}
                onValueChange={(v) => updateField("degreeLevel", v === "__none__" ? "" : v)}
                placeholder="Select level"
                searchPlaceholder="Search levels…"
                disabled={isSubmitting}
              />
            </div>
          </div>
        )}
        {industryId === "education_consultancy" && (
          <div className="grid grid-cols-1 gap-x-3 gap-y-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-600">Intake month</Label>
              <SearchableSelect
                options={[{ value: "__none__", label: "None" }, ...intakeMonths.map((x) => ({ value: x, label: x }))]}
                value={formData.intakeMonth}
                onValueChange={(v) => updateField("intakeMonth", v === "__none__" ? "" : v)}
                placeholder="Select month"
                searchPlaceholder="Search months…"
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-600">Intake year</Label>
              <SearchableSelect
                options={[{ value: "__none__", label: "None" }, ...intakeYears.map((x) => ({ value: x, label: x }))]}
                value={formData.intakeYear}
                onValueChange={(v) => updateField("intakeYear", v === "__none__" ? "" : v)}
                placeholder="Select year"
                searchPlaceholder="Search years…"
                disabled={isSubmitting}
              />
            </div>
          </div>
        )}

        {renderEmailPhoneRow()}
        {renderLocationRow()}
      </div>

      {renderAssignmentSection()}
      {renderCollapsibles()}
    </>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent
        size="form"
        showCloseButton={!isSubmitting}
        aria-describedby={undefined}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !isSubmitting) {
            e.preventDefault();
            void handleSubmit();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="grid size-5 shrink-0 place-items-center rounded-md bg-ds-accent-soft text-ds-accent">
              <PlusIcon className="size-[13px]" aria-hidden />
            </span>
            Add lead
          </DialogTitle>
          <DialogDescription className="sr-only">Manually add a lead from a phone call, walk-in, or referral.</DialogDescription>
        </DialogHeader>

        <div ref={bodyRef} className="space-y-7">
          {errors.general && (
            <div className="flex items-start gap-2 rounded-[10px] bg-ds-bad-soft p-3 text-sm text-ds-bad">
              <WarningCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              {errors.general}
            </div>
          )}

          {industryId === "it_agency" ? renderItAgencyForm() : renderDefaultForm()}
        </div>

        <DialogFooter>
          <button
            type="button"
            role="switch"
            aria-checked={addAnother}
            onClick={() => setAddAnother((v) => !v)}
            disabled={isSubmitting}
            className="mr-auto flex items-center gap-2 rounded-lg px-1 py-1 text-[13px] font-normal text-ds-muted"
          >
            <span className={`relative inline-block h-4 w-7 rounded-full transition-colors ${addAnother ? "bg-ds-accent" : "bg-[#d9dce0]"}`}>
              <span className={`absolute top-0.5 size-3 rounded-full bg-white transition-all ${addAnother ? "left-[14px]" : "left-0.5"}`} />
            </span>
            Add another
          </button>
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <CircleNotchIcon className="size-4 animate-spin" />
                Adding…
              </>
            ) : (
              <>
                Add lead <DialogKeyHint>⌘↵</DialogKeyHint>
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
