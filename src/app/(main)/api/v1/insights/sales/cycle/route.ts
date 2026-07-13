import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

// Sales Cycle Length (sales-cycle). Server-side aggregation via the sales_cycle
// RPC (migration 149): avg/median days from leads.created_at to converted_at.
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.INSIGHTS)) return apiForbidden();
  // These are it_agency-specific aggregations — FEATURES.INSIGHTS alone is
  // shared/global, so gate the industry too, mirroring the widget-catalog/
  // renderer defense-in-depth for this dashboard.
  if (auth.industryId !== "it_agency") return apiForbidden();

  const db = await scopedClient(auth);
  const restrictTo = shouldRestrictToSelf(auth.permissions) ? auth.userId : null;

  const { data, error } = await db.raw().rpc("sales_cycle", {
    p_tenant: auth.tenantId,
    p_assigned_to: restrictTo,
  });

  if (error) return apiError("DB_ERROR", "Failed to load sales cycle length", 500);

  const row = (data ?? [])[0] ?? { avg_days: 0, median_days: 0, sample_size: 0 };

  return apiSuccess({
    avgDays: Number(row.avg_days ?? 0),
    medianDays: Number(row.median_days ?? 0),
    sampleSize: Number(row.sample_size ?? 0),
  });
}
