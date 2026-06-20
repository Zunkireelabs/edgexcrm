"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight, ChevronDown, Loader2, Plus, AlertCircle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import type { Branch, PipelineStage, TenantEntity, UserRole } from "@/types/database";
import {
  PROSPECT_INDUSTRIES,
} from "@/industries/it-agency/leads/prospect-industries";
import { SALUTATIONS } from "@/industries/it-agency/leads/salutations";
import {
  DESTINATIONS,
  FIELDS_OF_STUDY,
  DEGREE_LEVELS,
} from "@/industries/education-consultancy/features/lead-lists/taxonomies";
import { validateLeadIdentity } from "@/lib/leads/lead-validation";

interface TeamMember {
  user_id: string;
  email: string;
  role: string;
}

interface AddLeadSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  pipelineId?: string;
  stages: PipelineStage[];
  teamMembers: TeamMember[];
  entities?: TenantEntity[];
  entityLabel?: string;
  role: UserRole;
  currentUserId: string;
  industryId?: string | null;
  branches?: Branch[];
  selectedBranchId?: string | null;
  userBranchId?: string | null;
}

interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  stageId: string;
  assignedTo: string;
  entityId: string;
  branchId: string;
  intakeSource: string;
  intakeMedium: string;
  intakeCampaign: string;
  preferredContact: string;
  initialNotes: string;
  tag: string;
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
}

interface FormErrors {
  firstName?: string;
  email?: string;
  phone?: string;
  general?: string;
}

const COUNTRIES = [
  "Nepal",
  "India",
  "United States",
  "United Kingdom",
  "Canada",
  "Australia",
  "Germany",
  "France",
  "Japan",
  "China",
  "Singapore",
  "UAE",
  "Other",
];

const INTAKE_SOURCES = [
  { value: "manual_entry", label: "Manual Entry" },
  { value: "phone_call", label: "Phone Call" },
  { value: "walk_in", label: "Walk-in" },
  { value: "referral", label: "Referral" },
  { value: "trade_show", label: "Trade Show / Event" },
  { value: "social_media", label: "Social Media" },
  { value: "email", label: "Email Inquiry" },
  { value: "other", label: "Other" },
];

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
  assignedTo: "",
  entityId: "",
  branchId: "",
  intakeSource: "manual_entry",
  intakeMedium: "dashboard",
  intakeCampaign: "",
  preferredContact: "",
  initialNotes: "",
  tag: "student",
  companyName: "",
  designation: "",
  prospectIndustry: "",
  ownerId: "",
  salutation: "",
  companyEmail: "",
  destinations: [],
  fieldOfStudy: "",
  degreeLevel: "",
};

