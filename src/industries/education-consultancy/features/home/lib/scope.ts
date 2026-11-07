import { leadQueryScope, resolveEffectiveBranch, type ResolvedPermissions } from "@/lib/api/permissions";

/**
 * Which Home a person gets, and how far a manager can see. This reuses the LEADS LIST's own scope helpers so Home can
 * never show more than /leads does:
 *   - `leadQueryScope(permissions, userId, userBranchId)`: own-scope, or a team-scope user with no branch, is
 *     restricted to themselves (the §4.1 guard). A team-scope manager is pinned to THEIR branch.
 *   - `resolveEffectiveBranch(cookie, validBranchIds)`: for all-scope owners/admins the header branch picker
 *     (the `edgex_branch` cookie) narrows the view; a stale or foreign cookie falls back to the whole tenant.
 */
export type HomeScope = { mode: "own" } | { mode: "manager"; branchId: string | null; pinned: boolean };

export function resolveHomeScope(
  permissions: ResolvedPermissions,
  userId: string,
  userBranchId: string | null,
  branchCookie: string | null | undefined,
  validBranchIds: string[],
): HomeScope {
  const scope = leadQueryScope(permissions, userId, userBranchId);
  if (scope.restrictToSelf) return { mode: "own" };
  if (permissions.leadScope === "all") {
    return { mode: "manager", branchId: resolveEffectiveBranch(branchCookie, validBranchIds), pinned: false };
  }
  return { mode: "manager", branchId: scope.branchId, pinned: true };
}
