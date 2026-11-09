"use client";

// Leads table v2 (EDGEX-117): per-column presentation (width, icon, header label, cell, sort key,
// filter key) layered onto the existing registry. The grid renders its own th/td shells, so a
// column without a `cell` here reuses the children of the legacy renderTd element.

import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowCounterClockwiseIcon,
  ArrowUpRightIcon,
  CalendarIcon,
  CircleDashedIcon,
  ClockIcon,
  EnvelopeSimpleIcon,
  HashIcon,
  MapPinIcon,
  PhoneIcon,
  TextAaIcon,
  UserCircleIcon,
  UserIcon,
} from "@/components/icons";
import { AssigneeChip } from "@/components/dashboard/leads/assignee-selector";
import { MoveToListSelector } from "@/components/dashboard/leads/move-to-list-selector";
import { QualifyRowButton } from "@/components/dashboard/leads/qualify-row-button";
import { getLeadFullName, getLeadInitials } from "@/components/dashboard/lead/lead-name";
import { getLeadCity } from "@/lib/leads/lead-location";
import { formatPhoneForTel } from "@/lib/phone-utils";
import type { Lead } from "@/types/database";
import {
  FALLBACK_FOLLOW_UP_STALE_DAYS,
  followUpBadgeLabel,
  isCallbackDue,
  type LeadColumn,
  type LeadColumnCtx,
  type LeadColumnV2,
} from "../columns-registry";
import { formatAgo } from "./format-ago";

/** Default visible columns, in order (Name is always first and is not listed). */
export const V2_DEFAULT_KEYS = ["lead_type", "assigned", "email", "location", "display_id", "last_activity"];

export const FALLBACK_COLUMN_ICON = TextAaIcon;

const DASH = <span className="text-ds-faint">—</span>;

// ─── Last activity + row signal ──────────────────────────────────────────────────────

export interface RowSignal {
  tone: "bad" | "warn";
  text: string;
}

/** Callback due wins over follow-up needed; both use the table's existing rules (education only). */
export function rowSignal(lead: Lead, ctx: Pick<LeadColumnCtx, "industryId" | "followUpStaleDays">): RowSignal | null {
  if (ctx.industryId !== "education_consultancy") return null;
  if (isCallbackDue(lead)) return { tone: "bad", text: "Callback due" };
  const label = followUpBadgeLabel(lead, ctx.followUpStaleDays ?? FALLBACK_FOLLOW_UP_STALE_DAYS);
  return label ? { tone: "warn", text: label } : null;
}

function fullDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function LastActivityCell({ lead, ctx }: { lead: Lead; ctx: LeadColumnCtx }) {
  const signal = rowSignal(lead, ctx);
  const date = fullDate(lead.last_activity_at);
  const title = date ? `Last activity: ${date}` : undefined;
  if (signal) {
    return (
      <span
        className={`inline-flex min-w-0 items-center gap-1.5 ${signal.tone === "bad" ? "text-ds-bad" : "text-ds-warn"}`}
        title={title}
        aria-label={`${signal.text}${date ? `. Last activity: ${date}` : ""}`}
        suppressHydrationWarning
      >
        <span className={`size-1.5 shrink-0 rounded-full ${signal.tone === "bad" ? "bg-ds-bad" : "bg-ds-warn"}`} aria-hidden />
        <span className="truncate">{signal.text}</span>
      </span>
    );
  }
  return (
    <span className="truncate tabular-nums" title={title} suppressHydrationWarning>
      {formatAgo(lead.last_activity_at)}
    </span>
  );
}

// ─── Name ──────────────────────────────────────────────────────────────────────────

const HOVER_BTN =
  "h-6 shrink-0 items-center gap-1 rounded-ds-xs bg-ds-surface px-1.5 text-xs font-medium text-ds-ink shadow-[inset_0_0_0_1px_var(--ds-border)] transition-colors hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ds-ghost";

