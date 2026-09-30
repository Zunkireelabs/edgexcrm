// Label/visibility helpers for filter pickers that show "Name (n)" counts.
//
// `counts === null` means "the server gave no faithful number" (still loading, or it said
// it can't count under the active filters). In that state a picker lists the options with
// NO number and does not hide zero-count people — hiding on an unknown count would drop
// real options, and printing a guessed count (e.g. from the loaded 25-row page) is exactly
// the bug this replaces.

export type FacetCounts = ReadonlyMap<string, number> | null;

/** " (1,234)" when a count is known, "" when it isn't. */
export function countSuffix(counts: FacetCounts, key: string): string {
  return counts ? ` (${(counts.get(key) ?? 0).toLocaleString()})` : "";
}

/** Whether an option should be offered: always when counts are unknown, else >0 or force-kept. */
export function isOfferedByCount(counts: FacetCounts, key: string, forceKeep = false): boolean {
  return counts === null || forceKeep || (counts.get(key) ?? 0) > 0;
}

/**
 * People-pickers that list EVERY candidate (never hiding zero-count people, so a name can't
 * vanish because the active filters narrowed to nothing): order them with the biggest count
 * first, ties/zeros alphabetical by label. Unknown counts keep the caller's order untouched.
 */
export function sortByCountDesc<T>(items: T[], counts: FacetCounts, keyOf: (item: T) => string, labelOf: (item: T) => string): T[] {
  if (counts === null) return items;
  return [...items].sort(
    (a, b) => (counts.get(keyOf(b)) ?? 0) - (counts.get(keyOf(a)) ?? 0) || labelOf(a).localeCompare(labelOf(b)),
  );
}
