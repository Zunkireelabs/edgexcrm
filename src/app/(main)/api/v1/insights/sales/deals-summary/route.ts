import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

// Deals Snapshot (sales-deals-summary). Server-side aggregation via the
// sales_deals_summary RPC (migration 147): win rate, open count, weighted
// pipeline (amount * effective probability), bookings won this month.
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

  const { data, error } = await db.raw().rpc("sales_deals_summary", {
    p_tenant: auth.tenantId,
    p_owner: restrictTo,
  });

  if (error) return apiError("DB_ERROR", "Failed to load deals summary", 500);

  const row = (data ?? [])[0] ?? {
    win_rate_pct: 0,
    open_count: 0,
    weighted_pipeline: 0,
    bookings_won_mtd: 0,
    currency: "NPR",
  };

  return apiSuccess({
    winRatePct: Number(row.win_rate_pct),
    openCount: Number(row.open_count),
    weightedPipeline: Number(row.weighted_pipeline),
    bookingsWonMTD: Number(row.bookings_won_mtd),
    currency: row.currency,
  });
}
