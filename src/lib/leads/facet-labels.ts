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

/** A facet option as the server returns it (route.ts): `former` marks a collaborator who is no
 * longer on the team, with a server-resolved display `label`. */
export interface FacetOptionLike {
  name: string;
  count: number;
  label?: string;
  former?: boolean;
}

/**
 * Picker entries for people the team list can't name — former members who still collaborate on
 * leads. Listed after the current team, labelled "(former)" so they can't be mistaken for staff.
 */
export function formerCollaboratorOptions(
  facet: FacetOptionLike[] | null,
  isCurrentMember: (userId: string) => boolean,
): { value: string; label: string }[] {
  if (!facet) return [];
  return facet
    .filter((o) => o.former && !isCurrentMember(o.name))
    .map((o) => ({ value: o.name, label: `${o.label || "Former member"} (former) (${o.count.toLocaleString()})` }));
}

export const FORMER_MEMBER_LABEL = "Former team member";

/**
 * The name to show for whoever holds a lead: a current member's display name (or the email's local part), "" for no
 * holder, and "Former team member" for an id that is no longer on the team (never a raw UUID). When no member list was
 * loaded at all we can't tell former from current, so that stays blank as before.
 */
export function holderLabel(
  userId: string | null | undefined,
  memberNames: Record<string, string> | undefined,
  memberMap: Record<string, string> | undefined,
): string {
  if (!userId) return "";
  const names = memberNames ?? {};
  const emails = memberMap ?? {};
  const name = names[userId] || (emails[userId] ? emails[userId].split("@")[0] : "");
  if (name) return name;
  if (userId in names || userId in emails) return "";
  return Object.keys(emails).length > 0 || Object.keys(names).length > 0 ? FORMER_MEMBER_LABEL : "";
}
