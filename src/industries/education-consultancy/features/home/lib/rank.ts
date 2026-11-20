import type { DoNextItem, DoNextTier } from "./types";

const TIER_ORDER: Record<DoNextTier, number> = { now: 0, today: 1, week: 2 };

/**
 * Deterministic order: tier (now → today → week), then the item's group (now: overdue call-backs and overdue tasks,
 * then replies, then new leads; today: timed call-backs, deadlines, tasks), then oldest / soonest first, then title.
 */
export function rankItems(items: DoNextItem[]): DoNextItem[] {
  return [...items].sort(
    (a, b) =>
      TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
      a.sortKey.group - b.sortKey.group ||
      a.sortKey.at - b.sortKey.at ||
      a.title.localeCompare(b.title) ||
      a.key.localeCompare(b.key),
  );
}

export const VISIBLE_LIMIT = 8;
