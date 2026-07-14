import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

// Scope-Creep Meter (delivery-scope-creep). Aggregates project_change_requests
// by status + Σ estimate_delta_minutes + Σ budget_delta_amount. Plain scopedClient
// query (not a service-role RPC like the sales RPCs) — project_change_requests is
// small per-tenant and its RLS (tenant_id IN get_user_tenant_ids()) is sufficient;
// no PostgREST 1000-row-cap risk here the way leads has.
// No per-row currency column on project_change_requests — defaults to NPR (tenant
// default), same fallback used by sales_deals_summary (migration 147).
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.INSIGHTS)) return apiForbidden();
  // INSIGHTS is shared/global, so gate the industry explicitly too —
  // defense-in-depth, consistent with the sales routes.
  if (auth.industryId !== "it_agency") return apiForbidden();

  const db = await scopedClient(auth);

  let projectIds: string[] | null = null;
  if (shouldRestrictToSelf(auth.permissions)) {
    const { data: ownProjects, error: projectsError } = await db
      .from("projects")
      .select("id")
      .eq("owner_id", auth.userId);
    if (projectsError) return apiError("DB_ERROR", "Failed to load owned projects", 500);
    projectIds = (ownProjects ?? []).map((p) => (p as unknown as { id: string }).id);
    if (projectIds.length === 0) {
      return apiSuccess({ proposed: 0, approved: 0, rejected: 0, addedScopeMinutes: 0, budgetDelta: 0, currency: "NPR" });
    }
  }

  let query = db.from("project_change_requests").select("status, estimate_delta_minutes, budget_delta_amount");
  if (projectIds) query = query.in("project_id", projectIds);

  const { data, error } = await query;
  if (error) return apiError("DB_ERROR", "Failed to load change requests", 500);

  const rows = (data ?? []) as unknown as Array<{
    status: string;
    estimate_delta_minutes: number;
    budget_delta_amount: number | null;
  }>;

  let proposed = 0;
  let approved = 0;
  let rejected = 0;
  let addedScopeMinutes = 0;
  let budgetDelta = 0;

  for (const r of rows) {
    if (r.status === "proposed") proposed++;
    else if (r.status === "approved") approved++;
    else if (r.status === "rejected") rejected++;

    if (r.status === "approved") {
      addedScopeMinutes += r.estimate_delta_minutes;
      budgetDelta += r.budget_delta_amount ?? 0;
    }
  }

  return apiSuccess({ proposed, approved, rejected, addedScopeMinutes, budgetDelta, currency: "NPR" });
}
