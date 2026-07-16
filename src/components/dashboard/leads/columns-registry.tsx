"use client";

import React from "react";
import Link from "next/link";
import { Eye, RotateCcw } from "lucide-react";
import { TruncatedText } from "@/components/ui/truncated-text";
import { prospectIndustryLabel } from "@/industries/it-agency/leads/prospect-industries";
import { MoveToListSelector } from "@/components/dashboard/leads/move-to-list-selector";
import { StageSelector } from "@/components/dashboard/leads/stage-selector";
import { QualifyRowButton } from "@/components/dashboard/leads/qualify-row-button";
import type { Lead, LeadList, PipelineStage } from "@/types/database";

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
  canEditLeads?: boolean;
  isAdmin?: boolean;
  onStageChange?: (leadId: string, stageId: string) => Promise<void>;
  viewMode?: "trash" | "archived" | "normal";
  onRestore?: (leadId: string) => Promise<void>;
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

const TAG_CLASSES_BY_VALUE: Record<string, string> = {
  other: "bg-amber-100 text-amber-700 hover:bg-amber-200",
  student: "bg-blue-100 text-blue-700 hover:bg-blue-200",
};
const TAG_LABELS_BY_VALUE: Record<string, string> = { other: "Other", student: "Student" };

function LeadTagToggle({ lead, onUpdate }: { lead: Lead; onUpdate: (tags: string[]) => void }) {
  const currentTag = lead.tags?.includes("other") ? "other" : "student";
  const nextTag = currentTag === "student" ? "other" : "student";

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
      className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold cursor-pointer transition-colors ${TAG_CLASSES_BY_VALUE[currentTag]}`}
      title={`Click to change to ${nextTag}`}
    >
      {TAG_LABELS_BY_VALUE[currentTag]}
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
          {/* Desktop: phone under the name (grey) */}
          {lead.phone && (
            <div className="hidden md:block text-xs text-gray-500 mt-0.5">{lead.phone}</div>
          )}
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

  // ── type / list (education_consultancy + travel_agency)
  {
    key: "lead_type",
    label: "Stage",
    group: "standard",
    industries: ["education_consultancy", "travel_agency"],
    defaultVisible: true,
    renderTh: () => (
      <th key="lead_type" className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden md:table-cell w-[160px]">
        Stage
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
                lists={ctx.isAdmin ? ctx.leadLists : ctx.leadLists.filter((l) => !l.is_staging && !l.is_archive)}
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
    renderTd: (lead, ctx) => {
      const assignedEmail = lead.assigned_to ? ctx.memberMap[lead.assigned_to] : null;
      const assignedName = lead.assigned_to ? ctx.memberNames?.[lead.assigned_to] : null;
      return (
        <td key="assigned" className="px-3 py-1.5 hidden lg:table-cell text-sm font-normal text-[#787871]">
          {assignedEmail ? (
            <span>{assignedName || assignedEmail.split("@")[0]}</span>
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
      // Stages of THIS lead's pipeline (ctx.stages spans all pipelines).
      const leadStages = ctx.stages.filter((s) => s.pipeline_id === lead.pipeline_id);
      const stage =
        leadStages.find((s) => s.id === lead.stage_id) ??
        ctx.stages.find((s) => s.id === lead.stage_id);
      // Editable inline when the user can edit leads and the lead's pipeline stages
      // are available. Trash/archive views pass no onStageChange ⇒ read-only badge.
      const editable = !!ctx.canEditLeads && !!ctx.onStageChange && leadStages.length > 0;
      const badgeColors: Record<string, string> = {
        new: "bg-blue-100 text-blue-800",
        contacted: "bg-yellow-100 text-yellow-800",
        enrolled: "bg-green-100 text-green-800",
        rejected: "bg-red-100 text-red-800",
      };
      return (
        <td key="status" className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
          {editable ? (
            <StageSelector
              currentStageId={lead.stage_id}
              stages={leadStages}
              onChange={(stageId) => ctx.onStageChange!(lead.id, stageId)}
            />
          ) : (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
                stage ? "" : badgeColors[lead.status] || "bg-gray-100 text-gray-800"
              }`}
              style={stage ? { backgroundColor: `${stage.color}20`, color: stage.color } : undefined}
            >
              {stage?.name || lead.status}
            </span>
          )}
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

  // ── ref_code (affiliate code — education_consultancy only)
  {
    key: "ref_code",
    label: "Ref Code",
    group: "standard",
    defaultVisible: true,
    industries: ["education_consultancy"],
    renderTh: () => (
      <th key="ref_code" className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden md:table-cell min-w-[100px]">
        Ref Code
      </th>
    ),
    renderTd: (lead) => (
      <td key="ref_code" className="px-3 py-1.5 hidden md:table-cell whitespace-nowrap">
        {lead.ref_code ? (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium whitespace-nowrap">
            {lead.ref_code}
          </span>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
    ),
  },

  // ── form_source (which page lead came from — education_consultancy only)
  {
    key: "form_source",
    label: "Form Source",
    group: "standard",
    defaultVisible: true,
    industries: ["education_consultancy"],
    renderTh: () => (
      <th key="form_source" className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden md:table-cell min-w-[110px]">
        Form Source
      </th>
    ),
    renderTd: (lead) => (
      <td key="form_source" className="px-3 py-1.5 hidden md:table-cell whitespace-nowrap">
        {lead.form_source ? (
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 whitespace-nowrap">
            {lead.form_source}
          </span>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
    ),
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

  // ── archived_from_stage — the stage(list) the lead was in when archived
  {
    key: "archived_from_stage",
    label: "Stage",
    group: "standard",
    defaultVisible: false,
    renderTh: () => (
      <th key="archived_from_stage" className="px-3 py-2 text-left text-xs font-medium text-gray-600 min-w-[110px]">
        Stage
      </th>
    ),
    renderTd: (lead, ctx) => {
      const list = lead.archived_from_list_id
        ? (ctx.leadLists ?? []).find((l) => l.id === lead.archived_from_list_id)
        : null;
      return (
        <td key="archived_from_stage" className="px-3 py-1.5 text-sm font-normal text-[#787871]">
          {list?.name || <span className="text-gray-400">—</span>}
        </td>
      );
    },
  },

  // ── archived_from_status — the pipeline status the lead held when archived
  {
    key: "archived_from_status",
    label: "Status",
    group: "standard",
    defaultVisible: false,
    renderTh: () => (
      <th key="archived_from_status" className="px-3 py-2 text-left text-xs font-medium text-gray-600 min-w-[110px]">
        Status
      </th>
    ),
    renderTd: (lead, ctx) => {
      const slug = lead.archived_from_status;
      const name = slug
        ? (ctx.stages.find((s) => s.slug === slug)?.name ?? humanizeKey(slug))
        : null;
      return (
        <td key="archived_from_status" className="px-3 py-1.5 text-sm font-normal text-[#787871]">
          {name || <span className="text-gray-400">—</span>}
        </td>
      );
    },
  },

  // ── archived_by — who moved the lead into the archive
  {
    key: "archived_by",
    label: "Archived By",
    group: "standard",
    defaultVisible: false,
    renderTh: () => (
      <th key="archived_by" className="px-3 py-2 text-left text-xs font-medium text-gray-600 min-w-[120px]">
        Archived By
      </th>
    ),
    renderTd: (lead, ctx) => {
      const email = lead.archived_by ? ctx.memberMap[lead.archived_by] : null;
      const name = lead.archived_by ? ctx.memberNames?.[lead.archived_by] : null;
      return (
        <td key="archived_by" className="px-3 py-1.5 text-sm font-normal text-[#787871]">
          {email ? (name || email.split("@")[0]) : <span className="text-gray-400">—</span>}
        </td>
      );
    },
  },

  // ── archived_at — when the lead was archived
  {
    key: "archived_at",
    label: "Archived Date",
    group: "standard",
    defaultVisible: false,
    renderTh: () => (
      <th key="archived_at" className="px-3 py-2 text-left text-xs font-medium text-gray-600 min-w-[90px]">
        Archived Date
      </th>
    ),
    renderTd: (lead) => (
      <td key="archived_at" className="px-3 py-1.5 text-sm font-normal text-[#787871]">
        {lead.archived_at ? new Date(lead.archived_at).toLocaleDateString() : <span className="text-gray-400">—</span>}
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
