import type { ScopedClient } from "@/lib/supabase/scoped";

const DEFAULT_DAILY_OUTPUT_TOKEN_BUDGET = 200_000;
const DEFAULT_AGENT_DAILY_OUTPUT_TOKEN_BUDGET = 100_000;

export interface BudgetCheckResult {
  overBudget: boolean;
  usedToday: number;
  limit: number;
}

async function sumOutputTokensToday(db: ScopedClient, tenantId: string, surface: string): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { data } = await db
    .from("ai_usage_events")
    .select("output_tokens")
    .eq("tenant_id", tenantId)
    .eq("surface", surface)
    .gte("created_at", startOfDay.toISOString());

  return ((data ?? []) as unknown as Array<{ output_tokens: number | null }>).reduce(
    (sum, r) => sum + (r.output_tokens ?? 0),
    0,
  );
}

/**
 * Sums today's (UTC) assistant-surface output tokens for the tenant against
 * AI_DAILY_OUTPUT_TOKEN_BUDGET (default 200k). Env override exists so a
 * verification run can set it to 1 and prove the 429 path.
 */
export async function checkDailyBudget(db: ScopedClient, tenantId: string): Promise<BudgetCheckResult> {
  const limit = Number(process.env.AI_DAILY_OUTPUT_TOKEN_BUDGET ?? DEFAULT_DAILY_OUTPUT_TOKEN_BUDGET);
  const usedToday = await sumOutputTokensToday(db, tenantId, "assistant");
  return { overBudget: usedToday >= limit, usedToday, limit };
}

/**
 * Same shape as checkDailyBudget, scoped to surface:'background_agent' (mig
 * 168's CHECK constraint value) against its own budget,
 * AI_AGENT_DAILY_OUTPUT_TOKEN_BUDGET (default 100k) — background agents are
 * a separate spend line from the interactive assistant (doc 03 §3's runtime
 * guard, doc 05 §3's per-surface cost control).
 */
export async function checkAgentDailyBudget(db: ScopedClient, tenantId: string): Promise<BudgetCheckResult> {
  const limit = Number(process.env.AI_AGENT_DAILY_OUTPUT_TOKEN_BUDGET ?? DEFAULT_AGENT_DAILY_OUTPUT_TOKEN_BUDGET);
  const usedToday = await sumOutputTokensToday(db, tenantId, "background_agent");
  return { overBudget: usedToday >= limit, usedToday, limit };
}
