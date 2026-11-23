import { ageLabel, clock12, dayBounds, daysBetween, localDate } from "../time";
import type { DoNextItem, HomeLead } from "../types";
import type { RuleCtx } from "./ctx";

/**
 * Overdue call-back reminders come from `leads.callback_due_at`, which the migration-250 trigger sets +10 min on EVERY
 * no-answer / busy call and only clears on the next touch. Real data piles up (572 of 619 were over a week old), so age
 * decides where a reminder goes:
 *   0-2 tenant-local days overdue   a "now" row, NEWEST first (the person was just trying to reach them)
 *   3-14 days                       ONE grouped "N missed call-backs" row (this week), opening a sheet of exactly those leads
 *   over 14 days                    never on a personal list (owners / managers get a "clear them" item, see needs-you)
 */
export const RECENT_OVERDUE_MAX_DAYS = 2;
export const MISSED_MAX_DAYS = 14;

const OUTCOME_TEXT: Record<string, string> = {
  no_answer: "no answer",
  busy: "busy",
  connected: "talked",
  wrong_number: "wrong number",
};

function lastCall(l: HomeLead): string {
  const t = l.lastCallOutcome ? OUTCOME_TEXT[l.lastCallOutcome] ?? l.lastCallOutcome.replace(/_/g, " ") : null;
  return t ? ` · last call: ${t}` : "";
}

/** Whole tenant-local days a due time is overdue by (0 = today). Negative / 0 for a call-back not yet due. */
export function overdueDays(due: Date, ctx: RuleCtx): number {
  return daysBetween(localDate(due, ctx.tz), localDate(ctx.now, ctx.tz));
}

/** A call-back older than 14 tenant-local days: too stale for anyone's personal list. */
export function isStaleCallback(dueIso: string | null, ctx: RuleCtx): boolean {
  if (!dueIso) return false;
  const due = new Date(dueIso);
  return due.getTime() < ctx.now.getTime() && overdueDays(due, ctx) > MISSED_MAX_DAYS;
}

function overdueItem(l: HomeLead, due: number, days: number, ctx: RuleCtx): DoNextItem {
  const dueAt = new Date(due);
  const text = days >= 1 ? `Overdue ${days} ${days === 1 ? "day" : "days"}` : `Overdue ${ageLabel(ctx.now.getTime() - due)}`;
  const dueWhen = days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  return {
    key: `callback_overdue:${l.id}`,
    kind: "callback_overdue",
    tier: "now",
    leadId: l.id,
    title: l.name,
    why: `Call back was due ${dueWhen} at ${clock12(dueAt, ctx.tz)}${lastCall(l)}`,
    chip: { text, tone: "bad" },
    tone: "bad",
    primaryAction: { type: "call", leadId: l.id, phone: l.phone, leadName: l.name },
    // Newest first: the most recent attempt is the one most worth finishing.
    sortKey: { group: 0, at: -due },
    evidenceHref: `/leads/${l.id}`,
  };
}

/**
 * callback_overdue (tier now), callback_today (tier today) and the grouped missed_callbacks row (tier week).
 * Today = due later today in the TENANT timezone. `excludeLeadIds` (the unreachable leads) never show as a call-back.
 */
export function callbackRules(leads: HomeLead[], ctx: RuleCtx, excludeLeadIds: ReadonlySet<string> = new Set()): DoNextItem[] {
  const out: DoNextItem[] = [];
  const missed: Array<{ lead: HomeLead; due: number; days: number }> = [];
  const { end } = dayBounds(ctx.now, ctx.tz);
  for (const l of leads) {
    if (!l.isActive || !l.callbackDueAt || excludeLeadIds.has(l.id)) continue;
    const due = Date.parse(l.callbackDueAt);
    if (Number.isNaN(due)) continue;
    if (due < ctx.now.getTime()) {
      const days = overdueDays(new Date(due), ctx);
      if (days <= RECENT_OVERDUE_MAX_DAYS) out.push(overdueItem(l, due, days, ctx));
      else if (days <= MISSED_MAX_DAYS) missed.push({ lead: l, due, days });
      // over 14 days: dropped here on purpose.
    } else if (due < end.getTime()) {
      out.push({
        key: `callback_today:${l.id}`,
        kind: "callback_today",
        tier: "today",
        leadId: l.id,
        title: l.name,
        why: l.context ? `${l.context}${lastCall(l)}` : lastCall(l).replace(/^ · /, ""),
        chip: { text: `Call back ${clock12(new Date(due), ctx.tz)}`, tone: "neutral" },
        tone: "neutral",
        primaryAction: { type: "call", leadId: l.id, phone: l.phone, leadName: l.name },
        sortKey: { group: 0, at: due },
        evidenceHref: `/leads/${l.id}`,
      });
    }
  }
  if (missed.length > 0) {
    missed.sort((a, b) => b.due - a.due || a.lead.name.localeCompare(b.lead.name)); // newest first, like the rows
    const names = missed.slice(0, 3).map((m) => m.lead.name);
    const rest = missed.length - names.length;
    out.push({
      key: "missed_callbacks:all",
      kind: "missed_callbacks",
      tier: "week",
      title: `${missed.length} missed ${missed.length === 1 ? "call-back" : "call-backs"}`,
      why: names.join(", ") + (rest > 0 ? ` and ${rest} more` : ""),
      chip: { text: `${RECENT_OVERDUE_MAX_DAYS + 1}–${MISSED_MAX_DAYS} days old`, tone: "neutral" },
      tone: "neutral",
      primaryAction: { type: "sheet", label: "Call through them" },
      sortKey: { group: 0, at: 0 },
      evidenceHref: "/leads",
      children: missed.map((m) => overdueItem(m.lead, m.due, m.days, ctx)),
    });
  }
  return out;
}
