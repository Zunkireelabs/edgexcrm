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
