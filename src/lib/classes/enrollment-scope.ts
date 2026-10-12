import { requireLeadBranchAccess, type AuthContext } from "@/lib/api/auth";
import { shouldRestrictToSelf, type ResolvedPermissions } from "@/lib/api/permissions";
import type { LeadMembership } from "@/lib/leads/branch-membership";

/** What the scope rule needs to know about the signed-in user (a subset of AuthContext). */
export type EnrollmentScopeSubject = Pick<AuthContext, "userId" | "branchId" | "branchMemberIds"> & {
  permissions: Pick<ResolvedPermissions, "leadScope">;
};

/**
 * May this user change (fee, status, convert, un-enroll) a class enrollment whose student is this
 * lead? Own-scope users need the lead assigned to them (directly or via a branch share); team-scope
 * users need it in their branch. Owners/admins (all scope) are never blocked here.
 *
 * ONE rule, used by the enrollment API routes (which enforce it) and by the Classes page (which
 * uses it to tell the screen up front, so the two can't drift apart).
 */
export function canActOnEnrollmentLead(
  subject: EnrollmentScopeSubject,
  lead: { assigned_to: string | null; branch_id?: string | null },
  membership: LeadMembership,
): boolean {
  if (
    shouldRestrictToSelf(subject.permissions as ResolvedPermissions) &&
    !(
      lead.assigned_to === subject.userId ||
      membership.some((m) => m.assigned_to === subject.userId)
    )
  ) {
    return false;
  }
  return requireLeadBranchAccess(subject, lead, membership);
}
