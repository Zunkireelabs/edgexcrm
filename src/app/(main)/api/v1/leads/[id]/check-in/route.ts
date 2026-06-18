import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireLeadBranchAccess } from "@/lib/api/auth";
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

// POST /api/v1/leads/:id/check-in — log a check-in visit note
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CHECK_IN)) return apiForbidden();

  const supabase = await createServiceClient();

  // Verify lead exists and belongs to tenant
  const { data: lead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) return apiNotFound("Lead");

  // Counselor: own-only; branch-manager: membership-based
  const membership = await getLeadMembership(supabase, auth.tenantId, id);
  if (shouldRestrictToSelf(auth.permissions) && !(membership.some((m) => m.assigned_to === auth.userId) || lead.assigned_to === auth.userId)) return apiNotFound("Lead");
  if (!requireLeadBranchAccess(auth, lead, membership)) return apiNotFound("Lead");

  let reason = "";
  try {
    const body = await request.json();
    reason = (body.reason as string) || "";
  } catch {
    // No body is fine
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const content = reason
    ? `[CHECK-IN] Visited on ${dateStr} at ${timeStr} — ${reason}`
    : `[CHECK-IN] Visited on ${dateStr} at ${timeStr}`;

  const { error } = await supabase.from("lead_notes").insert({
    lead_id: id,
    user_id: auth.userId,
    user_email: auth.email || "unknown",
    content,
  });

  if (error) {
    return apiServiceUnavailable("Failed to log check-in");
  }

  return apiSuccess({ checked_in: true, lead_id: id });
}
