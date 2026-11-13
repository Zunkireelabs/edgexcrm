// Tiny pure edits on a FilterTree used by the toolbar popovers. The tree itself is owned by
// useAdvancedFilters (URL ?f=); these never touch it, they just compute the next value that
// leads-table's handleAdvancedFilterChange then receives (it owns the Stage-tab sync).

import { addOrMergeCondition } from "@/components/filters/condition-defaults";
import type { FilterCondition, FilterTree } from "@/lib/filters/types";

export function findCondition(tree: FilterTree, id: string): FilterCondition | undefined {
  return tree.conditions.find((c) => c.id === id);
}

/** First top-level condition on a field (used to reopen "Stage" instead of adding a second Stage chip). */
export function findConditionForField(tree: FilterTree, fieldKey: string): FilterCondition | undefined {
  return tree.conditions.find((c) => c.field === fieldKey);
}

/** Replace the condition with the same id, or append (folding into an existing same-field pick). */
export function upsertCondition(tree: FilterTree, next: FilterCondition): FilterTree {
  if (tree.conditions.some((c) => c.id === next.id)) {
    return { ...tree, conditions: tree.conditions.map((c) => (c.id === next.id ? next : c)) };
  }
  return { ...tree, conditions: addOrMergeCondition(tree.conditions, next) };
}

export function removeCondition(tree: FilterTree, id: string): FilterTree {
  return { ...tree, conditions: tree.conditions.filter((c) => c.id !== id) };
}