function NameCell({ lead, ctx }: { lead: Lead; ctx: LeadColumnCtx }) {
  const name = getLeadFullName(lead, "—");
  const unread = ctx.unreadLeadIds.has(lead.id);
  const open = (e: React.MouseEvent) => {
    e.stopPropagation();
    ctx.onPreviewToggle(lead.id);
  };
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="relative shrink-0">
        <span className="flex size-5 items-center justify-center rounded-full bg-ds-hover text-[10px] font-semibold leading-none text-ds-muted">
          {getLeadInitials(lead)}
        </span>
        {unread && (
          <span
            className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-ds-bad ring-2 ring-ds-surface"
            role="img"
            aria-label="Unread notification"
          />
        )}
      </span>
      <Link
        href={`/leads/${lead.id}`}
        prefetch={false}
        title={name}
        className="min-w-0 flex-1 truncate text-ds-ink group-hover/row:underline"
      >
        {name}
      </Link>
      {/* Hover cluster (pointer devices). bg-inherit: the sticky Name cell is opaque in every state. */}
      <span className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 items-center gap-1 bg-inherit opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:hover)]:flex">
        <button type="button" onClick={open} className={`inline-flex ${HOVER_BTN}`} aria-label={`Open ${name} in preview`}>
          Open
          <kbd className="font-sans text-[11px] font-medium text-ds-faint">⌘↵</kbd>
        </button>
        {lead.phone ? (
          <a
            href={`tel:${formatPhoneForTel(lead.phone)}`}
            onClick={(e) => e.stopPropagation()}
            className={`inline-flex ${HOVER_BTN} w-6 justify-center px-0`}
            aria-label={`Call ${name}`}
            title={`Call ${lead.phone}`}
          >
            <PhoneIcon className="size-3.5" />
          </a>
        ) : null}
      </span>
      {/* Touch devices: one always-visible Open control. */}
      <button
        type="button"
        onClick={open}
        aria-label={`Open ${name} in preview`}
        className={`${HOVER_BTN} hidden w-6 justify-center px-0 [@media(hover:none)]:inline-flex`}
      >
        <ArrowUpRightIcon className="size-3.5" />
      </button>
    </div>
  );
}

// ─── Stage ─────────────────────────────────────────────────────────────────────────

function StageCell({ lead, ctx }: { lead: Lead; ctx: LeadColumnCtx }) {
  if (ctx.viewMode === "trash" || ctx.viewMode === "archived") {
    return ctx.onRestore ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void ctx.onRestore!(lead.id);
        }}
        className="-ml-1.5 inline-flex h-6 items-center gap-1 rounded-ds-xs px-1.5 text-sm font-medium text-ds-muted transition-colors hover:bg-ds-hover hover:text-ds-ink"
      >
        <ArrowCounterClockwiseIcon className="size-3.5" />
        Restore
      </button>
    ) : (
      <span className="text-ds-muted">{ctx.viewMode === "trash" ? "Deleted" : "Archived"}</span>
    );
  }
  const lists = ctx.leadLists;
  if (!lists || lists.length === 0 || !ctx.onListMove) {
    return <span className="text-ds-muted">{lead.lead_type === "prospect" ? "Prospect" : "Lead"}</span>;
  }
  const intake = lists.find((l) => l.is_intake);
  const qualified = lists.find((l) => l.slug === "qualified");
  const inIntake = !!intake && lead.list_id === intake.id;
  return (
    <div className="flex min-w-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <div className="-ml-1.5 min-w-0 shrink">
        <MoveToListSelector
          variant="dot"
          leadId={lead.id}
          currentListId={lead.list_id ?? null}
          lists={ctx.isAdmin ? lists : lists.filter((l) => !l.is_staging && !l.is_archive)}
          onMove={(listId, reason) => ctx.onListMove!(lead.id, listId, reason)}
        />
      </div>
      {ctx.industryId === "education_consultancy" && inIntake && qualified && (
        <span className="shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
          <QualifyRowButton
            quiet
            leadId={lead.id}
            currentDestinations={(lead as { destinations?: string[] }).destinations ?? []}
            currentFieldOfStudy={(lead as { field_of_study?: string | null }).field_of_study ?? null}
            currentDegreeLevel={(lead as { degree_level?: string | null }).degree_level ?? null}
            qualifiedList={qualified}
            onQualified={(listId) => ctx.onListMove!(lead.id, listId)}
          />
        </span>
      )}
    </div>
  );
}

