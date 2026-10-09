// Picks the list a staff-created lead should land in when the creator did not
// choose a Stage and cannot see the intake list.
//
// The intake list ("New Leads") is a staging list: owner/admin only. A branch
// manager who adds a lead without a Stage would otherwise have it routed there
// and lose sight of their own lead until an admin re-assigns it. Instead they
// get the first Stage they can actually open (lowest sort_order, never staging
// or archive), which is where the Add Lead form would have defaulted anyway.

export interface DefaultListCandidate {
  id: string;
  sort_order: number;
  is_staging: boolean;
  is_archive: boolean;
  access: { mode: string; positionIds?: string[] };
}

export function pickDefaultListForStaff(
  lists: DefaultListCandidate[],
  canAccess: (list: DefaultListCandidate) => boolean
): string | null {
  const candidates = lists
    .filter((l) => !l.is_staging && !l.is_archive && canAccess(l))
    .sort((a, b) => a.sort_order - b.sort_order);
  return candidates[0]?.id ?? null;
}
