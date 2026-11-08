import { ageLabel, clock12, dayBounds, localDate, weekdayShort } from "../time";
import { isInOfficeHours, workingDeadline, workingMinutesBetween } from "../../../processes/lib/working-hours";
import type { DoNextItem, HomeLead } from "../types";
import type { RuleCtx } from "./ctx";

/** Only leads assigned this recently count as "new": the `assigned_at` column has no backfill (migration 282). */
export const NEW_LEAD_WINDOW_DAYS = 14;

const MIN = 60_000;

/** "35 min", "1 h 5 min", "2 h", "3 days": how late (compact, minutes known). */
export function lateLabel(min: number): string {
  const m = Math.max(1, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h < 48) return r === 0 ? `${h} h` : `${h} h ${r} min`;
  return `${Math.floor(h / 24)} days`;
}

/** "10:52 am" when it is the same tenant-local day as `now`, else "Sat 8:10 pm". */
export function whenLabel(d: Date, now: Date, tz: string): string {
  return localDate(d, tz) === localDate(now, tz) ? clock12(d, tz) : `${weekdayShort(d, tz)} ${clock12(d, tz)}`;
}

/**
 * new_uncalled: a lead assigned to me that nobody has touched (call, email, meeting, note) since it was assigned.
 * Clears the moment any touch is logged (`last_touched_at` moves past `assigned_at`).
 *
 * With a LIVE New-lead process (ctx.policy.live) the row carries its deadline: arrival + the first-contact window, counted in plain
 * minutes (clock = "clock") or in office hours (clock = "working"). Before it: blue "New · call by 11:52 am". After it: red "Late ·
 * 35 min". Late rows sort first (oldest deadline first), then the upcoming ones by deadline. Without a live process the row is the
 * plain "New · 15 min" it always was.
 */
export function newUncalledRule(leads: HomeLead[], ctx: RuleCtx): DoNextItem[] {
  const out: DoNextItem[] = [];
  const policy = ctx.policy?.live ? ctx.policy : null;
  const earliest = ctx.now.getTime() - NEW_LEAD_WINDOW_DAYS * 86_400_000;
  for (const l of leads) {
    if (!l.isActive) continue;
    const assigned = Date.parse(l.assignedAt ?? l.createdAt);
    if (!(assigned >= earliest) || assigned > ctx.now.getTime()) continue;
    if (l.lastTouchedAt && Date.parse(l.lastTouchedAt) >= assigned) continue;

    const at = new Date(assigned);
    const base = {
      key: `new_uncalled:${l.id}`,
      kind: "new_uncalled" as const,
      tier: "now" as const,
      leadId: l.id,
      title: l.name,
      primaryAction: { type: "call" as const, leadId: l.id, phone: l.phone, leadName: l.name },
      evidenceHref: `/leads/${l.id}`,
    };

    if (!policy) {
      const ageMs = ctx.now.getTime() - assigned;
      const sameDay = assigned >= dayBounds(ctx.now, ctx.tz).start.getTime();
      const when = ageMs < 86_400_000 && sameDay ? ageLabel(ageMs) : `${weekdayShort(at, ctx.tz)} ${clock12(at, ctx.tz)}`;
      out.push({ ...base, why: l.context ? `${l.context} · no contact yet` : "no contact yet", chip: { text: `New · ${when}`, tone: "new" }, tone: "new", sortKey: { group: 2, at: assigned } });
      continue;
    }

    const { minutes, clock } = policy.firstContact;
    const working = clock === "working";
    const deadline = working ? workingDeadline(at, minutes, policy.officeHours, ctx.tz) : new Date(assigned + minutes * MIN);
    const late = ctx.now.getTime() > deadline.getTime();
    const bits: string[] = [];
    if (l.context) bits.push(l.context);
    bits.push(`arrived ${whenLabel(at, ctx.now, ctx.tz)}${working && !isInOfficeHours(at, policy.officeHours, ctx.tz) ? " (closed)" : ""}`);
    if (deadline.getTime() !== assigned + minutes * MIN) bits.push(`due ${whenLabel(deadline, ctx.now, ctx.tz)}`);
    bits.push("no contact yet");

    if (late) {
      const lateMin = working ? workingMinutesBetween(deadline, ctx.now, policy.officeHours, ctx.tz) : (ctx.now.getTime() - deadline.getTime()) / MIN;
      out.push({ ...base, why: bits.join(" · "), chip: { text: `Late · ${lateLabel(lateMin)}`, tone: "bad" }, tone: "bad", sortKey: { group: 2, at: deadline.getTime() } });
    } else {
      // Group 2.5: upcoming deadlines come after every late row, soonest first.
      out.push({ ...base, why: bits.join(" · "), chip: { text: `New · call by ${whenLabel(deadline, ctx.now, ctx.tz)}`, tone: "new" }, tone: "new", sortKey: { group: 2.5, at: deadline.getTime() } });
    }
  }
  return out;
}
