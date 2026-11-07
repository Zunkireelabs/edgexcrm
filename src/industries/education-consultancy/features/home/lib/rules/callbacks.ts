import { ageLabel, clockLabel, clock12, dayBounds, daysBetween, localDate } from "../time";
import type { DoNextItem, HomeLead } from "../types";
import type { RuleCtx } from "./ctx";

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

/**
 * callback_overdue (tier now) and callback_today (tier today), both from `leads.callback_due_at` (the single call-back
 * model: set by the no-answer / busy trigger or by a booked call-back, cleared by the next touch). Overdue = due < now.
 * Today = due later today in the TENANT timezone.
 */
export function callbackRules(leads: HomeLead[], ctx: RuleCtx): DoNextItem[] {
  const out: DoNextItem[] = [];
  const today = localDate(ctx.now, ctx.tz);
  const { end } = dayBounds(ctx.now, ctx.tz);
  for (const l of leads) {
    if (!l.isActive || !l.callbackDueAt) continue;
    const due = Date.parse(l.callbackDueAt);
    if (Number.isNaN(due)) continue;
    const dueAt = new Date(due);
    if (due < ctx.now.getTime()) {
      const dayDiff = daysBetween(localDate(dueAt, ctx.tz), today);
      const text = dayDiff >= 1 ? `Overdue ${dayDiff} ${dayDiff === 1 ? "day" : "days"}` : `Overdue ${ageLabel(ctx.now.getTime() - due)}`;
      const dueWhen = dayDiff === 0 ? "today" : dayDiff === 1 ? "yesterday" : `${dayDiff} days ago`;
      out.push({
        key: `callback_overdue:${l.id}`,
        kind: "callback_overdue",
        tier: "now",
        leadId: l.id,
        title: l.name,
        why: `Call back was due ${dueWhen} at ${clock12(dueAt, ctx.tz)}${lastCall(l)}`,
        chip: { text, tone: "bad" },
        tone: "bad",
        primaryAction: { type: "call", leadId: l.id, phone: l.phone, leadName: l.name },
        sortKey: { group: 0, at: due },
        evidenceHref: `/leads/${l.id}`,
      });
    } else if (due < end.getTime()) {
      out.push({
        key: `callback_today:${l.id}`,
        kind: "callback_today",
        tier: "today",
        leadId: l.id,
        title: l.name,
        why: l.context ? `${l.context}${lastCall(l)}` : lastCall(l).replace(/^ · /, ""),
        chip: { text: `Call back ${clockLabel(dueAt, ctx.tz)}`, tone: "neutral" },
        tone: "neutral",
        primaryAction: { type: "call", leadId: l.id, phone: l.phone, leadName: l.name },
        sortKey: { group: 0, at: due },
        evidenceHref: `/leads/${l.id}`,
      });
    }
  }
  return out;
}
