import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/api/auth";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import {
  apiSuccess,
  apiUnauthorized,
  apiNotFound,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; submissionId: string }> }
) {
  const { id, submissionId } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "GET",
    path: `/api/v1/leads/${id}/submissions/${submissionId}`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const supabase = await createServiceClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) return apiNotFound("Lead");

  // Counselor: own-only
  if (shouldRestrictToSelf(auth.permissions) && lead.assigned_to !== auth.userId) {
    return apiNotFound("Lead");
  }
  // Branch manager: branch-only (§4.1: NULL branchId falls back to own-only)
  if (auth.permissions.leadScope === "team") {
    const allowed = auth.branchId
      ? lead.branch_id === auth.branchId
      : lead.assigned_to === auth.userId;
    if (!allowed) return apiNotFound("Lead");
  }

  const { data, error } = await supabase
    .from("lead_submissions")
    .select("*")
    .eq("id", submissionId)
    .eq("lead_id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (error) {
    log.error({ err: error }, "Failed to fetch submission");
    return apiServiceUnavailable("Failed to fetch submission");
  }

  if (!data) return apiNotFound("Submission");

  return apiSuccess(data);
}
