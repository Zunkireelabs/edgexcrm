// ONE definition of who may assign a lead on a branch, and who they may pick.
//
// Why this exists: assigning a lead that another branch has shared in used to be decided in
// five places (the per-branch assign route, the share route, the main lead PATCH, the bulk
// route, and the branches panel that builds the dropdown), each with its own copy of the rule —
// and the copies disagreed. The main PATCH always let an admin be a target; the per-branch route
// and the bulk route didn't. The bulk route ignored leads shared INTO a manager's branch. The
// panel built its picker from /api/v1/team, which 403s for a manager without that nav item, so
// the dropdown came up empty. Result: "even the admin / the receiving branch's manager can't
// assign". Every one of those places now calls the functions below.
//
// Pure functions — no DB, no imports from the app beyond types — so the whole rule is one
// table-driven unit test.

import type { LeadMembership } from "./branch-membership";

/** The slice of AuthContext the rule reads. `role` is the legacy base tier requireAdmin() reads;
 * `permissions.baseTier` is the position-derived one — either says "owner/admin". */
export interface BranchAssignCaller {
  role?: string;
  permissions: { baseTier: "owner" | "admin" | "member"; leadScope: "all" | "own" | "team" };
  branchId: string | null;
  industryId?: string | null;
}

export interface BranchAssignTarget {
  /** tenant_users.branch_id of the person being picked (null = not in any branch). */
  branchId: string | null;
  /** tenant_users.role of the person being picked. */
  role: string | null;
}

export function isOwnerOrAdminCaller(caller: Pick<BranchAssignCaller, "role" | "permissions">): boolean {
  const { baseTier } = caller.permissions;
  return baseTier === "owner" || baseTier === "admin" || caller.role === "owner" || caller.role === "admin";
}

/** A team-scoped, non-admin user with a branch: a branch manager. */
export function isBranchManagerCaller(caller: BranchAssignCaller): boolean {
  return !isOwnerOrAdminCaller(caller) && caller.permissions.leadScope === "team" && !!caller.branchId;
}

/**
 * May this caller set the assignee on `rowBranchId`'s row of a lead?
 *  - owner/admin: any row.
 *  - branch manager: only THEIR OWN branch's row, and only if their branch actually holds the
 *    lead (origin or shared-in — the receiving branch's manager qualifies).
 *  - everyone else: no.
 */
export function canAssignOnBranchRow(
  caller: BranchAssignCaller,
  rowBranchId: string,
  membership: LeadMembership | { branch_id: string }[],
): boolean {
  if (isOwnerOrAdminCaller(caller)) return true;
  if (!isBranchManagerCaller(caller)) return false;
  return rowBranchId === caller.branchId && membership.some((m) => m.branch_id === caller.branchId);
}

/**
 * Admins are always a valid assignment target, whichever branch they sit in (or none) —
 * education_consultancy's rule, previously copy-pasted inside apply-lead-patch.ts.
 */
export function isAdminAssignmentTarget(industryId: string | null | undefined, role: string | null | undefined): boolean {
  return industryId === "education_consultancy" && role === "admin";
}

/** May `target` be picked as the assignee of `rowBranchId`'s row? Same-branch member, or an admin. */
export function isValidBranchRowAssignee(
  target: BranchAssignTarget,
  rowBranchId: string,
  industryId: string | null | undefined,
): boolean {
  return target.branchId === rowBranchId || isAdminAssignmentTarget(industryId, target.role);
}

/**
 * Is this lead "in" a branch manager's branch, for bulk actions? The same three ways the single-lead
 * check (requireLeadAccess in auth.ts) already recognises: the lead's own branch, a lead another
 * branch SHARED IN to this branch (a lead_branches row — `heldViaSharing`), or a lead currently
 * assigned to one of the branch's members. The bulk route used to check only the first and third, so
 * a manager's bulk-assign silently dropped every lead shared in to their branch.
 */
export function isLeadInManagerBranch(
  lead: { branch_id: string | null; assigned_to: string | null },
  heldViaSharing: boolean,
  managerBranchId: string | null,
  branchMemberIds: readonly string[],
): boolean {
  if (!managerBranchId) return false;
  return (
    lead.branch_id === managerBranchId ||
    heldViaSharing ||
    (lead.assigned_to !== null && branchMemberIds.includes(lead.assigned_to))
  );
}
