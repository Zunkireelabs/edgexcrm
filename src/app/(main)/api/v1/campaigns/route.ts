import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CAMPAIGNS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("campaigns")
    .select("id, name, slug, type, status, form_config_id, config, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) return apiError("DB_ERROR", "Failed to fetch campaigns", 500);

  return apiSuccess(data ?? []);
}
