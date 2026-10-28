import { newConditionId } from "@/components/filters/condition-defaults";
import type { FieldRegistry, FilterCondition, FilterTree } from "@/lib/filters/types";

export interface AppliedSavedFilter {
  tree: FilterTree;
  /** How many conditions were dropped because their field no longer exists for this tenant. */
  dropped: number;
}

/**
 * Turn a stored tree back into one the Leads filter bar can use: fresh condition ids (a saved id could collide with
 * a chip already on screen) and no conditions on fields this tenant can't filter by anymore. A saved filter that
 * mentions a removed field degrades instead of failing the whole request with a 422.
 */
export function prepareSavedFilterTree(saved: FilterTree, registry: FieldRegistry): AppliedSavedFilter {
  let dropped = 0;
  const keep = (c: FilterCondition): FilterCondition[] => {
    const field = registry[c.field];
    if (!field || !field.filterable) {
      dropped += 1;
      return [];
    }
    return [{ ...c, id: newConditionId() }];
  };

  const tree: FilterTree = {
    conjunction: saved.conjunction,
    conditions: saved.conditions.flatMap(keep),
    groups: (saved.groups ?? [])
      .map((g) => ({ ...g, conditions: g.conditions.flatMap(keep) }))
      .filter((g) => g.conditions.length > 0),
  };
  if (tree.groups && tree.groups.length === 0) delete tree.groups;
  return { tree, dropped };
}
