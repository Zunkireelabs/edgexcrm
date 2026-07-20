import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

const BUCKETS = ["0-7", "8-14", "15-30", "30+"] as const;

// Aging / Stale Leads (sales-aging). Server-side aggregation via the sales_aging
// RPC (migration 147). "Open" = not in an archive lead_list. Normalizes to all 4
// buckets (0 for any bucket the RPC didn't return a row for) so the widget always
// renders a complete axis.
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

  const { data, error } = await db.raw().rpc("sales_aging", {
    p_tenant: auth.tenantId,
    p_assigned_to: restrictTo,
  });

  if (error) return apiError("DB_ERROR", "Failed to load aging leads", 500);

  const counts = new Map((data ?? []).map((r: { bucket: string; count: number }) => [r.bucket, r.count]));
  const normalized = BUCKETS.map((bucket) => ({ bucket, count: Number(counts.get(bucket) ?? 0) }));

  return apiSuccess(normalized);
}
