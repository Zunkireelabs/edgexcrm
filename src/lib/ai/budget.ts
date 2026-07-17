import type { ScopedClient } from "@/lib/supabase/scoped";

const DEFAULT_DAILY_OUTPUT_TOKEN_BUDGET = 200_000;

export interface BudgetCheckResult {
  overBudget: boolean;
  usedToday: number;
  limit: number;
}

/**
 * Sums today's (UTC) assistant-surface output tokens for the tenant against
 * AI_DAILY_OUTPUT_TOKEN_BUDGET (default 200k). Env override exists so a
 * verification run can set it to 1 and prove the 429 path.
 */
export async function checkDailyBudget(db: ScopedClient, tenantId: string): Promise<BudgetCheckResult> {
  const limit = Number(process.env.AI_DAILY_OUTPUT_TOKEN_BUDGET ?? DEFAULT_DAILY_OUTPUT_TOKEN_BUDGET);

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { data } = await db
    .from("ai_usage_events")
    .select("output_tokens")
    .eq("tenant_id", tenantId)
    .eq("surface", "assistant")
    .gte("created_at", startOfDay.toISOString());

  const usedToday = ((data ?? []) as unknown as Array<{ output_tokens: number | null }>).reduce(
    (sum, r) => sum + (r.output_tokens ?? 0),
    0,
  );

  return { overBudget: usedToday >= limit, usedToday, limit };
}
