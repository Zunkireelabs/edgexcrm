import type { AuthContext } from "@/lib/api/auth";

/**
 * May this user open the FULL lead page for a lead assigned to `lead.assigned_to`? Used only to decide whether the preview
 * offers an "Open lead" button. Conservative on purpose: it says "yes" only when the lead page would open for this user
 * (owner/admin, all-scope, the assignee, or a team manager over the assignee's branch). The lead page stays the real gate.
 */
export function canOpenLead(
  auth: Pick<AuthContext, "userId" | "branchMemberIds"> & {
    permissions: Pick<AuthContext["permissions"], "baseTier" | "leadScope">;
  },
  lead: { assigned_to: string | null },
): boolean {
  const p = auth.permissions;
  if (p.baseTier === "owner" || p.baseTier === "admin") return true;
  if (p.leadScope === "all") return true;
  if (lead.assigned_to && lead.assigned_to === auth.userId) return true;
  if (p.leadScope === "team" && lead.assigned_to && auth.branchMemberIds.includes(lead.assigned_to)) return true;
  return false;
}
