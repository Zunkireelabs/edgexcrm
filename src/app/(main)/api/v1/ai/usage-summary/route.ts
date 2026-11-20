import { isAssistantEnabledForTenant } from "@/lib/ai/flag";
import { checkDailyBudget } from "@/lib/ai/budget";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { scopedClient } from "@/lib/supabase/scoped";
import { apiSuccess, apiUnauthorized, apiForbidden, apiServiceUnavailable } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

/**
 * GET /api/v1/ai/usage-summary (EDGEX-86)
 * Owner/admin only. Feeds the avatar usage ring and the "AI credits" card in the
 * header menu. `enabled:false` when the assistant is off for this workspace
 * (env flag AND tenants.ai_enabled — the same pair `aiAssistantEnabled` reads).
 * `usedToday/dailyLimit` come from the enforced daily budget; `requestsThisMonth`
 * counts this tenant's assistant-surface ai_usage_events since the 1st (UTC).
 */
export async function GET() {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "GET", path: "/api/v1/ai/usage-summary" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  if (!(await isAssistantEnabledForTenant(auth.tenantId))) {
    return apiSuccess({ enabled: false });
  }

  const db = await scopedClient(auth);
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const [budget, monthly] = await Promise.all([
    checkDailyBudget(db, auth.tenantId),
    db
      .from("ai_usage_events")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", auth.tenantId)
      .eq("surface", "assistant")
      .gte("created_at", startOfMonth.toISOString()),
  ]);

  if (monthly.error) {
    log.error({ err: monthly.error }, "Failed to count monthly AI requests");
    return apiServiceUnavailable("Failed to load AI usage");
  }

  return apiSuccess({
    enabled: true,
    usedToday: budget.usedToday,
    dailyLimit: budget.limit,
    requestsThisMonth: monthly.count ?? 0,
  });
}
