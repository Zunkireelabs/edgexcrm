import type { AuthContext } from "@/lib/api/auth";
import { requireLeadBranchAccess } from "@/lib/api/auth";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { getLeadMembership } from "@/lib/leads/branch-membership";
import { scopedClient } from "@/lib/supabase/scoped";
import { createServiceClient } from "@/lib/supabase/server";

interface ApplicationAccessResult<T> {
  allowed: boolean;
  application: T | null;
  /**
   * True only when the initial applications query itself failed (a genuine
   * DB/backend error) — distinct from "row doesn't exist" or "not allowed",
   * both of which also leave `application: null`. Callers should return a
   * 500 (not a 404) when this is true, or a real backend failure gets
   * reported to the client as "not found," masking the actual cause.
   */
  dbError?: boolean;
}

// Shared parent-lead scope check for every /api/v1/applications/[id]* route
// (the application itself and its sub-resources like notes): tenant
// membership alone isn't enough — a counselor must also be allowed to see
// this specific student, not just any application in their tenant.
export async function getApplicationWithAccess<T extends { lead_id: string }>(
  auth: AuthContext,
  applicationId: string,
  selectColumns: string
): Promise<ApplicationAccessResult<T>> {
  const db = await scopedClient(auth);
  const { data: application, error } = await db
    .from("applications")
    .select(selectColumns)
    .eq("id", applicationId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return { allowed: false, application: null, dbError: true };
  if (!application) return { allowed: false, application: null };
  const appRow = application as unknown as T;

  const supabase = await createServiceClient();
  const { data: parentLead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id")
    .eq("id", appRow.lead_id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!parentLead) return { allowed: false, application: appRow };
  const parentLeadRow = parentLead as unknown as { id: string; assigned_to: string | null; branch_id: string | null };

  const membership = await getLeadMembership(supabase, auth.tenantId, parentLeadRow.id);
  if (
    shouldRestrictToSelf(auth.permissions) &&
    !(
      parentLeadRow.assigned_to === auth.userId ||
      membership.some((m: { assigned_to: string | null }) => m.assigned_to === auth.userId)
    )
  ) {
    return { allowed: false, application: appRow };
  }
  if (!requireLeadBranchAccess(auth, parentLeadRow, membership)) {
    return { allowed: false, application: appRow };
  }
  return { allowed: true, application: appRow };
}
