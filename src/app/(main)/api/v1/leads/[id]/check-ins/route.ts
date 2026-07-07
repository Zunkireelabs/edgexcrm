import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireLeadBranchAccess, isOwnBranchContact } from "@/lib/api/auth";
import { getLeadMembership } from "@/lib/leads/branch-membership";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/v1/leads/:id/check-ins — get all check-in notes for a specific lead
export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CHECK_IN)) return apiForbidden();

  const supabase = await createServiceClient();

  // Verify lead exists and belongs to tenant
  const { data: lead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id, tags")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) return apiNotFound("Lead");

  // Counselor: own-only; branch-manager: membership-based.
  // Exception: walk-in "other" contacts are visible to any user in their branch.
  const membership = await getLeadMembership(supabase, auth.tenantId, id);
  if (shouldRestrictToSelf(auth.permissions) && !isOwnBranchContact(auth, lead) && !(membership.some((m) => m.assigned_to === auth.userId) || lead.assigned_to === auth.userId)) return apiNotFound("Lead");
  if (!requireLeadBranchAccess(auth, lead, membership)) return apiNotFound("Lead");

  // Fetch all check-in notes for this lead
  const { data, error } = await supabase
    .from("lead_notes")
    .select("id, content, created_at, user_email")
    .eq("lead_id", id)
    .like("content", "[CHECK-IN]%")
    .order("created_at", { ascending: false });

  if (error) {
    return apiServiceUnavailable("Failed to fetch check-in history");
  }

  return apiSuccess(data || []);
}
