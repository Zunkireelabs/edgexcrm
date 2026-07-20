import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

// Time to First Contact (sales-first-contact). Server-side aggregation via the
// sales_first_contact RPC (migration 149): avg/median hours from leads.created_at
// to the earliest lead_activities row for that lead.
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

  const { data, error } = await db.raw().rpc("sales_first_contact", {
    p_tenant: auth.tenantId,
    p_assigned_to: restrictTo,
  });

  if (error) return apiError("DB_ERROR", "Failed to load time to first contact", 500);

  const row = (data ?? [])[0] ?? { avg_hours: 0, median_hours: 0, sample_size: 0 };

  return apiSuccess({
    avgHours: Number(row.avg_hours ?? 0),
    medianHours: Number(row.median_hours ?? 0),
    sampleSize: Number(row.sample_size ?? 0),
  });
}
