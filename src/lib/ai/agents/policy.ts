import type { ScopedClient } from "@/lib/supabase/scoped";

/**
 * Per-(tenant, agent, tool) write-authorization level
 * (docs/ai-native-efforts/04-PHASE-4-AUTONOMY-AND-WRITES.md §1). Resolved
 * from `agent_tool_policies` (migration 181).
 */
export type AutomationLevel = "human_led" | "agent_human" | "fully_automated";

// Default-deny is the load-bearing invariant: a (tenant, agent, tool) triple
// with no agent_tool_policies row resolves to the most restrictive level,
// never an implicit grant. Loosening this is always an explicit tenant
// admin/owner write to that table — never an app-code default.
export const DEFAULT_AUTOMATION_LEVEL: AutomationLevel = "human_led";

export interface ResolveAutomationLevelParams {
  db: ScopedClient;
  tenantId: string;
  agentId: string;
  toolId: string;
}

/**
 * Reads the stored automation level for this (tenant, agent, tool) triple,
 * or DEFAULT_AUTOMATION_LEVEL when no row exists yet — e.g. a brand-new
 * agent, or a tool it was never explicitly configured for.
 */
export async function resolveAutomationLevel({
  db,
  tenantId,
  agentId,
  toolId,
}: ResolveAutomationLevelParams): Promise<AutomationLevel> {
  const { data } = await db
    .from("agent_tool_policies")
    .select("automation_level")
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .eq("tool_id", toolId)
    .maybeSingle();
  const row = data as { automation_level: AutomationLevel } | null;
  return row?.automation_level ?? DEFAULT_AUTOMATION_LEVEL;
}
