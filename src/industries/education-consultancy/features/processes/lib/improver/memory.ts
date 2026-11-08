import { targetAfterSchema, type ChangeField } from "../changes";
import type { MetricUnit } from "../metrics";

/**
 * Orca's manners (EDGEX-109 P4a, decision 7): it never re-proposes an idea the owner rejected in the last 60 days (same part, same direction),
 * unless the number behind it has moved since. Pure; the server feeds it the rejected drafts' changes and the snapshots.
 */

export const REJECTED_MEMORY_DAYS = 60;
const DAY = 86_400_000;

/** The badges a change may carry: a feature that is not built yet (a FIXED list) and the Settings switch the owner flips after approving. */
export const NEEDS_BADGES = {
  "EDGEX-104": "Per-lead SMS",
  "EDGEX-105": "A feature that is not built yet",
  "EDGEX-107": "A feature that is not built yet",
  "EDGEX-108": "A feature that is not built yet",
} as const;
export type NeedsBadge = keyof typeof NEEDS_BADGES;
export const NEEDS_IDS = Object.keys(NEEDS_BADGES) as NeedsBadge[];

export const TURNS_ON = {
  smart_assignment_shadow: { label: "Settings → Smart assignment → Shadow", href: "/settings" },
  smart_assignment_auto: { label: "Settings → Smart assignment → Auto", href: "/settings" },
} as const;
export type TurnsOn = keyof typeof TURNS_ON;
export const TURNS_ON_IDS = Object.keys(TURNS_ON) as TurnsOn[];

/** What a change does, in one comparable word: a target goes up / down / switches measure; a who is the set of positions; wording is wording. */
export function changeDirection(field: ChangeField, before: unknown, after: unknown): string {
  if (field === "wording") return "wording";
  if (field === "who") return `who:${(Array.isArray(after) ? (after as unknown[]).filter((x): x is string => typeof x === "string") : []).slice().sort().join(",")}`;
  const a = targetAfterSchema.safeParse(after);
  const b = targetAfterSchema.safeParse(before);
  if (!a.success) return "target";
  if (a.data.metric && (!b.success || b.data.metric !== a.data.metric)) return `target:switch:${a.data.metric}`;
  if (!b.success) return "target";
  return a.data.value > b.data.value ? "target:up" : a.data.value < b.data.value ? "target:down" : "target:same";
}

export interface RejectedIdea {
  part: string;
  field: ChangeField;
  direction: string;
  rejectedAt: string;
  reason: string | null;
  /** True when the number behind the idea has moved since the rejection (so it may be proposed again). */
  movedSince: boolean;
}

export interface Proposal {
  part: string;
  field: ChangeField;
  before: unknown;
  after: unknown;
}

/** The rejected idea that blocks this proposal, if any: same part + same direction, rejected within the last 60 days, number not moved. */
export function blockingIdea(p: Proposal, rejected: readonly RejectedIdea[], now: Date): RejectedIdea | null {
  const direction = changeDirection(p.field, p.before, p.after);
  for (const r of rejected) {
    if (r.part !== p.part || r.field !== p.field || r.direction !== direction) continue;
    if (now.getTime() - Date.parse(r.rejectedAt) > REJECTED_MEMORY_DAYS * DAY) continue;
    if (r.movedSince) continue;
    return r;
  }
  return null;
}

/**
 * Did the number move enough to be worth asking again? Percent: 5 points. Time: 20%. Count: any change. Unknown on either side: no
 * (we can't show it moved, so the idea stays blocked).
 */
export function movedSince(unit: MetricUnit, then: number | null, now: number | null): boolean {
  if (then === null || now === null) return false;
  if (unit === "percent") return Math.abs(now - then) >= 5;
  if (unit === "min") return then > 0 ? Math.abs(now - then) / then >= 0.2 : now !== then;
  return now !== then;
}
