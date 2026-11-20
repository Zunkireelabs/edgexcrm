// Real lead counts for the toolbar (Stage option counts, view-tab counts).
//
// The facets endpoint can't count stages or "my leads", and adding a dimension means a route /
// aggregate change that is out of scope for phase 1. Instead each count asks the SAME
// scope-aware list endpoint the table itself uses (GET /api/v1/leads?page=1&pageSize=1&count=1
// -> meta.total), so counselor / branch / own-scope limits apply exactly as they do to the rows:
// a count can never exceed what that user can see. A failed or unscoped count is `null` and the
// UI renders no number — never a wrong one.

import { encodeFilterTree, isEmptyTree } from "@/lib/filters/serialize";
import type { FilterTree } from "@/lib/filters/types";

export interface CountQuery {
  /** Route-level list scope (`?list=<slug>`). */
  listSlug?: string | null;
  /** Filter tree to count under (omit / empty = no filter). */
  tree?: FilterTree | null;
}

/** Query string for a one-row, count-only request. Pure so the URL is unit-tested. */
export function buildCountParams({ listSlug, tree }: CountQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set("page", "1");
  params.set("pageSize", "1");
  params.set("count", "1");
  if (listSlug) params.set("list", listSlug);
  if (tree && !isEmptyTree(tree)) params.set("f", encodeFilterTree(tree));
  return params;
}

/** The tree with every condition on `fieldKey` removed (an option's own count ignores its own field). */
export function treeWithoutField(tree: FilterTree, fieldKey: string): FilterTree {
  return {
    ...tree,
    conditions: tree.conditions.filter((c) => c.field !== fieldKey),
    groups: tree.groups?.map((g) => ({ ...g, conditions: g.conditions.filter((c) => c.field !== fieldKey) })),
  };
}

/** One count, or null when the server can't give a faithful number. */
export async function fetchLeadCount(query: CountQuery, signal?: AbortSignal): Promise<number | null> {
  try {
    const res = await fetch(`/api/v1/leads?${buildCountParams(query).toString()}`, { signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { meta?: { total?: unknown } };
    const total = body.meta?.total;
    return typeof total === "number" && Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}
