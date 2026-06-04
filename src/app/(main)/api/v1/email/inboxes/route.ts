import { authenticateRequest } from "@/lib/api/auth";
import { apiUnauthorized, apiForbidden, apiSuccess, apiInternalError } from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { scopedClient } from "@/lib/supabase/scoped";

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EMAIL)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("connected_email_accounts")
    .select("id, email, display_name, provider, created_at")
    .eq("user_id", auth.userId);

  if (error) return apiInternalError();

  return apiSuccess(data ?? []);
}
