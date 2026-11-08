import type { FilterTree } from "@/lib/filters/types";

/**
 * The leads master view (no ?list / ?funnel) hides archive and staging lists. An explicit `stage is_any_of [...]` filter beats that hide for
 * the lists it names, but only for lists the caller may see, so a number on Home ("Review 9") opens exactly those leads (EDGEX-109 P3b round 3).
 * One helper for the page, the API and the counts, so the three can never drift.
 *
 * Only a top-level AND group's own conditions count: under OR, or inside a nested group, naming a list does not narrow the result to it,
 * so lifting the hide there would leak staging leads into the other branch.
 */
export function namedStageListIds(tree: FilterTree | null | undefined): string[] {
  if (!tree || tree.conjunction !== "and") return [];
  const ids: string[] = [];
  for (const c of tree.conditions) {
    if (c.field === "stage" && c.op === "is_any_of" && Array.isArray(c.value)) for (const v of c.value) if (typeof v === "string") ids.push(v);
  }
  return ids;
}

export function masterViewExcludeIds(
  lists: ReadonlyArray<{ id: string; is_archive: boolean; is_staging?: boolean | null }>,
  tree: FilterTree | null | undefined,
  canSee: (listId: string) => boolean,
): string[] {
  const named = new Set(namedStageListIds(tree));
  return lists.filter((l) => (l.is_archive || l.is_staging) && !(named.has(l.id) && canSee(l.id))).map((l) => l.id);
}
