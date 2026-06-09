"use client";

import React from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { TruncatedText } from "@/components/ui/truncated-text";
import { prospectIndustryLabel } from "@/industries/it-agency/leads/prospect-industries";
import type { Lead, PipelineStage } from "@/types/database";

// Column width constants — kept in sync with leads-table.tsx
export const NAME_COLUMN_WIDTH = 180;
export const EMAIL_COLUMN_WIDTH = 200;
export const EMAIL_MOBILE_WIDTH = 140;

export interface LeadColumnCtx {
  memberMap: Record<string, string>;
  formMap: Record<string, string>;
  stages: PipelineStage[];
  industryId: string | null | undefined;
  selectedIds: Set<string>;
  unreadLeadIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onPreviewToggle: (id: string) => void;
  onTagUpdate: (leadId: string, tags: string[]) => void;
  onTypeUpdate: (leadId: string, type: string) => void;
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

function LeadTagToggle({ lead, onUpdate }: { lead: Lead; onUpdate: (tags: string[]) => void }) {
  const currentTag = lead.tags?.includes("parent") ? "parent" : "student";
  const nextTag = currentTag === "student" ? "parent" : "student";

  async function toggle() {
    const newTags = [nextTag];
    onUpdate(newTags);
    try {
      const res = await fetch(`/api/v1/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: newTags }),
      });
      if (!res.ok) throw new Error();
    } catch {
      onUpdate(lead.tags || ["student"]);
    }
  }

  return (
    <button
      onClick={toggle}
      className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold cursor-pointer transition-colors ${
        currentTag === "parent"
          ? "bg-green-100 text-green-700 hover:bg-green-200"
          : "bg-blue-100 text-blue-700 hover:bg-blue-200"
      }`}
      title={`Click to change to ${nextTag}`}
    >
      {currentTag === "parent" ? "Parent" : "Student"}
    </button>
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

  // ── tags (education_consultancy only, defaultVisible when showTags)
  {
    key: "tags",
    label: "Tag",
    group: "standard",
    industries: ["education_consultancy"],
    defaultVisible: true,
    renderTh: () => (
      <th key="tags" className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden md:table-cell w-[70px]">
        Tag
      </th>
    ),
    renderTd: (lead, ctx) => (
      <td key="tags" className="px-3 py-1.5 hidden md:table-cell" onClick={(e) => e.stopPropagation()}>
        <LeadTagToggle
          lead={lead}
          onUpdate={(newTags) => ctx.onTagUpdate(lead.id, newTags)}
        />
      </td>
    ),
  },

  // ── type (education_consultancy only, defaultVisible when showTags)
  {
    key: "lead_type",
    label: "Type",
    group: "standard",
    industries: ["education_consultancy"],
    defaultVisible: true,
    renderTh: () => (
      <th key="lead_type" className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden md:table-cell w-[80px]">
        Type
      </th>
    ),
    renderTd: (lead, ctx) => (
      <td key="lead_type" className="px-3 py-1.5 hidden md:table-cell" onClick={(e) => e.stopPropagation()}>
        <LeadTypeToggle
          lead={lead}
          onUpdate={(newType) => ctx.onTypeUpdate(lead.id, newType)}
        />
      </td>
    ),
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
    renderTd: (lead, ctx) => {
      const assignedEmail = lead.assigned_to ? ctx.memberMap[lead.assigned_to] : null;
      return (
        <td key="assigned" className="px-3 py-1.5 hidden lg:table-cell text-sm font-normal text-[#787871]">
          {assignedEmail ? (
            <span>{assignedEmail.split("@")[0]}</span>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </td>
      );
    },
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
      return (
        <td key="owner" className="px-3 py-1.5 text-sm font-normal text-[#787871]">
          {ownerEmail ? (
            <span>{ownerEmail.split("@")[0]}</span>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </td>
      );
    },
  },

  // ── actions (required anchor, always last)
  {
    key: "actions",
    label: "Actions",
    group: "standard",
    required: true,
    defaultVisible: true,
    renderTh: () => (
      <th key="actions" className="px-3 py-2 text-right text-xs font-medium text-gray-600 w-20">
        Actions
      </th>
    ),
    renderTd: (lead) => (
      <td key="actions" className="px-3 py-1.5 text-right">
        <div className="flex items-center justify-end gap-1">
          <Link
            href={`/leads/${lead.id}`}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <Eye size={15} />
          </Link>
        </div>
      </td>
    ),
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
): LeadColumn[] {
  const staticCols = STATIC_COLUMNS.filter((col) => {
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

  // Inject custom cols between last standard/industry col and actions
  const actionCol = staticCols.find((c) => c.key === "actions")!;
  const withoutActions = staticCols.filter((c) => c.key !== "actions");
  return [...withoutActions, ...customCols, actionCol];
}

/**
 * Returns the keys that should be visible by default for a given industry.
 * Matches today's hardcoded column set exactly.
 */
export function getDefaultVisibleKeys(industryId: string | null | undefined): string[] {
  const cols = getLeadColumns(industryId, []);
  return cols.filter((c) => c.defaultVisible).map((c) => c.key);
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
