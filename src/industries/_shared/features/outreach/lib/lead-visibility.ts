import type { AuthContext } from "@/lib/api/auth";
import { requireLeadBranchAccess } from "@/lib/api/auth";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { getLeadMembership } from "@/lib/leads/branch-membership";
import { isLeadCollaborator } from "@/lib/leads/collaborators";
import type { ScopedClient } from "@/lib/supabase/scoped";

export interface VisibleLead {
  id: string;
  assigned_to: string | null;
  branch_id: string | null;
}

/**
 * The lead if this user may open it, else null. Visibility follows the LEAD (same rule as the lead page and the student-record
 * route): an own-scope counselor sees their own leads and ones they collaborate on, a branch-scoped user their branch.
 * Shared by every lead-page Outreach route (Subscribed tab, auto-enroll opt-out) so the rule lives in one place.
 */
export async function loadVisibleLead(db: ScopedClient, auth: AuthContext, leadId: string): Promise<VisibleLead | null> {
  const { data: lead } = await db.from("leads").select("id, assigned_to, branch_id").eq("id", leadId).is("deleted_at", null).maybeSingle();
  if (!lead) return null;
  const leadRow = lead as unknown as VisibleLead;

  const membership = await getLeadMembership(db.raw(), auth.tenantId, leadId);
  const restrictedAndUnassigned =
    shouldRestrictToSelf(auth.permissions) &&
    !(membership.some((m) => m.assigned_to === auth.userId) || leadRow.assigned_to === auth.userId);
  if (restrictedAndUnassigned || !requireLeadBranchAccess(auth, leadRow, membership)) {
    if (!(await isLeadCollaborator(db.raw(), auth.tenantId, leadId, auth.userId))) return null;
  }
  return leadRow;
}
