import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { ensureDealStages } from "@/lib/deals/stages";

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.DEALS)) return apiForbidden();

  const db = await scopedClient(auth);
  await ensureDealStages(db, auth.tenantId);

  const { data, error } = await db
    .from("deal_stages")
    .select("*")
    .order("position", { ascending: true });

  if (error) return apiError("DB_ERROR", "Failed to fetch deal stages", 500);
  return apiSuccess(data ?? []);
}
