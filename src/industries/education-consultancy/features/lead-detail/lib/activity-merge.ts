import { describeAuditEvent } from "@/components/dashboard/lead/activities/describe-audit-event";
import type { LeadActivity } from "@/lib/supabase/queries";
import { ensureCreationEvent, isCreationAudit } from "../../record-preview/lib/creation-event";
import type { PreviewActivity } from "../../record-preview/use-preview-data";

/**
 * ONE merged timeline for the lead (EDGEX-153): notes, logged calls/meetings/emails, email threads, audit events (via
 * describe-audit-event.ts), check-ins and system events. The Overview shows its newest 5, the Activity tab all of it,
 * and the tab's count is the length of this list. Rows reuse the record preview's `PreviewActivity` shape so the
 * preview's Timeline and `ensureCreationEvent` work on them unchanged; `snippet` carries the quoted body.
 */
export type FeedItem = PreviewActivity;

export type ChipId = "all" | "calls" | "notes" | "emails" | "stage" | "checkins";
export const CHIP_ORDER: readonly ChipId[] = ["all", "calls", "notes", "emails", "stage", "checkins"];
export const CHIP_LABEL: Record<ChipId, string> = {
  all: "All", calls: "Calls", notes: "Notes", emails: "Emails", stage: "Stage & owner", checkins: "Check-ins",
};

/** Kinds whose body is shown as a quote box under the line. */
export const QUOTE_KINDS: ReadonlySet<string> = new Set(["note", "call", "meeting"]);

const CHIP_OF: Record<string, ChipId> = {
  call: "calls", meeting: "calls", note: "notes", email: "emails",
  stage: "stage", assigned: "stage", unassigned: "stage", graduated: "stage", list: "stage", checkin: "checkins",
};
export function chipOf(kind: string): ChipId | null {
  return CHIP_OF[kind] ?? null;
}

export function plainText(html: string | null | undefined): string {
  return (html ?? "")
    .replace(/<\/(p|div|li|br)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export interface FeedNote { id: string; user_id: string; user_email: string; content: string; created_at: string }
export interface FeedLogged {
  id: string; user_id: string; activity_type: string; subject: string | null; description: string | null;
  call_outcome: string | null; duration_minutes: number | null; email_subject: string | null; email_body: string | null; created_at: string;
}
export interface FeedEmail {
  id: string; direction: "outbound" | "inbound"; from_email: string; from_name: string | null; subject: string;
  sent_at: string | null; received_at: string | null; sender_user_id: string | null;
}

export interface FeedInputs {
  notes: readonly FeedNote[];
  logged: readonly FeedLogged[];
  emails: readonly FeedEmail[];
  audits: readonly LeadActivity[];
  leadCreatedAt: string;
  sourceLabel: string | null;
  /** Display name for a user id (real name, else null). The renderer swaps the current user for "You". */
  nameOf: (id: string | null | undefined, fallback?: string | null) => string | null;
}

const CHECK_IN_PREFIX = "[CHECK-IN]";

function humanize(v: string): string {
  const t = v.replace(/_/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

export function mergeFeed(i: FeedInputs): FeedItem[] {
  const items: FeedItem[] = [];

  for (const n of i.notes) {
    const text = plainText(n.content);
    const actor = i.nameOf(n.user_id, n.user_email);
    if (text.startsWith(CHECK_IN_PREFIX)) {
      const reason = text.split(" — ")[1]?.trim() || null;
      items.push({
        id: `note-${n.id}`, at: n.created_at, actor_id: n.user_id, actor_name: actor, source: null, kind: "checkin",
        verb: reason ? `checked in · ${reason}` : "checked in", object: null, snippet: null,
      });
    } else {
      items.push({
        id: `note-${n.id}`, at: n.created_at, actor_id: n.user_id, actor_name: actor, source: null, kind: "note",
        verb: "added a note", object: null, snippet: text || null,
      });
    }
  }

  for (const a of i.logged) {
    const actor = i.nameOf(a.user_id);
    if (a.activity_type === "call") {
      const bits = [a.call_outcome ? humanize(a.call_outcome) : null, a.duration_minutes ? `${a.duration_minutes}m` : null].filter(Boolean);
      items.push({
        id: `act-${a.id}`, at: a.created_at, actor_id: a.user_id, actor_name: actor, source: null, kind: "call",
        verb: `logged a call${bits.length ? ` · ${bits.join(" · ")}` : ""}`, object: null, snippet: plainText(a.description) || null,
      });
    } else if (a.activity_type === "meeting") {
      items.push({
        id: `act-${a.id}`, at: a.created_at, actor_id: a.user_id, actor_name: actor, source: null, kind: "meeting",
        verb: `logged a meeting${a.subject ? ` · ${a.subject}` : ""}`, object: null, snippet: plainText(a.description) || null,
      });
    } else if (a.activity_type === "email") {
      items.push({
        id: `act-${a.id}`, at: a.created_at, actor_id: a.user_id, actor_name: actor, source: null, kind: "email",
        verb: "logged an email", object: null, snippet: a.email_subject || a.subject || null,
      });
    }
  }

  for (const e of i.emails) {
    const at = e.sent_at ?? e.received_at;
    if (!at) continue;
    const out = e.direction === "outbound";
    items.push({
      id: `email-${e.id}`, at,
      actor_id: out ? e.sender_user_id : null,
      actor_name: out ? i.nameOf(e.sender_user_id, e.from_name ?? e.from_email) : null,
      source: out ? null : e.from_name || e.from_email,
      kind: "email", verb: out ? "sent an email" : "emailed", object: null, snippet: e.subject || null,
    });
  }

  for (const a of i.audits) {
    if (a.action === "lead.note_added") continue; // replaced by the real note rows above
    const d = describeAuditEvent(a, (id) => i.nameOf(id));
    const kind = isCreationAudit(d.kind, a.changes) ? "created" : d.kind;
    items.push({
      id: `audit-${a.id}`, at: a.created_at, actor_id: a.user_id, actor_name: i.nameOf(a.user_id), source: null,
      kind, verb: d.verb, object: d.object, snippet: null,
    });
  }

  return ensureCreationEvent(items, { createdAt: i.leadCreatedAt, sourceLabel: i.sourceLabel })
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime() || (a.id < b.id ? 1 : -1));
}

export function chipCounts(items: readonly FeedItem[]): Record<ChipId, number> {
  const c: Record<ChipId, number> = { all: items.length, calls: 0, notes: 0, emails: 0, stage: 0, checkins: 0 };
  for (const it of items) {
    const chip = chipOf(it.kind);
    if (chip) c[chip] += 1;
  }
  return c;
}

export function filterFeed(items: readonly FeedItem[], chip: ChipId): FeedItem[] {
  return chip === "all" ? [...items] : items.filter((it) => chipOf(it.kind) === chip);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (sameDay(d, now)) return "Today";
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, y)) return "Yesterday";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() === now.getFullYear() ? "" : `, ${d.getFullYear()}`}`;
}

export function clock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function groupByDay(items: readonly FeedItem[], now: Date = new Date()): { label: string; items: FeedItem[] }[] {
  const groups: { label: string; items: FeedItem[] }[] = [];
  for (const it of items) {
    const label = dayLabel(it.at, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(it);
    else groups.push({ label, items: [it] });
  }
  return groups;
}
