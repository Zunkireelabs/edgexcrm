import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

// PATCH /api/v1/leads/duplicates/:suggestionId
// Dismisses a duplicate suggestion. Admin-only. Tenant-mismatch treated as 404.
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ suggestionId: string }> }
) {
  const { suggestionId } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "PATCH",
    path: `/api/v1/leads/duplicates/${suggestionId}`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  const supabase = await createServiceClient();

  // Load + verify tenant ownership (mismatch = 404, don't leak existence)
  const { data: suggestion } = await supabase
    .from("lead_duplicate_suggestions")
    .select("id, tenant_id, status")
    .eq("id", suggestionId)
    .maybeSingle();

  if (!suggestion || (suggestion as { tenant_id: string }).tenant_id !== auth.tenantId) {
    return apiNotFound("Suggestion");
  }

  const { error } = await supabase
    .from("lead_duplicate_suggestions")
    .update({ status: "dismissed" })
    .eq("id", suggestionId)
    .eq("tenant_id", auth.tenantId);

  if (error) {
    log.error({ err: error }, "Failed to dismiss suggestion");
    return apiServiceUnavailable("Failed to dismiss suggestion");
  }

  log.info({ suggestionId }, "Suggestion dismissed");
  return apiSuccess({ id: suggestionId, status: "dismissed" }, 200);
}
