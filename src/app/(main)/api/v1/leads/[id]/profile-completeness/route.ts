import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireLeadBranchAccess } from "@/lib/api/auth";
import { getLeadMembership } from "@/lib/leads/branch-membership";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound } from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { checkLeadProfileCompleteness } from "@/lib/leads/profile-completeness";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Read-only "is this student's profile complete enough to create an application?" — the same rule
 * (checkLeadProfileCompleteness) the create-application APIs enforce at save time. The Add
 * Application screens call this up front so a missing item is shown BEFORE the user fills the
 * form, not as a small message after pressing Add. The create APIs still enforce the rule.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();

  const supabase = await createServiceClient();

  // Same lead-visibility rules as the consent status route: tenant, not deleted, counselor scope, branch.
  const { data: lead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) return apiNotFound("Lead");
  const leadRow = lead as { id: string; assigned_to: string | null; branch_id: string | null };

  const membership = await getLeadMembership(supabase, auth.tenantId, id);
  if (
    shouldRestrictToSelf(auth.permissions) &&
    !(
      leadRow.assigned_to === auth.userId ||
      membership.some((m: { assigned_to: string | null }) => m.assigned_to === auth.userId)
    )
  ) {
    return apiNotFound("Lead");
  }
  if (!requireLeadBranchAccess(auth, leadRow, membership)) return apiNotFound("Lead");

  const result = await checkLeadProfileCompleteness(supabase, auth.tenantId, id);
  return apiSuccess({ complete: result.complete, missing: result.missing });
}
