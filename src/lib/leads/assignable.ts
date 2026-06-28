/**
 * Branch-scoping for "assign a user" dropdowns.
 *
 * Rule (per product): a branch-scoped user (leadScope !== "all" — e.g. Branch
 * Manager, Counselor) may only assign to members of *their own branch*. A user
 * with overall access (owner/admin, leadScope === "all") sees every member.
 *
 * Matches by exact branch_id (null matches null), so a no-branch user sees only
 * other no-branch members.
 */
export function filterAssignableMembers<T extends { branch_id?: string | null }>(
  members: T[],
  leadScope: "all" | "own" | "team",
  branchId: string | null,
): T[] {
  if (leadScope === "all") return members;
  return members.filter((m) => (m.branch_id ?? null) === (branchId ?? null));
}
