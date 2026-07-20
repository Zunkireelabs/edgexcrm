// Education-consultancy: which positions a lead in a given Stage (lead_lists slug) may be
// assigned to. Inverse of POSITION_ROUTE_MAP (position → home list) with `branch-manager`
// added to every stage — a branch manager can own a lead at any stage of their branch.
//
// Used by the Add-Lead sheet to cascade the "Assigned To" options off the chosen Stage,
// and by POST /api/v1/leads as a server-side guard on manual dashboard creates.
export const STAGE_TEAM_MAP: Record<string, string[]> = {
  "pre-qualified": ["branch-manager", "lead-caller"],
  "qualified": ["branch-manager", "lead-executive"],
  "prospects": ["branch-manager", "counselor"],
  "applications": ["branch-manager", "application-executive"],
};

// Positions allowed for a stage slug; empty array for unknown/staging lists.
export function positionsForStage(stageSlug: string | null | undefined): string[] {
  if (!stageSlug) return [];
  return STAGE_TEAM_MAP[stageSlug] ?? [];
}

interface RosterMemberForStage {
  user_id: string;
  email: string;
  name?: string | null;
  position_slug: string | null;
  branch_id: string | null;
}

export interface StageAssigneeCandidate {
  user_id: string;
  email: string;
  name?: string | null;
}

/**
 * Assignee candidates for moving a lead to `stageSlug`, used by the admin/branch-manager
 * "Move to stage" picker (StageMoveSelector). Picks the stage's line position (e.g.
 * lead-executive for Qualified) in the lead's branch; admin/owner viewers also see the
 * branch's branch-manager(s), branch-manager viewers don't (they delegate down, not to peers).
 *
 * Fallback when the base list is empty (keeps the picker from ever being dead-empty):
 *   1. branch-manager(s) of the lead's branch
 *   2. the line position tenant-wide (ignore branch)
 */
export function stageAssigneeCandidates(
  roster: RosterMemberForStage[],
  stageSlug: string | null | undefined,
  leadBranchId: string | null,
  viewerIsBranchManager: boolean,
): StageAssigneeCandidate[] {
  const lineSlugs = positionsForStage(stageSlug).filter((s) => s !== "branch-manager");
  const inBranch = (m: RosterMemberForStage) => leadBranchId == null || m.branch_id === leadBranchId;

  const lineTeamInBranch = roster.filter(
    (m) => m.position_slug != null && lineSlugs.includes(m.position_slug) && inBranch(m),
  );
  const branchManagersInBranch = roster.filter((m) => m.position_slug === "branch-manager" && inBranch(m));

  const base = viewerIsBranchManager ? lineTeamInBranch : [...lineTeamInBranch, ...branchManagersInBranch];
  if (base.length > 0) return base;

  if (branchManagersInBranch.length > 0) return branchManagersInBranch;

  return roster.filter((m) => m.position_slug != null && lineSlugs.includes(m.position_slug));
}
