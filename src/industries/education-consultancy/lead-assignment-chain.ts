export const NEXT_ASSIGN_POSITION: Record<string, string | null> = {
  "lead-caller": "lead-executive",
  "lead-executive": "counselor",
  "counselor": "application-executive",
  "application-executive": null,
};
export const ASSIGN_CHAIN_POSITIONS = new Set(Object.keys(NEXT_ASSIGN_POSITION));

/** Peer + next targets — used by API chain-assign validation. */
export function assignableTargetSlugs(positionSlug: string | null | undefined): string[] {
  if (!positionSlug || !(positionSlug in NEXT_ASSIGN_POSITION)) return [];
  const next = NEXT_ASSIGN_POSITION[positionSlug];
  return next ? [positionSlug, next] : [positionSlug];
}

/** Only same-position peers — used by Assigned To dropdown default. */
export function peerSlugs(positionSlug: string | null | undefined): string[] {
  if (!positionSlug || !(positionSlug in NEXT_ASSIGN_POSITION)) return [];
  return [positionSlug];
}

/** Only next-position targets — used by "Send to next" assignment picker. */
export function nextPositionSlug(positionSlug: string | null | undefined): string | null {
  if (!positionSlug) return null;
  return NEXT_ASSIGN_POSITION[positionSlug] ?? null;
}
