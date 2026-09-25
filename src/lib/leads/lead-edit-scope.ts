// Canonical "can this caller edit this lead's working data?" rule — ONE
// function, used by every gate on the lead detail page (Stage, Notes, Study
// Interest, Lead Source, Trip Inquiry, ...). Before this existed, each panel
// reinvented its own gate ad hoc: some (Stage, Notes) correctly recognized a
// branch manager (leadScope === "team"), others (Study Interest, Lead
// Source, Trip Inquiry) never did, so a branch manager could move/reassign a
// lead but not edit its own fields — reported live by an Admizz branch
// manager (2026-09-25). Route every new edit gate through this function
// instead of writing `isAdmin || leadScope === "team" || ...` again, so this
// class of bug can't reintroduce itself one panel at a time.
export function canEditLeadWorkingData({
  isAdmin,
  leadScope,
  isOwnScopeEditor = false,
}: {
  isAdmin: boolean;
  /** The caller's scope for this lead's list, from resolvePermissions(). */
  leadScope?: "all" | "own" | "team" | null;
  /** True when the caller isn't admin/branch-manager but still has a
   * specific, narrower right to this lead (e.g. is the assignee, or a
   * granted collaborator). Optional — omit for gates with no own-scope case. */
  isOwnScopeEditor?: boolean;
}): boolean {
  return isAdmin || leadScope === "team" || isOwnScopeEditor;
}
