import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";

export async function GET() {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "GET", path: "/api/v1/agent-outputs/pending-count" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { count, error } = await db
    .from("agent_outputs")
    .select("*", { count: "exact", head: true })
    .eq("status", "proposed");

  if (error) {
    log.error({ error }, "Failed to count pending agent outputs");
    return apiError("DB_ERROR", "Failed to count pending agent outputs", 500);
  }

  return apiSuccess({ count: count ?? 0 });
}
