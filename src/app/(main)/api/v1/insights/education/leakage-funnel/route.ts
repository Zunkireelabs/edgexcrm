import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { resolveWindowParam } from "@/industries/education-consultancy/features/team-performance/lib/resolve-window-param";
import { fetchTenantTimezone } from "@/industries/education-consultancy/features/team-performance/lib/fetch-tenant-timezone";

// Powers the Leakage widget — per stage, how many leads archived out without
// advancing, broken down by archive_reason (education_leakage_funnel, mig 243).
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.INSIGHTS)) return apiForbidden();
  if (auth.industryId !== "education_consultancy") return apiForbidden();
  if (auth.role !== "owner" && auth.role !== "admin") return apiForbidden();

  const db = await scopedClient(auth);
  const tenantTz = await fetchTenantTimezone(db, auth.tenantId);
  const window = resolveWindowParam(request.nextUrl.searchParams, tenantTz);
  if (!window) return apiError("VALIDATION_ERROR", "Invalid or missing date window", 422);

  const { data, error } = await db.raw().rpc("education_leakage_funnel", {
    p_tenant: auth.tenantId,
    p_from: window.from.toISOString(),
    p_to: window.to.toISOString(),
  });

  if (error) return apiError("DB_ERROR", "Failed to load leakage funnel", 500);
  return apiSuccess(data ?? []);
}
