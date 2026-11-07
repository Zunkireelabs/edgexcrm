import { ageLabel, clock12, dayBounds, weekdayShort } from "../time";
import type { DoNextItem, HomeLead } from "../types";
import type { RuleCtx } from "./ctx";

/** Only leads assigned this recently count as "new": the `assigned_at` column has no backfill (migration 282). */
export const NEW_LEAD_WINDOW_DAYS = 14;

/**
 * new_uncalled: a lead assigned to me that nobody has touched (call, email, meeting, note) since it was assigned.
 * Clears the moment any touch is logged (`last_touched_at` moves past `assigned_at`).
 */
export function newUncalledRule(leads: HomeLead[], ctx: RuleCtx): DoNextItem[] {
  const out: DoNextItem[] = [];
  const earliest = ctx.now.getTime() - NEW_LEAD_WINDOW_DAYS * 86_400_000;
  for (const l of leads) {
    if (!l.isActive) continue;
    const assigned = Date.parse(l.assignedAt ?? l.createdAt);
    if (!(assigned >= earliest) || assigned > ctx.now.getTime()) continue;
    if (l.lastTouchedAt && Date.parse(l.lastTouchedAt) >= assigned) continue;

    const ageMs = ctx.now.getTime() - assigned;
    const sameDay = assigned >= dayBounds(ctx.now, ctx.tz).start.getTime();
    const at = new Date(assigned);
    const when = ageMs < 86_400_000 && sameDay
      ? ageLabel(ageMs)
      : `${weekdayShort(at, ctx.tz)} ${clock12(at, ctx.tz)}`;
    out.push({
      key: `new_uncalled:${l.id}`,
      kind: "new_uncalled",
      tier: "now",
      leadId: l.id,
      title: l.name,
      why: l.context ? `${l.context} · no contact yet` : "no contact yet",
      chip: { text: `New · ${when}`, tone: "new" },
      tone: "new",
      primaryAction: { type: "call", leadId: l.id, phone: l.phone, leadName: l.name },
      sortKey: { group: 2, at: assigned },
      evidenceHref: `/leads/${l.id}`,
    });
  }
  return out;
}

