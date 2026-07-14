import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

// Win / Loss (sales-win-loss). Server-side aggregation via the sales_win_loss
// RPC (migration 149): won vs lost deal counts + amounts, all-time.
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

  const { data, error } = await db.raw().rpc("sales_win_loss", {
    p_tenant: auth.tenantId,
    p_owner: restrictTo,
  });

  if (error) return apiError("DB_ERROR", "Failed to load win/loss", 500);

  const row = (data ?? [])[0] ?? { won_count: 0, lost_count: 0, won_amount: 0, lost_amount: 0, currency: "NPR" };

  return apiSuccess({
    wonCount: Number(row.won_count ?? 0),
    lostCount: Number(row.lost_count ?? 0),
    wonAmount: Number(row.won_amount ?? 0),
    lostAmount: Number(row.lost_amount ?? 0),
    currency: row.currency,
  });
}
