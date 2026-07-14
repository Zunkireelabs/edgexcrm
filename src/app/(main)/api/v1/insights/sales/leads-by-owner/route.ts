import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

// Leads by Owner (sales-leads-by-owner). Server-side aggregation via the
// sales_leads_by_owner RPC (migration 147). Returns raw {user_id, count} rows —
// name resolution happens client-side against /api/v1/team?minimal=1, same as
// the delivery-health widget's ownerName() pattern.
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.INSIGHTS)) return apiForbidden();
  // These are it_agency-specific aggregations (deals/deal_stages have no education
  // meaning) — FEATURES.INSIGHTS alone is shared/global, so gate the industry too,
  // mirroring the widget-catalog/renderer defense-in-depth for this dashboard.
  if (auth.industryId !== "it_agency") return apiForbidden();

  const db = await scopedClient(auth);
  const restrictTo = shouldRestrictToSelf(auth.permissions) ? auth.userId : null;

  const { data, error } = await db.raw().rpc("sales_leads_by_owner", {
    p_tenant: auth.tenantId,
    p_assigned_to: restrictTo,
  });

  if (error) return apiError("DB_ERROR", "Failed to load leads by owner", 500);
  return apiSuccess(data ?? []);
}
