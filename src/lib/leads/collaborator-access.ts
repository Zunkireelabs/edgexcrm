import { requireLeadBranchAccess, type AuthContext } from "@/lib/api/auth";
import type { LeadMembership } from "@/lib/leads/branch-membership";

/**
 * Who may add/remove collaborators on a lead (other than a collaborator removing themselves).
 * - Owner/admin: always.
 * - Branch manager (team scope, can edit leads, has a branch): only for a lead in their OWN branch — judged by the
 *   same rule that decides which leads they can see/open (roster row, direct branch_id, or an assignee in their branch).
 * - Everyone else (own-scope counsellors, all-scope members, viewers, a manager with no branch): no.
 */
export function canManageLeadCollaborators(
  auth: Pick<AuthContext, "userId" | "branchId" | "branchMemberIds"> & {
    permissions: Pick<AuthContext["permissions"], "baseTier" | "leadScope" | "canEditLeads">;
  },
  lead: { assigned_to: string | null; branch_id?: string | null },
  membership: LeadMembership,
): boolean {
  const p = auth.permissions;
  if (p.baseTier === "owner" || p.baseTier === "admin") return true;
  return p.leadScope === "team" && p.canEditLeads && !!auth.branchId && requireLeadBranchAccess(auth, lead, membership);
}
