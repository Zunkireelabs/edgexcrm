import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiServiceUnavailable } from "@/lib/api/response";

// GET /api/v1/settings/email-accounts — list connected accounts
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("connected_email_accounts")
    .select("id, tenant_id, provider, email, created_at, updated_at")
    .eq("tenant_id", auth.tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    return apiServiceUnavailable("Failed to fetch connected accounts");
  }

  return apiSuccess(data || []);
}