function DestinationsField({
  selected,
  onToggle,
  disabled,
}: {
  selected: string[];
  onToggle: (dest: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-gray-600">
        Interested Destination
        <span className="ml-1 text-gray-400">(optional)</span>
      </Label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 border border-input rounded-md text-sm bg-background hover:bg-accent transition-colors"
      >
        <span className={selected.length === 0 ? "text-muted-foreground" : ""}>
          {selected.length === 0
            ? "Select destinations"
            : selected.join(", ")}
        </span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border border-input rounded-md p-2 grid grid-cols-2 gap-1.5 bg-background shadow-sm">
          {DESTINATIONS.map((dest) => (
            <div key={dest} className="flex items-center gap-2">
              <Checkbox
                id={`dest-${dest}`}
                checked={selected.includes(dest)}
                disabled={disabled}
                onCheckedChange={() => onToggle(dest)}
              />
              <label htmlFor={`dest-${dest}`} className="text-xs cursor-pointer select-none">
                {dest}
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AddLeadSheet({
  open,
  onOpenChange,
  tenantId,
  pipelineId,
  stages,
  teamMembers,
  entities = [],
  entityLabel = "Entity",
  role,
  currentUserId,
  industryId,
  branches = [],
  selectedBranchId = null,
  userBranchId = null,
}: AddLeadSheetProps) {
  const router = useRouter();
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const isAdmin = role === "owner" || role === "admin";
  const defaultStage = stages.find((s) => s.is_default) || stages[0];

  useEffect(() => {
    if (open) {
      setFormData({
        ...initialFormData,
        stageId: defaultStage?.id || "",
        assignedTo: role === "counselor" ? currentUserId : "",
        ownerId: currentUserId,
        // Non-admins locked to their branch; admins default to active branch from switcher
        branchId: (!isAdmin && userBranchId) ? userBranchId : (selectedBranchId || ""),
      });
      setErrors({});
      setIsDirty(false);
      setSourceOpen(false);
      setNotesOpen(false);
    }
  }, [open, defaultStage?.id, role, currentUserId, isAdmin, userBranchId, selectedBranchId]);

  const updateField = (field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setIsDirty(true);
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const toggleDestination = (dest: string) => {
    setFormData((prev) => {
      const current = prev.destinations;
      const next = current.includes(dest)
        ? current.filter((d) => d !== dest)
        : [...current, dest];
      return { ...prev, destinations: next };
    });
    setIsDirty(true);
  };

  const validate = (): boolean => {
    const newErrors: FormErrors = validateLeadIdentity({
      email: formData.email,
      firstName: formData.firstName,
      phone: formData.phone,
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setIsSubmitting(true);
    setErrors({});

    try {
      const payload = {
        tenant_id: tenantId,
        pipeline_id: pipelineId || undefined,
        first_name: formData.firstName || null,
        last_name: formData.lastName || null,
        email: formData.email || null,
        phone: formData.phone || null,
        city: formData.city || null,
        country: formData.country || null,
        stage_id: formData.stageId || undefined,
        assigned_to: formData.assignedTo || null,
        entity_id: formData.entityId || null,
        branch_id: formData.branchId || null,
        intake_source: formData.intakeSource || "manual_entry",
        intake_medium: "dashboard",
        tags: industryId === "education_consultancy" ? [formData.tag || "student"] : [],
        intake_campaign: formData.intakeCampaign || null,
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

      onOpenChange(false);
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

  const assignableMembers = teamMembers.filter(
    (m) => m.role === "counselor" || m.role === "admin" || m.role === "owner"
  );

  // ── Shared render helpers ────────────────────────────────────────────────

  const renderEmailPhoneRow = () => (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-1.5">
        <Label htmlFor="email" className="text-xs text-gray-600">
          Email
        </Label>
        <Input
          id="email"
          type="email"
          value={formData.email}
          onChange={(e) => updateField("email", e.target.value)}
          placeholder="john@example.com"
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
        />
        {errors.phone && (
          <p className="text-xs text-red-500">{errors.phone}</p>
        )}
      </div>
    </div>
  );

  const renderLocationRow = () => (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-1.5">
        <Label htmlFor="city" className="text-xs text-gray-600">
          City
        </Label>
        <Input
          id="city"
          value={formData.city}
          onChange={(e) => updateField("city", e.target.value)}
          placeholder="Kathmandu"
          disabled={isSubmitting}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="country" className="text-xs text-gray-600">
          Country
        </Label>
        <Select
          value={formData.country}
          onValueChange={(v) => updateField("country", v)}
          disabled={isSubmitting}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select country" />
          </SelectTrigger>
          <SelectContent>
            {COUNTRIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  const renderAssignmentSection = () => (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-gray-900">Assignment &amp; Status</h3>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="stage" className="text-xs text-gray-600">
            Pipeline Stage
          </Label>
          <Select
            value={formData.stageId}
            onValueChange={(v) => updateField("stageId", v)}
            disabled={isSubmitting}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select stage" />
            </SelectTrigger>
            <SelectContent>
              {stages
                .filter((s) => !s.is_terminal)
                .sort((a, b) => a.position - b.position)
                .map((stage) => (
                  <SelectItem key={stage.id} value={stage.id}>
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: stage.color }}
                      />
                      {stage.name}
                    </div>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="assignedTo" className="text-xs text-gray-600">
            Assigned To
            {!isAdmin && (
              <span className="ml-1 text-gray-400">(auto)</span>
            )}
          </Label>
          <Select
            value={formData.assignedTo || "__none__"}
            onValueChange={(v) => updateField("assignedTo", v === "__none__" ? "" : v)}
            disabled={isSubmitting || !isAdmin}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select team member" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Unassigned</SelectItem>
              {assignableMembers.map((member) => (
                <SelectItem key={member.user_id} value={member.user_id}>
                  {member.email.split("@")[0]}
                  {member.user_id === currentUserId && " (You)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Branch picker — only for tenants with >1 branch */}
      {branches.length > 1 && (
        <div className="space-y-1.5">
          <Label htmlFor="branchId" className="text-xs text-gray-600">
            Branch
            {!isAdmin && userBranchId && (
              <span className="ml-1 text-gray-400">(auto)</span>
            )}
          </Label>
          <Select
            value={formData.branchId || "__none__"}
            onValueChange={(v) => updateField("branchId", v === "__none__" ? "" : v)}
            disabled={isSubmitting || (!isAdmin && !!userBranchId)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="No branch" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No branch</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {entities.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="entity" className="text-xs text-gray-600">
            {entityLabel}
          </Label>
          <Select
            value={formData.entityId || "__none__"}
            onValueChange={(v) => updateField("entityId", v === "__none__" ? "" : v)}
            disabled={isSubmitting}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={`Select ${entityLabel.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {entities
                .filter((e) => e.is_active)
                .map((entity) => (
                  <SelectItem key={entity.id} value={entity.id}>
                    {entity.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );

  const renderCollapsibles = () => (
    <>
      <Collapsible open={sourceOpen} onOpenChange={setSourceOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 text-sm font-medium text-gray-700 hover:text-gray-900">
          <ChevronRight
            className={`h-4 w-4 transition-transform ${
              sourceOpen ? "rotate-90" : ""
            }`}
          />
          Lead Source
          <span className="text-xs text-gray-400 font-normal">(optional)</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="source" className="text-xs text-gray-600">
                Source
              </Label>
              <Select
                value={formData.intakeSource}
                onValueChange={(v) => updateField("intakeSource", v)}
                disabled={isSubmitting}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTAKE_SOURCES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="preferredContact" className="text-xs text-gray-600">
                Preferred Contact
              </Label>
              <Select
                value={formData.preferredContact}
                onValueChange={(v) => updateField("preferredContact", v)}
                disabled={isSubmitting}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  {CONTACT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
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
        </CollapsibleContent>
      </Collapsible>

      <Collapsible open={notesOpen} onOpenChange={setNotesOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 text-sm font-medium text-gray-700 hover:text-gray-900">
          <ChevronRight
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
    </>
  );

  // ── Layout ───────────────────────────────────────────────────────────────

  const renderItAgencyForm = () => (
    <>
      {/* 1. Lead Information */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-gray-900">Lead Information</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="ownerId" className="text-xs text-gray-600">
              Lead Owner
              {!isAdmin && (
                <span className="ml-1 text-gray-400">(auto)</span>
              )}
            </Label>
            <Select
              value={formData.ownerId || currentUserId}
              onValueChange={(v) => updateField("ownerId", v)}
              disabled={isSubmitting || !isAdmin}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select owner" />
              </SelectTrigger>
              <SelectContent>
                {assignableMembers.map((member) => (
                  <SelectItem key={member.user_id} value={member.user_id}>
                    {member.email.split("@")[0]}
                    {member.user_id === currentUserId && " (You)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* 2. Company Information */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-gray-900">Company Information</h3>

        <div className="grid grid-cols-2 gap-4">
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
            <Select
              value={formData.prospectIndustry || "__none__"}
              onValueChange={(v) => updateField("prospectIndustry", v === "__none__" ? "" : v)}
              disabled={isSubmitting}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select industry" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select industry</SelectItem>
                {PROSPECT_INDUSTRIES.map((ind) => (
                  <SelectItem key={ind.value} value={ind.value}>
                    {ind.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-gray-900">Contact Details</h3>

        {/* [Salutation] First Name | Last Name */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="firstName" className="text-xs text-gray-600">
              First Name
            </Label>
            <div className="flex gap-2">
              <Select
                value={formData.salutation || "__none__"}
                onValueChange={(v) => updateField("salutation", v === "__none__" ? "" : v)}
                disabled={isSubmitting}
              >
                <SelectTrigger className="w-24 shrink-0">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {SALUTATIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                id="firstName"
                value={formData.firstName}
                onChange={(e) => updateField("firstName", e.target.value)}
                placeholder="John"
                disabled={isSubmitting}
                className={`flex-1 ${errors.firstName ? "border-red-500" : ""}`}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lastName" className="text-xs text-gray-600">
              Last Name
            </Label>
            <Input
              id="lastName"
              value={formData.lastName}
              onChange={(e) => updateField("lastName", e.target.value)}
              placeholder="Doe"
              disabled={isSubmitting}
            />
          </div>
        </div>

        {/* Designation | Email */}
        <div className="grid grid-cols-2 gap-4">
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
              placeholder="john@example.com"
              disabled={isSubmitting}
              className={errors.email ? "border-red-500" : ""}
            />
            {errors.email && (
              <p className="text-xs text-red-500">{errors.email}</p>
            )}
          </div>
        </div>

        {/* Phone | City */}
        <div className="grid grid-cols-2 gap-4">
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

        {/* Country */}
        <div className="space-y-1.5">
          <Label htmlFor="country" className="text-xs text-gray-600">
            Country
          </Label>
          <Select
            value={formData.country}
            onValueChange={(v) => updateField("country", v)}
            disabled={isSubmitting}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select country" />
            </SelectTrigger>
            <SelectContent>
              {COUNTRIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-gray-900">Contact Information</h3>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="firstName" className="text-xs text-gray-600">
              First Name
            </Label>
            <Input
              id="firstName"
              value={formData.firstName}
              onChange={(e) => updateField("firstName", e.target.value)}
              placeholder="John"
              disabled={isSubmitting}
              className={errors.firstName ? "border-red-500" : ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lastName" className="text-xs text-gray-600">
              Last Name
            </Label>
            <Input
              id="lastName"
              value={formData.lastName}
              onChange={(e) => updateField("lastName", e.target.value)}
              placeholder="Doe"
              disabled={isSubmitting}
            />
          </div>
        </div>

        {/* Tag Selector — education_consultancy only */}
        {industryId === "education_consultancy" && (
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-600">Tag</Label>
            <div className="flex gap-2">
              {["student", "parent"].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  disabled={isSubmitting}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    formData.tag === tag
                      ? tag === "parent"
                        ? "bg-green-100 text-green-700 ring-2 ring-green-300"
                        : "bg-blue-100 text-blue-700 ring-2 ring-blue-300"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}
                  onClick={() => updateField("tag", tag)}
                >
                  {tag.charAt(0).toUpperCase() + tag.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Study Interest — education_consultancy only */}
        {industryId === "education_consultancy" && (
          <DestinationsField
            selected={formData.destinations}
            onToggle={toggleDestination}
            disabled={isSubmitting}
          />
        )}
        {industryId === "education_consultancy" && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-600">Field of Study</Label>
              <Select
                value={formData.fieldOfStudy || "__none__"}
                onValueChange={(v) => updateField("fieldOfStudy", v === "__none__" ? "" : v)}
                disabled={isSubmitting}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select field" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select field</SelectItem>
                  {FIELDS_OF_STUDY.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-600">Degree Level</Label>
              <Select
                value={formData.degreeLevel || "__none__"}
                onValueChange={(v) => updateField("degreeLevel", v === "__none__" ? "" : v)}
                disabled={isSubmitting}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select level</SelectItem>
                  {DEGREE_LEVELS.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
    <Sheet open={open} onOpenChange={handleClose} modal={false}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl flex flex-col shadow-2xl border-l"
        showCloseButton={!isSubmitting}
        showOverlay={false}
      >
        <SheetHeader className="shrink-0 border-b pb-4">
          <SheetTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Add New Lead
          </SheetTitle>
          <SheetDescription>
            Manually add a lead from a phone call, walk-in, or referral.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-6 px-4 space-y-6">
          {errors.general && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {errors.general}
            </div>
          )}

          {industryId === "it_agency" ? renderItAgencyForm() : renderDefaultForm()}
        </div>

        <SheetFooter className="shrink-0 border-t pt-4">
          <div className="flex w-full gap-4">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="flex-1"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Lead"
              )}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
