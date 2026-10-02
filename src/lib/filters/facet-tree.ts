// Pure filter-tree helper for facet counts computed FROM the list's own filter.
//
// A facet option's count ("Amit Rawal (32)") is defined as: the number of leads the
// list would return if the user picked that option — every OTHER active filter still
// applied, the facet's own axis replaced by the single option. Building that as a tree
// and running it through the same compileFilter()/buildScopedQuery() the list uses means
// the count and the list can never drift (they are the same query, one with head:true).
//
// No imports from the rest of the app beyond ./types — same invariant as the other
// files in this directory.

import type { FilterCondition, FilterTree } from "./types";

/**
 * The tree the list would use if `optionValue` were the only selection on `field`, or
 * `null` when that can't be expressed faithfully (the caller must then show NO number —
 * a wrong number is worse than none).
 *
 * Own-axis conditions are removed only when they sit at the top level of an AND tree.
 * Conditions on the same field inside an OR sub-group are left untouched (the option is
 * AND-ed on top), because dropping one branch of an OR would change what the group
 * means. A top-level OR tree returns null for the same reason.
 */
export function treeForFacetOption(tree: FilterTree, field: string, optionValue: string): FilterTree | null {
  if (tree.conjunction !== "and") return null;
  const kept = tree.conditions.filter((c) => c.field !== field);
  const optionCondition: FilterCondition = {
    id: `facet:${field}`,
    field,
    op: "is_any_of",
    value: [optionValue],
  };
  return {
    conjunction: "and",
    conditions: [...kept, optionCondition],
    ...(tree.groups ? { groups: tree.groups } : {}),
  };
}
