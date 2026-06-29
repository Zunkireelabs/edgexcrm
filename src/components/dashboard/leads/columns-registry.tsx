"use client";

import React from "react";
import Link from "next/link";
import { Check, Eye, RotateCcw } from "lucide-react";
import { TruncatedText } from "@/components/ui/truncated-text";
import { prospectIndustryLabel } from "@/industries/it-agency/leads/prospect-industries";
import { MoveToListSelector } from "@/components/dashboard/leads/move-to-list-selector";
import { QualifyRowButton } from "@/components/dashboard/leads/qualify-row-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { Lead, LeadList, PipelineStage } from "@/types/database";
import type { TeamMember } from "@/lib/supabase/queries";

// Column width constants — kept in sync with leads-table.tsx
export const NAME_COLUMN_WIDTH = 180;
export const EMAIL_COLUMN_WIDTH = 200;
export const EMAIL_MOBILE_WIDTH = 140;

export interface LeadColumnCtx {
  memberMap: Record<string, string>;
  memberNames?: Record<string, string>;
  formMap: Record<string, string>;
  entityMap: Record<string, string>;
  branchMap: Record<string, string>;
  memberBranchMap: Record<string, string>;
  roleMap?: Record<string, string>;
  stages: PipelineStage[];
  industryId: string | null | undefined;
  selectedIds: Set<string>;
  unreadLeadIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onPreviewToggle: (id: string) => void;
  onTagUpdate: (leadId: string, tags: string[]) => void;
  onTypeUpdate: (leadId: string, type: string) => void;
  leadLists?: LeadList[];
  onListMove?: (leadId: string, listId: string, archiveReason?: string) => Promise<void>;
  viewMode?: "trash" | "archived" | "normal";
  onRestore?: (leadId: string) => Promise<void>;
  // Inline Assigned-cell editing
  canAssign?: boolean;
  teamMembers?: TeamMember[];
  onAssignedChange?: (leadId: string, userId: string | null) => Promise<void>;
  // Lead Type (education_consultancy) — configurable dropdown sourced from /api/v1/lead-types
  leadTypes?: { id: string; slug: string; label: string; is_default: boolean }[];
}

export interface LeadColumn {
  key: string;
  label: string;
  group: "standard" | "industry" | "custom";
  industries?: string[];
  required?: boolean;
  defaultVisible?: boolean;
  thClassName?: string;
  tdClassName?: string;
  renderTh: (ctx: LeadColumnCtx) => React.ReactNode;
  renderTd: (lead: Lead, ctx: LeadColumnCtx) => React.ReactNode;
}

// ─── inline sub-components (moved from leads-table.tsx) ───────────────────────

