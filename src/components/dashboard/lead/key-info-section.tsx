"use client";

import React, { useState, useEffect, useCallback } from "react";
import { ChevronDown, UserCircle, Building } from "lucide-react";
import { prospectIndustryLabel, PROSPECT_INDUSTRIES } from "@/industries/it-agency/leads/prospect-industries";
import { TRIP_TYPES, tripTypeLabel } from "@/industries/travel-agency/leads/trip-types";
import { formatMoney } from "@/lib/travel/currency";
import { isReservedCustomField } from "@/lib/leads/reserved-custom-fields";
import { SALUTATIONS } from "@/industries/it-agency/leads/salutations";
import {
  DESTINATIONS,
  FIELDS_OF_STUDY,
  DEGREE_LEVELS,
} from "@/industries/_shared/features/lead-lists/taxonomies";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Lead, LeadList, PipelineStage, TenantEntity, Industry } from "@/types/database";
import { BranchesBlock } from "./branches-block";
import { ListStepper } from "@/components/dashboard/leads/list-stepper";

const CONTACT_METHODS = [
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "any", label: "Any" },
];

const COUNTRIES = [
  "Nepal", "India", "United States", "United Kingdom", "Canada", "Australia",
  "Germany", "France", "Japan", "China", "Singapore", "UAE", "Other",
];

interface TeamMember {
  id: string;
  user_id: string;
  role: string;
  email: string;
  name?: string | null;
  canEditLeads?: boolean;
}

interface LeadDraftSubset {
  country: string;
  nationality: string;
  preferred_contact_method: string;
  salutation: string;
  company_name: string;
  company_email: string;
  designation: string;
  prospect_industry: string;
}

interface KeyInfoSectionProps {
  lead: Lead;
  stages: PipelineStage[];
  currentStage?: PipelineStage;
  stageId: string | null;
  assignedTo: string;
  teamMembers: TeamMember[];
  /** Pre-filtered assignable subset for the dropdown; falls back to teamMembers.filter(canEditLeads) if absent. */
  assignableMembers?: TeamMember[];
  isAdmin: boolean;
  canEdit?: boolean;            // member with canEditLeads: can change stage even when not admin
  canAssign?: boolean;          // member with canAssignLeads: can set the assignee even when not admin
  onStageChange: (stageId: string) => void;
  onAssignmentChange: (userId: string) => void;
  entity?: TenantEntity | null;
  industry?: Industry | null;
  industryId?: string | null;
  isEditing?: boolean;
  draft?: LeadDraftSubset;
  editErrors?: { email?: string; phone?: string; general?: string };
  onDraftChange?: (field: keyof LeadDraftSubset, value: string) => void;
  onLeadTypeChange?: (newType: string) => void;
  onListChange?: (listId: string, archiveReason?: string) => Promise<void>;
  leadLists?: LeadList[];
  activeLeadLists?: LeadList[];
  onSaveTripFields?: (fields: Record<string, unknown>) => Promise<void>;
  onSaveStudyFields?: (fields: Record<string, unknown>) => Promise<void>;
  onSaveSourceFields?: (fields: Record<string, unknown>) => Promise<void>;
  onQualify?: () => void;
  maxBranches?: number;
  userBranchId?: string | null;
  leadScope?: "all" | "own" | "team";
}

