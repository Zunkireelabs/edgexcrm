import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireLeadBranchAccess } from "@/lib/api/auth";
import { getLeadMembership } from "@/lib/leads/branch-membership";
import { isLeadCollaborator } from "@/lib/leads/collaborators";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { checkApplicationsReadiness, applicationsGateMessage, applicationsGateApplies } from "@/lib/leads/applications-readiness";
import { apiSuccess, apiUnauthorized, apiNotFound } from "@/lib/api/response";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/v1/leads/:id/applications-readiness
//
// Read-only "can this lead move to Applications yet?" — the SAME rule the move itself enforces
// (checkApplicationsReadiness), so the UI can warn the moment someone clicks "Send to next"
// instead of after they confirm. It only reports labels (e.g. "Processing fee"), never lead data.
// The real move still re-checks on the server; this is a courtesy pre-check, not the gate.
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  // Same answer as the move itself (registry-driven). Tenants the gate doesn't apply to are always "ready".
  if (!applicationsGateApplies(auth.industryId)) return apiSuccess({ ready: true, missing: [], message: null });

  const supabase = await createServiceClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();
  if (!lead) return apiNotFound("Lead");
  const leadRow = lead as { id: string; assigned_to: string | null; branch_id: string | null };

  // Same visibility rule as the lead's other read routes.
  const membership = await getLeadMembership(supabase, auth.tenantId, id);
  const isRestrictedAndUnassigned =
    shouldRestrictToSelf(auth.permissions) &&
    !(
      membership.some((m: { assigned_to: string | null }) => m.assigned_to === auth.userId) ||
      leadRow.assigned_to === auth.userId
    );
  if (isRestrictedAndUnassigned) {
    if (!(await isLeadCollaborator(supabase, auth.tenantId, id, auth.userId))) return apiNotFound("Lead");
  } else if (!requireLeadBranchAccess(auth, leadRow, membership)) {
    if (!(await isLeadCollaborator(supabase, auth.tenantId, id, auth.userId))) return apiNotFound("Lead");
  }

  const readiness = await checkApplicationsReadiness(supabase, auth.tenantId, id);
  return apiSuccess({
    ready: readiness.ready,
    missing: readiness.missing,
    message: readiness.ready ? null : applicationsGateMessage(readiness.missing),
  });
}
