import { isAssistantEnabledForTenant } from "@/lib/ai/flag";

/**
 * Home's AI gate: the env kill switch AND the tenant's ai_enabled (isAssistantEnabledForTenant checks both), read once on
 * the server. Never throws: any failure reads as "AI off" so Home stays the rule-based Home.
 */
export async function homeAiEnabled(tenantId: string): Promise<boolean> {
  try {
    return await isAssistantEnabledForTenant(tenantId);
  } catch {
    return false;
  }
}
