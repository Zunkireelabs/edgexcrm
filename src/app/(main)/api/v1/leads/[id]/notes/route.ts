import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireLeadBranchAccess } from "@/lib/api/auth";
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
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "GET",
    path: `/api/v1/leads/${id}/notes`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const supabase = await createServiceClient();

  // Verify lead exists, not soft-deleted, tenant scoped
  const { data: lead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) return apiNotFound("Lead");

  // Counselor: own-only
  if (shouldRestrictToSelf(auth.permissions) && lead.assigned_to !== auth.userId) return apiNotFound("Lead");
  if (!requireLeadBranchAccess(auth, lead)) return apiNotFound("Lead");

  const { data, error } = await supabase
    .from("lead_notes")
    .select("*")
    .eq("lead_id", id)
    .order("created_at", { ascending: false });

  if (error) {
    log.error({ err: error }, "Failed to fetch notes");
    return apiServiceUnavailable("Failed to fetch notes");
  }

  return apiSuccess(data);
}
