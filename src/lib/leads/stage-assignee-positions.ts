// education_consultancy: which position's Assigned-To filter options a stage-list
// should show. Pure, no React — mirrors STAGE_TEAM_MAP in
// lead-assignment-by-stage.ts (frontline = the non-"branch-manager" slug per stage).
export const STAGE_FRONTLINE: Record<string, string> = {
  "pre-qualified": "lead-caller",
  "qualified": "lead-executive",
  "prospects": "counselor",
  "applications": "application-executive",
};

// Returns the set of position slugs allowed in the Assigned-To filter for this
// stage + viewer, or null to signal "not gated → use full roster".
export function allowedAssigneePositionsForStage(
  stageSlug: string | null,
  role: string | undefined,
  viewerPositionSlug: string | null,
): Set<string> | null {
  const frontline = stageSlug ? STAGE_FRONTLINE[stageSlug] : undefined;
  if (!frontline) return null;
  if (role === "admin" || role === "owner") return new Set([frontline, "branch-manager"]);
  if (viewerPositionSlug === "branch-manager") return new Set([frontline]);
  return null;
}
