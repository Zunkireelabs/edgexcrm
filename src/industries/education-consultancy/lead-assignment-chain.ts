export const NEXT_ASSIGN_POSITION: Record<string, string | null> = {
  "lead-caller": "lead-executive",
  "lead-executive": "counselor",
  "counselor": "application-executive",
  "application-executive": null,
};
export const ASSIGN_CHAIN_POSITIONS = new Set(Object.keys(NEXT_ASSIGN_POSITION));
export function assignableTargetSlugs(positionSlug: string | null | undefined): string[] {
  if (!positionSlug || !(positionSlug in NEXT_ASSIGN_POSITION)) return [];
  const next = NEXT_ASSIGN_POSITION[positionSlug];
  return next ? [positionSlug, next] : [positionSlug];
}
