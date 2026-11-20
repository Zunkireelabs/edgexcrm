import { authenticateRequest } from "@/lib/api/auth";
import { apiError, apiForbidden, apiSuccess, apiUnauthorized } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

// POST /api/v1/home/launch — owner/admin stamps "the new Home went live now". It only sets an EMPTY date (the baseline
// of "Is the new Home helping?" must not move once measuring has started).
export async function POST() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EDU_HOME)) return apiForbidden();
  if (auth.role !== "owner" && auth.role !== "admin") return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db.from("home_settings").select("home_launched_at").maybeSingle();
  const current = (existing as unknown as { home_launched_at: string | null } | null)?.home_launched_at;
  if (current) return apiSuccess({ home_launched_at: current, already: true });

  const at = new Date().toISOString();
  const { error } = await db
    .from("home_settings")
    .upsert({ home_launched_at: at, updated_by: auth.userId, updated_at: at }, { onConflict: "tenant_id" });
  if (error) return apiError("DB_ERROR", "Failed to save", 500);
  return apiSuccess({ home_launched_at: at, already: false }, 201);
}
