import { checkDailyBudget, type HomeAiSurface } from "@/lib/ai/budget";
import { MODELS, ACTIVE_PROVIDER } from "@/lib/ai/models";
import type { ScopedClient } from "@/lib/supabase/scoped";

/** Every Home model call is bounded: past this it is abandoned and the rule-based Home stays. */
export const HOME_AI_TIMEOUT_MS = 8_000;

export async function homeOverBudget(db: ScopedClient, tenantId: string): Promise<boolean> {
  return (await checkDailyBudget(db, tenantId)).overBudget;
}

/** One ai_usage_events row per call, tagged with the Home surface so budget.ts counts it and the cost report can split it. */
export async function recordHomeUsage(
  db: ScopedClient,
  p: { surface: HomeAiSurface; kind: "agent" | "fast"; userId: string; runId: string; usage: { inputTokens?: number; outputTokens?: number } },
): Promise<void> {
  await db.from("ai_usage_events").insert({
    run_id: p.runId,
    user_id: p.userId,
    model: MODELS[ACTIVE_PROVIDER][p.kind],
    input_tokens: p.usage.inputTokens ?? null,
    output_tokens: p.usage.outputTokens ?? null,
    tool_calls: 0,
    surface: p.surface,
  });
}
