import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

// Powers the Relay Explorer's Person -> Lead drill level — individual lead
// rows for one stage x position x person cell (education_relay_leads,
// migration 245). Window-independent — "this person's current leads right
// now," not scoped to the dashboard's date-window filter. p_position_slug is
// optional: the jump-to-person view drills stage x person without a position.
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.INSIGHTS)) return apiForbidden();
  if (!getFeatureAccess(auth.industryId, FEATURES.TEAM_PERFORMANCE)) return apiForbidden();
  if (auth.role !== "owner" && auth.role !== "admin") return apiForbidden();

  const stageSlug = request.nextUrl.searchParams.get("stage");
  const positionSlug = request.nextUrl.searchParams.get("position");
  const userId = request.nextUrl.searchParams.get("userId");
  if (!stageSlug || !userId) return apiError("VALIDATION_ERROR", "stage and userId are required", 422);

  const db = await scopedClient(auth);
  const { data, error } = await db.raw().rpc("education_relay_leads", {
    p_tenant: auth.tenantId,
    p_stage_slug: stageSlug,
    p_position_slug: positionSlug ?? null,
    p_user_id: userId,
  });

  if (error) return apiError("DB_ERROR", "Failed to load leads for this cell", 500);
  return apiSuccess(data ?? []);
}
