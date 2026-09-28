import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { resolveThresholds } from "@/industries/education-consultancy/features/team-performance/lib/thresholds";
import type { TenantConfig } from "@/types/database";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Powers the Relay Explorer's Person -> Lead drill level — individual lead
// rows for one stage x position x person cell (education_relay_leads,
// migration 245, unassigned-handling added in 247). Window-independent —
// "this person's current leads right now," not scoped to the dashboard's
// date-window filter. p_position_slug is optional: the jump-to-person view
// drills stage x person without a position. userId is also optional — its
// absence means "the unassigned bucket," not "no filter" — the RPC matches
// `assigned_to IS NULL` in that case (migration 247).
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.INSIGHTS)) return apiForbidden();
  if (!getFeatureAccess(auth.industryId, FEATURES.TEAM_PERFORMANCE)) return apiForbidden();
  if (auth.role !== "owner" && auth.role !== "admin") return apiForbidden();

  const stageSlug = request.nextUrl.searchParams.get("stage");
  const positionSlug = request.nextUrl.searchParams.get("position");
  const userId = request.nextUrl.searchParams.get("userId");
  if (!stageSlug) return apiError("VALIDATION_ERROR", "stage is required", 422);
  if (userId && !UUID_RE.test(userId)) return apiError("VALIDATION_ERROR", "userId must be a valid UUID", 422);

  const db = await scopedClient(auth);
  const { data, error } = await db.raw().rpc("education_relay_leads", {
    p_tenant: auth.tenantId,
    p_stage_slug: stageSlug,
    p_position_slug: positionSlug ?? null,
    p_user_id: userId ?? null,
  });

  if (error) return apiError("DB_ERROR", "Failed to load leads for this cell", 500);

  // Surfaces the follow-up-stale threshold alongside the rows so the client
  // can compute the follow-up-needed sign without a second fetch — the flag
  // itself is still computed client-side from last_touch_at (no RPC change).
  const { data: tenantRow } = await db.raw().from("tenants").select("config").eq("id", auth.tenantId).single();
  const thresholds = resolveThresholds((tenantRow?.config ?? null) as TenantConfig | null);

  return apiSuccess({ leads: data ?? [], followUpStaleDays: thresholds.followUpStaleDays });
}