// ─── The rest ──────────────────────────────────────────────────────────────────────

function AssignedCell({ lead, ctx }: { lead: Lead; ctx: LeadColumnCtx }) {
  const email = lead.assigned_to ? ctx.memberMap[lead.assigned_to] : null;
  const name = lead.assigned_to ? ctx.memberNames?.[lead.assigned_to] : null;
  const label = name || (email ? email.split("@")[0] : "");
  return <AssigneeChip seed={lead.assigned_to ?? null} label={label} />;
}

function EmailCell({ lead }: { lead: Lead }) {
  if (!lead.email) return DASH;
  return (
    <a
      href={`mailto:${lead.email}`}
      onClick={(e) => e.stopPropagation()}
      title={lead.email}
      className="block truncate text-ds-accent hover:underline"
    >
      {lead.email}
    </a>
  );
}

function locationText(lead: Lead): string | null {
  const city = getLeadCity(lead);
  return (city && lead.country ? `${city}, ${lead.country}` : city || lead.country) || null;
}

const V2: Record<string, LeadColumnV2> = {
  name: { width: 240, icon: UserIcon, cell: (lead, ctx) => <NameCell lead={lead} ctx={ctx} />, sort: "name", filterFieldKey: "first_name" },
  lead_type: { width: 170, icon: CircleDashedIcon, cell: (lead, ctx) => <StageCell lead={lead} ctx={ctx} />, filterFieldKey: "stage" },
  assigned: { width: 180, icon: UserCircleIcon, label: "Assigned to", cell: (lead, ctx) => <AssignedCell lead={lead} ctx={ctx} />, filterFieldKey: "assignees" },
  email: { width: 240, icon: EnvelopeSimpleIcon, cell: (lead) => <EmailCell lead={lead} />, sort: "email", filterFieldKey: "email" },
  location: {
    width: 180,
    icon: MapPinIcon,
    cell: (lead) => {
      const t = locationText(lead);
      return t ? <span className="block truncate" title={t}>{t}</span> : DASH;
    },
    filterFieldKey: "location",
  },
  display_id: {
    width: 110,
    icon: HashIcon,
    cell: (lead) => (lead.display_id ? <span className="tabular-nums">{lead.display_id}</span> : DASH),
  },
  last_activity: {
    width: 150,
    icon: ClockIcon,
    cell: (lead, ctx) => <LastActivityCell lead={lead} ctx={ctx} />,
    sort: "activity",
    filterFieldKey: "last_activity_at",
  },
  phone: { width: 150, icon: PhoneIcon, filterFieldKey: "phone" },
  created: { width: 130, icon: CalendarIcon, sort: "created", filterFieldKey: "created_at" },
  updated_at: { width: 170, icon: ClockIcon, sort: "updated", filterFieldKey: "updated_at" },
  tags: { width: 110, filterFieldKey: "tags" },
  status: { width: 150, filterFieldKey: "status" },
  source: { width: 150, filterFieldKey: "source" },
  destinations: { width: 190, filterFieldKey: "destinations" },
  ref_code: { width: 130 },
  form_source: { width: 160 },
  branch: { width: 150 },
};

export function v2For(key: string): LeadColumnV2 {
  return V2[key] ?? { width: 160 };
}

/** Attach the v2 block to every column (a column without an entry gets the 160px default). */
export function attachV2(columns: LeadColumn[]): LeadColumn[] {
  return columns.map((c) => (c.v2 ? c : { ...c, v2: v2For(c.key) }));
}

/** Children of the legacy td (its markup shell is dropped), plus its onClick, for columns with no v2.cell. */
export function legacyCellContent(col: LeadColumn, lead: Lead, ctx: LeadColumnCtx): { content: ReactNode; onClick?: (e: React.MouseEvent) => void } {
  const el = col.renderTd(lead, ctx) as { props?: { children?: ReactNode; onClick?: (e: React.MouseEvent) => void } } | null;
  if (!el || typeof el !== "object" || !("props" in el) || !el.props) return { content: el as ReactNode };
  return { content: el.props.children, onClick: el.props.onClick };
}
