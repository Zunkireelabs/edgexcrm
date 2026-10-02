import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/api/auth";
import { getLeadMembership, canManageLeadBranches } from "@/lib/leads/branch-membership";
import { canAssignOnBranchRow, isValidBranchRowAssignee } from "@/lib/leads/branch-assign-policy";
import { getTeamMembers } from "@/lib/supabase/queries";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiValidationError } from "@/lib/api/response";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteParams = { params: Promise<{ id: string; branchId: string }> };

/**
 * GET /api/v1/leads/:id/branches/:branchId/assignees
 *
 * The exact people the CALLER may pick as the assignee for this lead on `branchId` — computed on
 * the server with the same rule the write routes enforce (branch-assign-policy.ts), so the branch
 * panel's dropdown can never offer someone the PATCH/POST would refuse, and never comes up EMPTY
 * because the caller can't read /api/v1/team (a branch manager without that nav item / the assign
 * permission gets 403 there — the old dropdown was built from that roster).
 *
 * Works for a branch the lead is already in (per-row assign) AND for a branch it is about to be
 * shared into (the "Send to branch" dialog).
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id, branchId } = await params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (auth.entitlements.maxBranches <= 1) return apiForbidden();
  if (!UUID_REGEX.test(branchId)) return apiValidationError({ branchId: ["Invalid UUID format"] });

  const supabase = await createServiceClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();
  if (!lead) return apiNotFound("Lead");

  const { data: branch } = await supabase
    .from("branches")
    .select("id")
    .eq("id", branchId)
    .eq("tenant_id", auth.tenantId)
    .single();
  if (!branch) return apiNotFound("Branch");

  const membership = await getLeadMembership(supabase, auth.tenantId, id);
  const rowExists = membership.some((m) => m.branch_id === branchId);
  // Existing row → the per-row rule (a manager: only their own branch's row). Not yet shared →
  // whoever may share this lead (canManageLeadBranches) may pick a person for the new row.
  const allowed = rowExists ? canAssignOnBranchRow(auth, branchId, membership) : canManageLeadBranches(auth, membership);
  if (!allowed) return apiForbidden();

  const team = await getTeamMembers(auth.tenantId);
  const assignees = team
    .filter((m) => isValidBranchRowAssignee({ branchId: m.branch_id ?? null, role: m.role ?? null }, branchId, auth.industryId))
    .map((m) => ({
      user_id: m.user_id,
      name: m.name || null,
      email: m.email,
      branch_id: m.branch_id ?? null,
      // Tells the panel why someone outside the branch is listed (an education admin).
      is_admin_exempt: (m.branch_id ?? null) !== branchId,
    }));

  return apiSuccess({ assignees });
}
