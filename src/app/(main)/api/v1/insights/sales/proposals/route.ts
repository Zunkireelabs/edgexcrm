import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

// Proposal Engagement (sales-proposals). Server-side aggregation via the
// sales_proposals RPC (migration 149): status mix, viewed count, acceptance
// rate, avg time-to-view / time-to-accept. No owner scoping — proposals have
// no direct owner column (only via their deal), matching the RPC signature.
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.INSIGHTS)) return apiForbidden();
  // These are it_agency-specific aggregations — FEATURES.INSIGHTS alone is
  // shared/global, so gate the industry too, mirroring the widget-catalog/
  // renderer defense-in-depth for this dashboard.
  if (auth.industryId !== "it_agency") return apiForbidden();

  const db = await scopedClient(auth);

  const { data, error } = await db.raw().rpc("sales_proposals", {
    p_tenant: auth.tenantId,
  });

  if (error) return apiError("DB_ERROR", "Failed to load proposal engagement", 500);

  const row = (data ?? [])[0] ?? {
    draft_count: 0,
    sent_count: 0,
    accepted_count: 0,
    rejected_count: 0,
    expired_count: 0,
    viewed_count: 0,
    acceptance_rate_pct: 0,
    avg_hours_to_view: null,
    avg_hours_to_accept: null,
  };

  return apiSuccess({
    draftCount: Number(row.draft_count ?? 0),
    sentCount: Number(row.sent_count ?? 0),
    acceptedCount: Number(row.accepted_count ?? 0),
    rejectedCount: Number(row.rejected_count ?? 0),
    expiredCount: Number(row.expired_count ?? 0),
    viewedCount: Number(row.viewed_count ?? 0),
    acceptanceRatePct: Number(row.acceptance_rate_pct ?? 0),
    avgHoursToView: row.avg_hours_to_view === null ? null : Number(row.avg_hours_to_view),
    avgHoursToAccept: row.avg_hours_to_accept === null ? null : Number(row.avg_hours_to_accept),
  });
}