export function KeyInfoSection({
  lead,
  stages,
  currentStage,
  stageId,
  assignedTo,
  teamMembers,
  assignableMembers,
  isAdmin,
  canEdit = false,
  canAssign = false,
  onStageChange,
  onAssignmentChange,
  entity,
  industry,
  industryId,
  isEditing = false,
  draft,
  onDraftChange,
  onLeadTypeChange,
  onListChange,
  leadLists,
  activeLeadLists,
  onSaveTripFields,
  onSaveStudyFields,
  onSaveSourceFields,
  onQualify,
  maxBranches,
  userBranchId,
  leadScope,
}: KeyInfoSectionProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [leadType, setLeadType] = useState(lead.lead_type || "lead");

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setLeadType(lead.lead_type || "lead"), [lead.lead_type]);

  const assignedMember = teamMembers.find((m) => m.user_id === assignedTo);
  const entityLabel = industry?.entity_type_singular || "Entity";

  // Custom fields
  const customFields = Object.entries(lead.custom_fields || {}).filter(
    ([key, v]) => v != null && v !== "" && !isReservedCustomField(key)
  );

  return (
    <div className="border border-border rounded-lg bg-card shadow-none">
      <button
        type="button"
        className="flex items-center justify-between w-full p-3 text-left"
        onClick={() => setIsOpen(!isOpen)}
      >
        <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          Key Information
        </h3>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {isOpen && (
        <div className="px-3 pb-3 pt-0 space-y-4">

          {/* ── STATUS ─────────────────────────────────────────────────── */}
          <SectionHeading>Status</SectionHeading>

          {/* Stage */}
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Stage</p>
            {(isAdmin || canEdit) ? (
              <Select value={stageId || ""} onValueChange={onStageChange}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select stage" />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((stage) => (
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
            ) : (
              <Badge
                variant="secondary"
                style={
                  currentStage
                    ? { backgroundColor: `${currentStage.color}20`, color: currentStage.color }
                    : undefined
                }
              >
                {currentStage?.name || "Unknown"}
              </Badge>
            )}
          </div>

          {/* List — any tenant with lead-lists; legacy Lead Type toggle stays education-only */}
          {((leadLists && leadLists.length > 0) || industryId === "education_consultancy") && (
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">
                {leadLists && leadLists.length > 0 ? "Stage" : "Lead Type"}
              </p>
              {leadLists && leadLists.length > 0 && onListChange ? (
                <ListStepper
                  currentListId={(lead as { list_id?: string | null }).list_id ?? null}
                  activeLists={activeLeadLists ?? leadLists}
                  accessibleLists={leadLists}
                  industryId={industryId}
                  onMove={(listId) => onListChange(listId)}
                  onQualify={onQualify}
                />
              ) : (
                <div className="flex gap-1.5">
                  {["lead", "prospect"].map((t) => (
                    <button
                      key={t}
                      onClick={() => { setLeadType(t); onLeadTypeChange?.(t); }}
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                        leadType === t
                          ? t === "prospect"
                            ? "bg-purple-100 text-purple-700 ring-2 ring-purple-300"
                            : "bg-gray-200 text-gray-700 ring-2 ring-gray-300"
                          : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                      }`}
                    >
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Assigned To */}
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Assigned To</p>
            {isAdmin || canAssign ? (
              <Select
                value={assignedTo || "unassigned"}
                onValueChange={onAssignmentChange}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">
                    <span className="text-muted-foreground">Unassigned</span>
                  </SelectItem>
                  {(assignableMembers ?? teamMembers.filter((m) => m.canEditLeads !== false))
                    .map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        <div className="flex items-center gap-2">
                          <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center">
                            <span className="text-[10px] font-medium text-primary">
                              {getInitials(m.email)}
                            </span>
                          </div>
                          <span className="truncate">{m.name || m.email.split("@")[0]}</span>
                        </div>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center gap-2">
                {assignedMember ? (
                  <>
                    <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-[10px] font-medium text-primary">
                        {getInitials(assignedMember.email)}
                      </span>
                    </div>
                    <span className="text-sm font-medium truncate">{assignedMember.name || assignedMember.email.split("@")[0]}</span>
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <UserCircle className="h-4 w-4" />
                    <span className="text-sm">Unassigned</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Branches */}
          {maxBranches && maxBranches > 1 && (
            <BranchesBlock
              leadId={lead.id}
              isAdmin={isAdmin}
              userBranchId={userBranchId ?? null}
              leadScope={leadScope ?? "all"}
            />
          )}

          {/* ── STUDY INTEREST — education_consultancy only ─────────── */}
          {industryId === "education_consultancy" && (
            <StudyInterestPanel
              lead={lead}
              isAdmin={isAdmin}
              onSave={onSaveStudyFields}
            />
          )}

          <LeadSourcePanel lead={lead} isAdmin={isAdmin} onSave={onSaveSourceFields} />

          {/* ── COMPANY — it_agency only ──────────────────────────── */}
          {industryId === "it_agency" && isEditing && draft ? (
            <>
              <div className="border-t border-border" />
              <SectionHeading>Company</SectionHeading>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Salutation</p>
                <Select
                  value={draft.salutation || "__none__"}
                  onValueChange={(v) => onDraftChange?.("salutation", v === "__none__" ? "" : v)}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="text-muted-foreground">None</span>
                    </SelectItem>
                    {SALUTATIONS.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Company Name</p>
                <Input
                  className="h-8 text-sm"
                  value={draft.company_name}
                  placeholder="Acme Corp"
                  onChange={(e) => onDraftChange?.("company_name", e.target.value)}
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Company Email</p>
                <Input
                  className="h-8 text-sm"
                  type="email"
                  value={draft.company_email}
                  placeholder="contact@acme.com"
                  onChange={(e) => onDraftChange?.("company_email", e.target.value)}
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Designation</p>
                <Input
                  className="h-8 text-sm"
                  value={draft.designation}
                  placeholder="CEO"
                  onChange={(e) => onDraftChange?.("designation", e.target.value)}
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Industry</p>
                <Select
                  value={draft.prospect_industry || "__none__"}
                  onValueChange={(v) => onDraftChange?.("prospect_industry", v === "__none__" ? "" : v)}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Select industry" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="text-muted-foreground">Select industry</span>
                    </SelectItem>
                    {PROSPECT_INDUSTRIES.map((i) => (
                      <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : industryId === "it_agency" && (
            lead.owner_id || lead.salutation || lead.company_name || lead.designation ||
            lead.prospect_industry || lead.company_email
          ) ? (
            <>
              <div className="border-t border-border" />
              <SectionHeading>Company</SectionHeading>
              {lead.owner_id && (() => {
                const owner = teamMembers.find((m) => m.user_id === lead.owner_id);
                return owner ? <InfoRow label="Lead Owner" value={owner.name || owner.email.split("@")[0]} /> : null;
              })()}
              {lead.salutation && (
                <InfoRow label="Salutation" value={lead.salutation} />
              )}
              {lead.company_name && (
                <InfoRow label="Company Name" value={lead.company_name} />
              )}
              {lead.company_email && (
                <InfoRow label="Company Email" value={lead.company_email} />
              )}
              {lead.designation && (
                <InfoRow label="Designation" value={lead.designation} />
              )}
              {lead.prospect_industry && (
                <InfoRow
                  label="Industry"
                  value={prospectIndustryLabel(lead.prospect_industry) ?? lead.prospect_industry}
                />
              )}
            </>
          ) : null}

          {/* ── TRIP INQUIRY — travel_agency only ───────────────────── */}
          {industryId === "travel_agency" && (
            <TripInquiryPanel
              lead={lead}
              isAdmin={isAdmin}
              onSave={onSaveTripFields}
            />
          )}

          {/* ── DETAILS ─────────────────────────────────────────────── */}
          <div className="border-t border-border" />
          <SectionHeading>Details</SectionHeading>

          {/* Residence Country */}
          {isEditing && draft ? (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Residence Country</p>
              <Select
                value={draft.country || "__none__"}
                onValueChange={(v) => onDraftChange?.("country", v === "__none__" ? "" : v)}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select country" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    <span className="text-muted-foreground">Select country</span>
                  </SelectItem>
                  {COUNTRIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : lead.country ? (
            <InfoRow label="Residence Country" value={lead.country} />
          ) : null}

          {/* Preferred Contact */}
          {isEditing && draft ? (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Preferred Contact</p>
              <Select
                value={draft.preferred_contact_method || "__none__"}
                onValueChange={(v) => onDraftChange?.("preferred_contact_method", v === "__none__" ? "" : v)}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    <span className="text-muted-foreground">None</span>
                  </SelectItem>
                  {CONTACT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : lead.preferred_contact_method ? (
            <InfoRow
              label="Preferred Contact"
              value={lead.preferred_contact_method.charAt(0).toUpperCase() + lead.preferred_contact_method.slice(1)}
            />
          ) : null}

          {/* Entity (e.g., College, Service, Project Type).
              travel_agency has its own editable Package selector in the Trip
              Inquiry panel above, so skip this read-only block there. */}
          {entity && industryId !== "travel_agency" && (
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">{entityLabel}</p>
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-md bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                  <Building className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                </div>
                <span className="text-sm font-medium">{entity.name}</span>
              </div>
              {entity.description && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {entity.description}
                </p>
              )}
            </div>
          )}

          {/* Created */}
          <InfoRow
            label="Created"
            value={new Date(lead.created_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          />

          {/* Last Updated */}
          <InfoRow
            label="Last Updated"
            value={formatRelativeTime(lead.updated_at)}
          />

          {/* ── ADDITIONAL DETAILS (true extras only) ───────────────── */}
          {customFields.length > 0 && (
            <>
              <div className="border-t border-border" />
              <SectionHeading>Additional Details</SectionHeading>
              {customFields.map(([key, value]) => (
                <InfoRow
                  key={key}
                  label={formatFieldLabel(key)}
                  value={String(value)}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Study Interest panel (education_consultancy only) ─────────────────────

interface StudyInterestPanelProps {
  lead: Lead;
  isAdmin: boolean;
  onSave?: (fields: Record<string, unknown>) => Promise<void>;
}

function StudyInterestPanel({ lead, isAdmin, onSave }: StudyInterestPanelProps) {
  const leadWithEdu = lead as {
    destinations?: string[] | null;
    field_of_study?: string | null;
    degree_level?: string | null;
  };

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [destOpen, setDestOpen] = useState(false);
  const [draftDests, setDraftDests] = useState<string[]>(leadWithEdu.destinations ?? []);
  const [draftField, setDraftField] = useState(leadWithEdu.field_of_study ?? "");
  const [draftDegree, setDraftDegree] = useState(leadWithEdu.degree_level ?? "");

  function openEdit() {
    setDraftDests(leadWithEdu.destinations ?? []);
    setDraftField(leadWithEdu.field_of_study ?? "");
    setDraftDegree(leadWithEdu.degree_level ?? "");
    setDestOpen(false);
    setEditing(true);
  }

  function toggleDest(d: string) {
    setDraftDests((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  }

  async function handleSave() {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave({
        destinations: draftDests,
        field_of_study: draftField || null,
        degree_level: draftDegree || null,
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const hasAny =
    (leadWithEdu.destinations?.length ?? 0) > 0 ||
    leadWithEdu.field_of_study ||
    leadWithEdu.degree_level;

  return (
    <>
      <div className="border-t border-border" />
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          Study Interest
        </p>
        {isAdmin && !editing && (
          <button
            type="button"
            onClick={openEdit}
            className="text-[10px] text-primary hover:underline"
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          {/* Destinations multi-select */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">Interested Destinations</p>
            <button
              type="button"
              onClick={() => setDestOpen((v) => !v)}
              className="w-full flex items-center justify-between px-2 py-1.5 border border-input rounded text-xs bg-background"
            >
              <span className={draftDests.length === 0 ? "text-muted-foreground" : ""}>
                {draftDests.length === 0 ? "Select destinations" : draftDests.join(", ")}
              </span>
              <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${destOpen ? "rotate-180" : ""}`} />
            </button>
            {destOpen && (
              <div className="mt-1 border border-input rounded p-2 grid grid-cols-2 gap-1 bg-background">
                {DESTINATIONS.map((dest) => (
                  <div key={dest} className="flex items-center gap-1.5">
                    <Checkbox
                      id={`kd-${dest}`}
                      checked={draftDests.includes(dest)}
                      onCheckedChange={() => toggleDest(dest)}
                    />
                    <label htmlFor={`kd-${dest}`} className="text-xs cursor-pointer">{dest}</label>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Field of Study */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">Field of Study</p>
            <Select
              value={draftField || "__none__"}
              onValueChange={(v) => setDraftField(v === "__none__" ? "" : v)}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select field" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  <span className="text-muted-foreground">Select field</span>
                </SelectItem>
                {FIELDS_OF_STUDY.map((f) => (
                  <SelectItem key={f} value={f}>{f}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Degree Level */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">Degree Level</p>
            <Select
              value={draftDegree || "__none__"}
              onValueChange={(v) => setDraftDegree(v === "__none__" ? "" : v)}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  <span className="text-muted-foreground">Select level</span>
                </SelectItem>
                {DEGREE_LEVELS.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" className="h-7 text-xs flex-1" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : hasAny ? (
        <div className="space-y-2">
          {(leadWithEdu.destinations?.length ?? 0) > 0 && (
            <div>
              <p className="text-xs text-muted-foreground">Destinations</p>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {(leadWithEdu.destinations ?? []).map((d) => (
                  <span key={d} className="px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-medium">
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}
          {leadWithEdu.field_of_study && (
            <InfoRow label="Field of Study" value={leadWithEdu.field_of_study} />
          )}
          {leadWithEdu.degree_level && (
            <InfoRow label="Degree Level" value={leadWithEdu.degree_level} />
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">
          No study details yet.{isAdmin ? " Click Edit to add." : ""}
        </p>
      )}
    </>
  );
}

// ── Lead Source panel ─────────────────────────────────────────────────────

interface LeadSourcePanelProps {
  lead: Lead;
  isAdmin: boolean;
  onSave?: (fields: Record<string, unknown>) => Promise<void>;
}

function LeadSourcePanel({ lead, isAdmin, onSave }: LeadSourcePanelProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftSource, setDraftSource] = useState(lead.intake_source ?? "");
  const [draftMedium, setDraftMedium] = useState(lead.intake_medium ?? "");
  const [draftAccount, setDraftAccount] = useState(lead.intake_account ?? "");
  const [draftCampaign, setDraftCampaign] = useState(lead.intake_campaign ?? "");

  function openEdit() {
    setDraftSource(lead.intake_source ?? "");
    setDraftMedium(lead.intake_medium ?? "");
    setDraftAccount(lead.intake_account ?? "");
    setDraftCampaign(lead.intake_campaign ?? "");
    setEditing(true);
  }

  async function handleSave() {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave({
        intake_source: draftSource || null,
        intake_medium: draftMedium || null,
        intake_account: draftAccount || null,
        intake_campaign: draftCampaign || null,
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="border-t border-border" />
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          Lead Source
        </p>
        {isAdmin && !editing && (
          <button
            type="button"
            onClick={openEdit}
            className="text-[10px] text-primary hover:underline"
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Source Category</p>
            <Input
              className="h-8 text-sm"
              value={draftSource}
              placeholder="e.g. Social Media, Referral"
              onChange={(e) => setDraftSource(e.target.value)}
            />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Source Channel</p>
            <Input
              className="h-8 text-sm"
              value={draftMedium}
              placeholder="e.g. Facebook, Google"
              onChange={(e) => setDraftMedium(e.target.value)}
            />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Source Page / Account</p>
            <Input
              className="h-8 text-sm"
              value={draftAccount}
              placeholder="e.g. admizz.edu.np"
              onChange={(e) => setDraftAccount(e.target.value)}
            />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Campaign</p>
            <Input
              className="h-8 text-sm"
              value={draftCampaign}
              placeholder="e.g. spring-2025"
              onChange={(e) => setDraftCampaign(e.target.value)}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" className="h-7 text-xs flex-1" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <InfoRow label="Source Category" value={lead.intake_source || "—"} />
          <InfoRow label="Source Channel" value={lead.intake_medium || "—"} />
          <InfoRow label="Source Page / Account" value={lead.intake_account || "—"} />
          <InfoRow label="Campaign" value={lead.intake_campaign || "—"} />
        </div>
      )}
    </>
  );
}

// ── Trip Inquiry panel (travel_agency only) ────────────────────────────────

interface TripPackage {
  id: string;
  name: string;
  description?: string | null;
}

interface TripInquiryPanelProps {
  lead: Lead;
  isAdmin: boolean;
  onSave?: (fields: Record<string, unknown>) => Promise<void>;
}

const NULL_PACKAGE = "__none__";

function TripInquiryPanel({ lead, isAdmin, onSave }: TripInquiryPanelProps) {
  const cf = (lead.custom_fields || {}) as Record<string, unknown>;

  const [packages, setPackages] = useState<TripPackage[]>([]);
  const [packageId, setPackageId] = useState<string | null>(lead.entity_id);
  const [savingPackage, setSavingPackage] = useState(false);

  const fetchPackages = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/entities");
      if (res.ok) {
        const json = await res.json();
        setPackages((json.data || []) as TripPackage[]);
      }
    } catch {
      // silently ignore
    }
  }, []);

  useEffect(() => {
    fetchPackages();
  }, [fetchPackages]);

  async function handlePackageChange(value: string) {
    const newId = value === NULL_PACKAGE ? null : value;
    setSavingPackage(true);
    try {
      await fetch(`/api/v1/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_id: newId }),
      });
      setPackageId(newId);
    } finally {
      setSavingPackage(false);
    }
  }

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({
    trip_destination: String(cf.trip_destination ?? ""),
    trip_departure_city: String(cf.trip_departure_city ?? ""),
    trip_start_date: String(cf.trip_start_date ?? ""),
    trip_end_date: String(cf.trip_end_date ?? ""),
    trip_pax_adults: String(cf.trip_pax_adults ?? ""),
    trip_pax_children: String(cf.trip_pax_children ?? ""),
    trip_pax_infants: String(cf.trip_pax_infants ?? ""),
    trip_budget_amount: String(cf.trip_budget_amount ?? ""),
    trip_type: String(cf.trip_type ?? ""),
    trip_flexibility: String(cf.trip_flexibility ?? ""),
  });

  function computeNights(): number | null {
    const s = draft.trip_start_date;
    const e = draft.trip_end_date;
    if (!s || !e) return null;
    const diff = new Date(e).getTime() - new Date(s).getTime();
    const nights = Math.round(diff / 86_400_000);
    return nights > 0 ? nights : null;
  }

  async function handleSave() {
    if (!onSave) return;
    setSaving(true);
    try {
      const fields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(draft)) {
        if (v !== "") fields[k] = v;
      }
      await onSave(fields);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function set(key: string, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  const nights = computeNights();

  return (
    <>
      <div className="border-t border-border" />
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          Trip Inquiry
        </p>
        {isAdmin && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[10px] text-primary hover:underline"
          >
            Edit
          </button>
        )}
      </div>

      {/* Package selector — always visible, saves immediately on change */}
      <div>
        <p className="text-xs text-muted-foreground mb-1">Package</p>
        {isAdmin ? (
          <Select
            value={packageId ?? NULL_PACKAGE}
            onValueChange={handlePackageChange}
            disabled={savingPackage}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Select package" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NULL_PACKAGE}>
                <span className="text-muted-foreground">— Custom trip (no package) —</span>
              </SelectItem>
              {packages.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm font-medium">
            {packageId
              ? (packages.find((p) => p.id === packageId)?.name ?? "Loading…")
              : "Custom trip"}
          </p>
        )}
        {packageId &&
          (() => {
            const desc = packages.find((p) => p.id === packageId)?.description;
            return desc ? (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{desc}</p>
            ) : null;
          })()}
      </div>

      {editing ? (
        <div className="space-y-2">
          <LabeledInput
            label="Destination"
            value={draft.trip_destination}
            placeholder="e.g. Bali, Indonesia"
            onChange={(v) => set("trip_destination", v)}
          />
          <LabeledInput
            label="Departure city"
            value={draft.trip_departure_city}
            placeholder="e.g. Kathmandu"
            onChange={(v) => set("trip_departure_city", v)}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Start date</p>
              <Input
                type="date"
                className="h-7 text-xs"
                value={draft.trip_start_date}
                onChange={(e) => set("trip_start_date", e.target.value)}
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                End date{nights !== null ? ` (${nights}N)` : ""}
              </p>
              <Input
                type="date"
                className="h-7 text-xs"
                value={draft.trip_end_date}
                onChange={(e) => set("trip_end_date", e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Adults</p>
              <Input
                type="number"
                min="0"
                className="h-7 text-xs"
                value={draft.trip_pax_adults}
                onChange={(e) => set("trip_pax_adults", e.target.value)}
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Children</p>
              <Input
                type="number"
                min="0"
                className="h-7 text-xs"
                value={draft.trip_pax_children}
                onChange={(e) => set("trip_pax_children", e.target.value)}
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Infants</p>
              <Input
                type="number"
                min="0"
                className="h-7 text-xs"
                value={draft.trip_pax_infants}
                onChange={(e) => set("trip_pax_infants", e.target.value)}
              />
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Budget (NPR)</p>
            <Input
              type="number"
              min="0"
              className="h-7 text-xs"
              value={draft.trip_budget_amount}
              placeholder="e.g. 150000"
              onChange={(e) => set("trip_budget_amount", e.target.value)}
            />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Trip type</p>
            <Select
              value={draft.trip_type || "__none__"}
              onValueChange={(v) => set("trip_type", v === "__none__" ? "" : v)}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  <span className="text-muted-foreground">Select type</span>
                </SelectItem>
                {TRIP_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Date flexibility</p>
            <Select
              value={draft.trip_flexibility || "__none__"}
              onValueChange={(v) => set("trip_flexibility", v === "__none__" ? "" : v)}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  <span className="text-muted-foreground">Select</span>
                </SelectItem>
                <SelectItem value="exact">Exact dates</SelectItem>
                <SelectItem value="flexible">Flexible</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" className="h-7 text-xs flex-1" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {cf.trip_destination ? (
            <InfoRow label="Destination" value={String(cf.trip_destination)} />
          ) : null}
          {cf.trip_departure_city ? (
            <InfoRow label="Departure city" value={String(cf.trip_departure_city)} />
          ) : null}
          {(cf.trip_start_date || cf.trip_end_date) ? (
            <InfoRow
              label={nights !== null ? `Dates (${computeNightsFromStored(cf)}N)` : "Dates"}
              value={[cf.trip_start_date, cf.trip_end_date].filter(Boolean).join(" → ")}
            />
          ) : null}
          {(cf.trip_pax_adults || cf.trip_pax_children || cf.trip_pax_infants) ? (
            <InfoRow
              label="Pax"
              value={[
                cf.trip_pax_adults ? `${cf.trip_pax_adults} adult${Number(cf.trip_pax_adults) !== 1 ? "s" : ""}` : null,
                cf.trip_pax_children ? `${cf.trip_pax_children} child${Number(cf.trip_pax_children) !== 1 ? "ren" : ""}` : null,
                cf.trip_pax_infants ? `${cf.trip_pax_infants} infant${Number(cf.trip_pax_infants) !== 1 ? "s" : ""}` : null,
              ].filter(Boolean).join(", ")}
            />
          ) : null}
          {cf.trip_budget_amount ? (
            <InfoRow label="Budget" value={formatMoney(Number(cf.trip_budget_amount))} />
          ) : null}
          {cf.trip_type ? (
            <InfoRow label="Trip type" value={tripTypeLabel(String(cf.trip_type)) ?? String(cf.trip_type)} />
          ) : null}
          {cf.trip_flexibility ? (
            <InfoRow
              label="Flexibility"
              value={cf.trip_flexibility === "exact" ? "Exact dates" : "Flexible"}
            />
          ) : null}
          {!cf.trip_destination && !cf.trip_type && !cf.trip_start_date && (
            <p className="text-xs text-muted-foreground italic">
              No trip details yet.{isAdmin ? " Click Edit to add." : ""}
            </p>
          )}
        </div>
      )}
    </>
  );
}

function computeNightsFromStored(cf: Record<string, unknown>): number | null {
  const s = cf.trip_start_date;
  const e = cf.trip_end_date;
  if (!s || !e) return null;
  const diff = new Date(String(e)).getTime() - new Date(String(s)).getTime();
  const nights = Math.round(diff / 86_400_000);
  return nights > 0 ? nights : null;
}

interface LabeledInputProps {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}

function LabeledInput({ label, value, placeholder, onChange }: LabeledInputProps) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <Input
        className="h-7 text-xs"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// Helper components
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
      {children}
    </p>
  );
}

// Utility functions
function getInitials(email: string): string {
  const name = email.split("@")[0];
  const parts = name.split(/[._-]/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
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
      return diffMinutes <= 1 ? "Just now" : `${diffMinutes} minutes ago`;
    }
    return diffHours === 1 ? "1 hour ago" : `${diffHours} hours ago`;
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatFieldLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
