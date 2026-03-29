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
import { ChevronRight, Loader2, Plus, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import type { PipelineStage, TenantEntity, UserRole } from "@/types/database";

interface TeamMember {
  user_id: string;
  email: string;
  role: string;
}

interface AddLeadSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  stages: PipelineStage[];
  teamMembers: TeamMember[];
  entities?: TenantEntity[];
  entityLabel?: string;
  role: UserRole;
  currentUserId: string;
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
  intakeSource: string;
  intakeMedium: string;
  intakeCampaign: string;
  preferredContact: string;
  initialNotes: string;
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
  intakeSource: "manual_entry",
  intakeMedium: "dashboard",
  intakeCampaign: "",
  preferredContact: "",
  initialNotes: "",
};

export function AddLeadSheet({
  open,
  onOpenChange,
  tenantId,
  stages,
  teamMembers,
  entities = [],
  entityLabel = "Entity",
  role,
  currentUserId,
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

  // Reset form when sheet opens
  useEffect(() => {
    if (open) {
      setFormData({
        ...initialFormData,
        stageId: defaultStage?.id || "",
        // Auto-assign to self if counselor
        assignedTo: role === "counselor" ? currentUserId : "",
      });
      setErrors({});
      setIsDirty(false);
      setSourceOpen(false);
      setNotesOpen(false);
    }
  }, [open, defaultStage?.id, role, currentUserId]);

  const updateField = (field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setIsDirty(true);
    // Clear field-specific error on change
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const validateEmail = (email: string): boolean => {
    if (!email) return true; // Empty is OK if firstName is provided
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validatePhone = (phone: string): boolean => {
    if (!phone) return true;
    // Basic phone validation - allows digits, spaces, dashes, parentheses, plus sign
    const phoneRegex = /^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]*$/;
    return phoneRegex.test(phone) && phone.replace(/\D/g, "").length >= 7;
  };

  const validate = (): boolean => {
    const newErrors: FormErrors = {};

    // Must have at least email OR firstName
    if (!formData.email && !formData.firstName) {
      newErrors.general = "Please provide at least an email or first name";
    }

    // Validate email format if provided
    if (formData.email && !validateEmail(formData.email)) {
      newErrors.email = "Please enter a valid email address";
    }

    // Validate phone format if provided
    if (formData.phone && !validatePhone(formData.phone)) {
      newErrors.phone = "Please enter a valid phone number";
    }

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
        first_name: formData.firstName || null,
        last_name: formData.lastName || null,
        email: formData.email || null,
        phone: formData.phone || null,
        city: formData.city || null,
        country: formData.country || null,
        stage_id: formData.stageId || undefined,
        assigned_to: formData.assignedTo || null,
        entity_id: formData.entityId || null,
        intake_source: formData.intakeSource || "manual_entry",
        intake_medium: "dashboard",
        intake_campaign: formData.intakeCampaign || null,
        preferred_contact_method: formData.preferredContact || null,
        custom_fields: formData.initialNotes
          ? { initial_notes: formData.initialNotes }
          : {},
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

  // Filter team members to only counselors/admins who can be assigned leads
  const assignableMembers = teamMembers.filter(
    (m) => m.role === "counselor" || m.role === "admin" || m.role === "owner"
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
          {/* General Error */}
          {errors.general && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {errors.general}
            </div>
          )}

          {/* Contact Information Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-900">Contact Information</h3>

            {/* Name Row */}
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

            {/* Email & Phone Row */}
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
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => updateField("phone", e.target.value)}
                  placeholder="+1 234 567 8900"
                  disabled={isSubmitting}
                  className={errors.phone ? "border-red-500" : ""}
                />
                {errors.phone && (
                  <p className="text-xs text-red-500">{errors.phone}</p>
                )}
              </div>
            </div>

            {/* Location Row */}
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
          </div>

          {/* Assignment Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-900">Assignment & Status</h3>

            <div className="grid grid-cols-2 gap-4">
              {/* Pipeline Stage */}
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

              {/* Assigned To (Admin only) */}
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

            {/* Entity (if available) */}
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

          {/* Collapsible Lead Source Section */}
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

          {/* Collapsible Notes Section */}
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