function LeadTypeToggle({ lead, onUpdate }: { lead: Lead; onUpdate: (type: string) => void }) {
  const currentType = lead.lead_type || "lead";
  const nextType = currentType === "lead" ? "prospect" : "lead";

  async function toggle() {
    onUpdate(nextType);
    try {
      const res = await fetch(`/api/v1/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_type: nextType }),
      });
      if (!res.ok) throw new Error();
    } catch {
      onUpdate(currentType);
    }
  }

  return (
    <button
      onClick={toggle}
      className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold cursor-pointer transition-colors ${
        currentType === "prospect"
          ? "bg-purple-100 text-purple-700 hover:bg-purple-200"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
      }`}
      title={`Click to change to ${nextType}`}
    >
      {currentType === "prospect" ? "Prospect" : "Lead"}
    </button>
  );
}

function AssignedCellEditor({ lead, ctx }: { lead: Lead; ctx: LeadColumnCtx }) {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  const assignedEmail = lead.assigned_to ? ctx.memberMap[lead.assigned_to] : null;
  const assignedName = lead.assigned_to ? ctx.memberNames?.[lead.assigned_to] : null;
  const display = assignedEmail ? assignedName || assignedEmail.split("@")[0] : null;

  // Read-only when the viewer isn't allowed to reassign, or when no team data is plumbed.
  if (!ctx.canAssign || !ctx.onAssignedChange || !ctx.teamMembers) {
    return display ? (
      <span>{display}</span>
    ) : (
      <span className="text-gray-400">—</span>
    );
  }

  const handleSelect = async (userId: string | null) => {
    if (userId === (lead.assigned_to ?? null)) {
      setOpen(false);
      return;
    }
    setPending(true);
    try {
      await ctx.onAssignedChange!(lead.id, userId);
    } finally {
      setPending(false);
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={pending}
          className={`inline-flex items-center text-left text-sm rounded px-1 -mx-1 hover:bg-gray-100 transition-colors ${
            display ? "" : "text-gray-400"
          } ${pending ? "opacity-50" : ""}`}
        >
          {display ?? "—"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder="Search team member…" />
          <CommandList>
            <CommandEmpty>No member found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__unassigned" onSelect={() => handleSelect(null)}>
                <span className="text-gray-500">Unassigned</span>
                {lead.assigned_to == null && <Check className="ml-auto h-4 w-4" />}
              </CommandItem>
              {ctx.teamMembers.map((m) => {
                const label = m.name || m.email.split("@")[0];
                return (
                  <CommandItem
                    key={m.user_id}
                    value={`${m.name || ""} ${m.email}`}
                    onSelect={() => handleSelect(m.user_id)}
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="truncate">{label}</span>
                      <span className="truncate text-xs text-gray-400">{m.email}</span>
                    </div>
                    {lead.assigned_to === m.user_id && (
                      <Check className="ml-auto h-4 w-4 shrink-0" />
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function LeadTypeSelect({
  lead,
  options,
  onUpdate,
}: {
  lead: Lead;
  options: NonNullable<LeadColumnCtx["leadTypes"]>;
  onUpdate: (tags: string[]) => void;
}) {
  const defaultSlug = options.find((o) => o.is_default)?.slug ?? options[0]?.slug ?? "";
  const currentSlug = lead.tags?.[0] ?? defaultSlug;

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const slug = e.target.value;
    if (slug === lead.tags?.[0]) return;
    const newTags = [slug];
    const prev = lead.tags ?? [];
    onUpdate(newTags);
    try {
      const res = await fetch(`/api/v1/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: newTags }),
      });
      if (!res.ok) throw new Error();
    } catch {
      onUpdate(prev);
    }
  }

  return (
    <select
      value={currentSlug}
      onChange={handleChange}
      onClick={(e) => e.stopPropagation()}
      className="h-6 rounded border border-input bg-background px-1.5 text-[10px] font-medium focus:outline-none focus:ring-2 focus:ring-ring max-w-[120px]"
    >
      {options.map((o) => (
        <option key={o.id} value={o.slug}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ─── Static column catalog ─────────────────────────────────────────────────────

const STATIC_COLUMNS: LeadColumn[] = [
  // ── ANCHOR: select (non-removable, always first — rendered via dedicated anchor slot)
  // Handled outside the column map in leads-table; included here only so Phase 2 can
  // reference it. Not returned by getLeadColumns().

  // ── name (required anchor, always first after select)
  {
    key: "name",
    label: "Name",
    group: "standard",
    required: true,
    defaultVisible: true,
    renderTh: () => (
      <th key="name" className="px-3 py-2 text-left text-xs font-medium text-gray-600 w-[200px]">
        Name
      </th>
    ),
    renderTd: (lead, ctx) => (
        <td key="name" className="px-3 py-1.5">
          <div className="group/name relative" style={{ width: NAME_COLUMN_WIDTH }}>
            {ctx.unreadLeadIds.has(lead.id) && (
              <span
                className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-red-500"
                aria-label="Unread notification"
              />
            )}
            <Link
              href={`/leads/${lead.id}`}
              className="text-sm font-medium text-[#0f0f10] hover:underline block pr-0 group-hover/name:pr-[72px] transition-[padding] duration-100"
            >
              <TruncatedText
                text={`${lead.first_name || ""} ${lead.last_name || ""}`.trim() || "—"}
              />
            </Link>
            <button
              onClick={(e) => {
                e.stopPropagation();
                ctx.onPreviewToggle(lead.id);
              }}
              className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover/name:opacity-100 transition-opacity md:inline-flex hidden items-center gap-1 px-2 py-0.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded border border-gray-200"
            >
              <Eye size={12} />
              Preview
            </button>
          </div>
          {/* Mobile: email + preview icon */}
          <div className="flex items-center gap-2 md:hidden">
            <div className="text-xs text-gray-500">
              <TruncatedText text={lead.email || ""} maxWidth={EMAIL_MOBILE_WIDTH} />
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                ctx.onPreviewToggle(lead.id);
              }}
              className="shrink-0 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
            >
              <Eye size={14} />
            </button>
          </div>
        </td>
    ),
  },

  // ── tags (education_consultancy only, defaultVisible)
  // Storage is still `leads.tags[0]`; options come from per-tenant `lead_types` (mig 090).
  {
    key: "tags",
    label: "Lead Type",
    group: "standard",
    industries: ["education_consultancy"],
    defaultVisible: true,
    renderTh: () => (
      <th key="tags" className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden md:table-cell w-[120px]">
        Lead Type
      </th>
    ),
    renderTd: (lead, ctx) => (
      <td key="tags" className="px-3 py-1.5 hidden md:table-cell" onClick={(e) => e.stopPropagation()}>
        {ctx.leadTypes && ctx.leadTypes.length > 0 ? (
          <LeadTypeSelect
            lead={lead}
            options={ctx.leadTypes}
            onUpdate={(newTags) => ctx.onTagUpdate(lead.id, newTags)}
          />
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>
    ),
  },

  // ── type / list (education_consultancy + travel_agency)
  {
    key: "lead_type",
    label: "List",
    group: "standard",
    industries: ["education_consultancy", "travel_agency"],
    defaultVisible: true,
    renderTh: () => (
      <th key="lead_type" className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden md:table-cell w-[160px]">
        List
      </th>
    ),
    renderTd: (lead, ctx) => {
      // Recycle-bin views (Delete / Archived) replace the move control with Restore.
      if (ctx.viewMode === "trash" || ctx.viewMode === "archived") {
        return (
          <td key="lead_type" className="px-3 py-1.5 hidden md:table-cell" onClick={(e) => e.stopPropagation()}>
            {ctx.onRestore ? (
              <button
                type="button"
                onClick={() => ctx.onRestore!(lead.id)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Restore
              </button>
            ) : (
              <span className="text-xs text-muted-foreground">
                {ctx.viewMode === "trash" ? "Deleted" : "Archived"}
              </span>
            )}
          </td>
        );
      }
      const intakeList = ctx.leadLists?.find((l) => l.is_intake);
      const qualifiedList = ctx.leadLists?.find((l) => l.slug === "qualified");
      const isInIntake = intakeList && lead.list_id === intakeList.id;
      return (
        <td key="lead_type" className="px-3 py-1.5 hidden md:table-cell" onClick={(e) => e.stopPropagation()}>
          {ctx.leadLists && ctx.leadLists.length > 0 && ctx.onListMove ? (
            <div className="flex flex-col gap-0.5 items-start">
              <MoveToListSelector
                leadId={lead.id}
                currentListId={lead.list_id ?? null}
                lists={ctx.leadLists}
                onMove={(listId, archiveReason) => ctx.onListMove!(lead.id, listId, archiveReason)}
              />
              {ctx.industryId === "education_consultancy" && isInIntake && qualifiedList && (
                <QualifyRowButton
                  leadId={lead.id}
                  currentDestinations={(lead as { destinations?: string[] }).destinations ?? []}
                  currentFieldOfStudy={(lead as { field_of_study?: string | null }).field_of_study ?? null}
                  currentDegreeLevel={(lead as { degree_level?: string | null }).degree_level ?? null}
                  qualifiedList={qualifiedList}
                  onQualified={(listId) => ctx.onListMove!(lead.id, listId)}
                />
              )}
            </div>
          ) : (
            <LeadTypeToggle
              lead={lead}
              onUpdate={(newType) => ctx.onTypeUpdate(lead.id, newType)}
            />
          )}
        </td>
      );
    },
  },

  // ── email
  {
    key: "email",
    label: "Email",
    group: "standard",
    defaultVisible: true,
    renderTh: () => (
      <th key="email" className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden md:table-cell w-[220px]">
        Email
      </th>
    ),
    renderTd: (lead) => (
      <td key="email" className="px-3 py-1.5 hidden md:table-cell text-sm font-normal text-[#787871]">
        <TruncatedText text={lead.email || ""} maxWidth={EMAIL_COLUMN_WIDTH} />
      </td>
    ),
  },

  // ── phone
  {
    key: "phone",
    label: "Phone",
    group: "standard",
    defaultVisible: false,
    renderTh: () => (
      <th key="phone" className="px-3 py-2 text-left text-xs font-medium text-gray-600 min-w-[120px]">
        Phone
      </th>
    ),
    renderTd: (lead) => (
      <td key="phone" className="px-3 py-1.5 text-sm font-normal text-[#787871]">
        {lead.phone || <span className="text-gray-400">—</span>}
      </td>
    ),
  },

  // ── location (city + country)
  {
    key: "location",
    label: "Location",
    group: "standard",
    defaultVisible: true,
    renderTh: () => (
      <th key="location" className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden lg:table-cell min-w-[100px]">
        Location
      </th>
    ),
    renderTd: (lead) => (
      <td key="location" className="px-3 py-1.5 hidden lg:table-cell text-sm font-normal text-[#787871]">
        {lead.city || <span className="text-gray-400">—</span>}
      </td>
    ),
  },

  // ── assigned
  {
    key: "assigned",
    label: "Assigned",
    group: "standard",
    defaultVisible: true,
    renderTh: () => (
      <th key="assigned" className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden lg:table-cell min-w-[120px]">
        Assigned
      </th>
    ),
    renderTd: (lead, ctx) => (
      <td
        key="assigned"
        className="px-3 py-1.5 hidden lg:table-cell text-sm font-normal text-[#787871]"
        onClick={(e) => e.stopPropagation()}
      >
        <AssignedCellEditor lead={lead} ctx={ctx} />
      </td>
    ),
  },

  // ── status
  {
    key: "status",
    label: "Status",
    group: "standard",
    defaultVisible: true,
    renderTh: () => (
      <th key="status" className="px-3 py-2 text-left text-xs font-medium text-gray-600 min-w-[100px]">
        Status
      </th>
    ),
    renderTd: (lead, ctx) => {
      const stage = ctx.stages.find((s) => s.id === lead.stage_id);
      const badgeColors: Record<string, string> = {
        new: "bg-blue-100 text-blue-800",
        contacted: "bg-yellow-100 text-yellow-800",
        enrolled: "bg-green-100 text-green-800",
        rejected: "bg-red-100 text-red-800",
      };
      return (
        <td key="status" className="px-3 py-1.5">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
              stage ? "" : badgeColors[lead.status] || "bg-gray-100 text-gray-800"
            }`}
            style={stage ? { backgroundColor: `${stage.color}20`, color: stage.color } : undefined}
          >
            {stage?.name || lead.status}
          </span>
        </td>
      );
    },
  },

  // ── source (intake_source)
  {
    key: "source",
    label: "Source",
    group: "standard",
    defaultVisible: true,
    renderTh: () => (
      <th key="source" className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden md:table-cell min-w-[120px]">
        Source
      </th>
    ),
    renderTd: (lead, ctx) => {
      const formName = lead.form_config_id ? ctx.formMap[lead.form_config_id] : null;
      const source = formName || lead.intake_source;
      const label = formName || (source ? source.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : null);
      return (
        <td key="source" className="px-3 py-1.5 hidden md:table-cell whitespace-nowrap">
          {label ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 whitespace-nowrap">
              {label}
            </span>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </td>
      );
    },
  },

  // ── medium (intake_medium)
  {
    key: "medium",
    label: "Medium",
    group: "standard",
    defaultVisible: false,
    renderTh: () => (
      <th key="medium" className="px-3 py-2 text-left text-xs font-medium text-gray-600 min-w-[100px]">
        Medium
      </th>
    ),
    renderTd: (lead) => (
      <td key="medium" className="px-3 py-1.5 text-sm font-normal text-[#787871]">
        {lead.intake_medium || <span className="text-gray-400">—</span>}
      </td>
    ),
  },

  // ── campaign (intake_campaign)
  {
    key: "campaign",
    label: "Campaign",
    group: "standard",
    defaultVisible: false,
    renderTh: () => (
      <th key="campaign" className="px-3 py-2 text-left text-xs font-medium text-gray-600 min-w-[110px]">
        Campaign
      </th>
    ),
    renderTd: (lead) => (
      <td key="campaign" className="px-3 py-1.5 text-sm font-normal text-[#787871]">
        {lead.intake_campaign || <span className="text-gray-400">—</span>}
      </td>
    ),
  },

  // ── last_activity
  {
    key: "last_activity",
    label: "Last activity",
    group: "standard",
    defaultVisible: true,
    renderTh: () => (
      <th key="last_activity" className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden md:table-cell min-w-[90px]">
        Last activity
      </th>
    ),
    renderTd: (lead) => (
      <td key="last_activity" className="px-3 py-1.5 hidden md:table-cell text-sm font-normal text-[#787871]">
        {new Date(lead.last_activity_at).toLocaleDateString()}
      </td>
    ),
  },

  // ── created (created_at)
  {
    key: "created",
    label: "Created",
    group: "standard",
    defaultVisible: false,
    renderTh: () => (
      <th key="created" className="px-3 py-2 text-left text-xs font-medium text-gray-600 min-w-[90px]">
        Created
      </th>
    ),
    renderTd: (lead) => (
      <td key="created" className="px-3 py-1.5 text-sm font-normal text-[#787871]">
        {new Date(lead.created_at).toLocaleDateString()}
      </td>
    ),
  },

  // ── preferred_contact
  {
    key: "preferred_contact",
    label: "Pref. Contact",
    group: "standard",
    defaultVisible: false,
    renderTh: () => (
      <th key="preferred_contact" className="px-3 py-2 text-left text-xs font-medium text-gray-600 min-w-[110px]">
        Pref. Contact
      </th>
    ),
    renderTd: (lead) => (
      <td key="preferred_contact" className="px-3 py-1.5 text-sm font-normal text-[#787871]">
        {lead.preferred_contact_method || <span className="text-gray-400">—</span>}
      </td>
    ),
  },

  // ── display_id
  {
    key: "display_id",
    label: "ID",
    group: "standard",
    defaultVisible: false,
    renderTh: () => (
      <th key="display_id" className="px-3 py-2 text-left text-xs font-medium text-gray-600 min-w-[80px]">
        ID
      </th>
    ),
    renderTd: (lead) => (
      <td key="display_id" className="px-3 py-1.5 text-sm font-normal text-[#787871]">
        {lead.display_id || <span className="text-gray-400">—</span>}
      </td>
    ),
  },

  // ── ai_score
  {
    key: "ai_score",
    label: "AI Score",
    group: "standard",
    defaultVisible: false,
    renderTh: () => (
      <th key="ai_score" className="px-3 py-2 text-left text-xs font-medium text-gray-600 min-w-[80px]">
        AI Score
      </th>
    ),
    renderTd: (lead) => (
      <td key="ai_score" className="px-3 py-1.5 text-sm font-normal text-[#787871]">
        {lead.ai_score != null ? lead.ai_score : <span className="text-gray-400">—</span>}
      </td>
    ),
  },

  // ── ai_priority
  {
    key: "ai_priority",
    label: "AI Priority",
    group: "standard",
    defaultVisible: false,
    renderTh: () => (
      <th key="ai_priority" className="px-3 py-2 text-left text-xs font-medium text-gray-600 min-w-[90px]">
        AI Priority
      </th>
    ),
    renderTd: (lead) => (
      <td key="ai_priority" className="px-3 py-1.5 text-sm font-normal text-[#787871]">
        {lead.ai_priority || <span className="text-gray-400">—</span>}
      </td>
    ),
  },

  // ── branch (Enterprise plan only — filtered by maxBranches in getLeadColumns)
  {
    key: "branch",
    label: "Branch",
    group: "standard",
    defaultVisible: true,
    renderTh: () => (
      <th key="branch" className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden md:table-cell min-w-[100px]">
        Branch
      </th>
    ),
    renderTd: (lead, ctx) => (
      <td key="branch" className="px-3 py-1.5 hidden md:table-cell text-sm font-normal text-[#787871]">
        {(() => {
          const bid = lead.branch_id ?? ctx.memberBranchMap[lead.assigned_to ?? ""] ?? null;
          return bid ? (ctx.branchMap[bid] ?? "—") : <span className="text-gray-400">—</span>;
        })()}
      </td>
    ),
  },

  // ─── IT Agency columns (industry-gated) ─────────────────────────────────────

  // ── company
  {
    key: "company",
    label: "Company",
    group: "industry",
    industries: ["it_agency"],
    defaultVisible: false,
    renderTh: () => (
      <th key="company" className="px-3 py-2 text-left text-xs font-medium text-gray-600 min-w-[140px]">
        Company
      </th>
    ),
    renderTd: (lead) => (
      <td key="company" className="px-3 py-1.5 text-sm font-normal text-[#787871]">
        {lead.company_name || <span className="text-gray-400">—</span>}
      </td>
    ),
  },

  // ── designation
  {
    key: "designation",
    label: "Designation",
    group: "industry",
    industries: ["it_agency"],
    defaultVisible: false,
    renderTh: () => (
      <th key="designation" className="px-3 py-2 text-left text-xs font-medium text-gray-600 min-w-[120px]">
        Designation
      </th>
    ),
    renderTd: (lead) => (
      <td key="designation" className="px-3 py-1.5 text-sm font-normal text-[#787871]">
        {lead.designation || <span className="text-gray-400">—</span>}
      </td>
    ),
  },

  // ── prospect_industry
  {
    key: "prospect_industry",
    label: "Prospect Industry",
    group: "industry",
    industries: ["it_agency"],
    defaultVisible: false,
    renderTh: () => (
      <th key="prospect_industry" className="px-3 py-2 text-left text-xs font-medium text-gray-600 min-w-[140px]">
        Prospect Industry
      </th>
    ),
    renderTd: (lead) => (
      <td key="prospect_industry" className="px-3 py-1.5 text-sm font-normal text-[#787871]">
        {prospectIndustryLabel(lead.prospect_industry) || <span className="text-gray-400">—</span>}
      </td>
    ),
  },

  // ── salutation
  {
    key: "salutation",
    label: "Salutation",
    group: "industry",
    industries: ["it_agency"],
    defaultVisible: false,
    renderTh: () => (
      <th key="salutation" className="px-3 py-2 text-left text-xs font-medium text-gray-600 min-w-[90px]">
        Salutation
      </th>
    ),
    renderTd: (lead) => (
      <td key="salutation" className="px-3 py-1.5 text-sm font-normal text-[#787871]">
        {lead.salutation || <span className="text-gray-400">—</span>}
      </td>
    ),
  },

  // ── company_email
  {
    key: "company_email",
    label: "Company Email",
    group: "industry",
    industries: ["it_agency"],
    defaultVisible: false,
    renderTh: () => (
      <th key="company_email" className="px-3 py-2 text-left text-xs font-medium text-gray-600 min-w-[160px]">
        Company Email
      </th>
    ),
    renderTd: (lead) => (
      <td key="company_email" className="px-3 py-1.5 text-sm font-normal text-[#787871]">
        {lead.company_email || <span className="text-gray-400">—</span>}
      </td>
    ),
  },

  // ── owner (owner_id → member)
  {
    key: "owner",
    label: "Owner",
    group: "industry",
    industries: ["it_agency"],
    defaultVisible: false,
    renderTh: () => (
      <th key="owner" className="px-3 py-2 text-left text-xs font-medium text-gray-600 min-w-[120px]">
        Owner
      </th>
    ),
    renderTd: (lead, ctx) => {
      const ownerEmail = lead.owner_id ? ctx.memberMap[lead.owner_id] : null;
      const ownerName = lead.owner_id ? ctx.memberNames?.[lead.owner_id] : null;
      return (
        <td key="owner" className="px-3 py-1.5 text-sm font-normal text-[#787871]">
          {ownerEmail ? (
            <span>{ownerName || ownerEmail.split("@")[0]}</span>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </td>
      );
    },
  },

  // ── assigned_role (universal; default-visible only in staging cockpit via extraDefaultVisibleKeys)
  {
    key: "assigned_role",
    label: "Assigned (Role)",
    group: "standard",
    defaultVisible: false,
    renderTh: () => (
      <th key="assigned_role" className="px-3 py-2 text-left text-xs font-medium text-gray-600 min-w-[140px]">
        Assigned (Role)
      </th>
    ),
    renderTd: (lead, ctx) => {
      const display = lead.assigned_to ? (ctx.roleMap?.[lead.assigned_to] ?? null) : null;
      return (
        <td key="assigned_role" className="px-3 py-1.5 text-sm font-normal text-[#787871]">
          {display ? display : <span className="text-gray-400">—</span>}
        </td>
      );
    },
  },

  // ── package (travel_agency only)
  {
    key: "package",
    label: "Package",
    group: "industry",
    industries: ["travel_agency"],
    defaultVisible: true,
    thClassName: "hidden md:table-cell",
    tdClassName: "hidden md:table-cell",
    renderTh: () => (
      <th key="package" className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden md:table-cell min-w-[120px]">
        Package
      </th>
    ),
    renderTd: (lead, ctx) => {
      const name = lead.entity_id ? (ctx.entityMap[lead.entity_id] ?? "—") : (
        <span className="text-gray-400">Custom trip</span>
      );
      return (
        <td key="package" className="px-3 py-1.5 text-sm text-[#787871] hidden md:table-cell">
          {name}
        </td>
      );
    },
  },

];

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the ordered column catalog for a given industry.
 * Static columns are filtered by their `industries` gate (if any).
 * Custom-field columns (`cf:<key>`) are appended before actions.
 */
export function getLeadColumns(
  industryId: string | null | undefined,
  customFieldKeys: string[] = [],
  maxBranches = 1,
): LeadColumn[] {
  const staticCols = STATIC_COLUMNS.filter((col) => {
    if (col.key === "branch") return maxBranches > 1;
    if (!col.industries) return true;
    return industryId != null && col.industries.includes(industryId);
  });

  const customCols: LeadColumn[] = customFieldKeys.map((key) => ({
    key: `cf:${key}`,
    label: humanizeKey(key),
    group: "custom" as const,
    defaultVisible: false,
    renderTh: () => (
      <th key={`cf:${key}`} className="px-3 py-2 text-left text-xs font-medium text-gray-600 min-w-[120px]">
        {humanizeKey(key)}
      </th>
    ),
    renderTd: (lead) => (
      <td key={`cf:${key}`} className="px-3 py-1.5 text-sm font-normal text-[#787871]">
        {String(lead.custom_fields?.[key] ?? "") || <span className="text-gray-400">—</span>}
      </td>
    ),
  }));

  return [...staticCols, ...customCols];
}

/**
 * Returns the keys that should be visible by default for a given industry.
 * Matches today's hardcoded column set exactly.
 */
export function getDefaultVisibleKeys(industryId: string | null | undefined, maxBranches = 1): string[] {
  const cols = getLeadColumns(industryId, [], maxBranches);
  const keys = cols.filter((c) => c.defaultVisible).map((c) => c.key);
  if (industryId === "education_consultancy" && !keys.includes("display_id")) {
    keys.splice(1, 0, "display_id"); // insert after name column
  }
  return keys;
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
