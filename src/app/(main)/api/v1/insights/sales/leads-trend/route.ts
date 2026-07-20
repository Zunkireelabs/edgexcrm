import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

// New Leads Over Time (sales-leads-trend). Server-side aggregation via the
// sales_leads_trend RPC (migration 147) — getLeads() caps at 1000 rows
// (PostgREST max-rows), so this can never be computed from a fetched leads array.
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

  const { data, error } = await db.raw().rpc("sales_leads_trend", {
    p_tenant: auth.tenantId,
    p_assigned_to: restrictTo,
    p_weeks: 12,
  });

  if (error) return apiError("DB_ERROR", "Failed to load leads trend", 500);
  return apiSuccess(data ?? []);
}
