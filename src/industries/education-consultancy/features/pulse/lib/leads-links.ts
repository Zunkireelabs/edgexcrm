import { encodeFilterTree } from "@/lib/filters/serialize";
import type { FilterTree } from "@/lib/filters/types";

/**
 * Deep links from Pulse into the EXISTING leads list (and its existing bulk-reassign flow) — Pulse adds no write path.
 *
 * The leads table reads the shared filter tree from `?f=` (advanced filters, on in every deploy), so a link can open
 * the list already filtered to exactly one person's leads: field `assignees` (a registry key, never a column), op
 * `is_any_of`. No change to the shared leads page or table is needed.
 */
export function assigneeFilterTree(userIds: string[]): FilterTree {
  return {
    conjunction: "and",
    conditions: [{ id: "pulse:assignees", field: "assignees", op: "is_any_of", value: userIds }],
  };
}

/** `/leads` opened on one person's leads (optionally inside one list tab). */
export function leadsOfPersonHref(userId: string, listSlug?: string | null): string {
  const p = new URLSearchParams();
  if (listSlug) p.set("list", listSlug);
  p.set("f", encodeFilterTree(assigneeFilterTree([userId])));
  return `/leads?${p.toString()}`;
}

/** `/leads` filtered to held leads with no touch or move for 3+ days — exactly Pulse's "untouched" set (any window). */
export function untouchedLeadsHref(): string {
  const tree: FilterTree = {
    conjunction: "and",
    conditions: [{ id: "pulse:untouched", field: "untouched_held", op: "is_true" }],
  };
  const p = new URLSearchParams({ f: encodeFilterTree(tree) });
  return `/leads?${p.toString()}`;
}
