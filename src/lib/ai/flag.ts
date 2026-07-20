import { scopedClientForTenant } from "@/lib/supabase/scoped";

// Phase 1A defines the flag only; 1B/1C gate the chat route and UI on it.
export function isAssistantEnabled(): boolean {
  return process.env.AI_ASSISTANT_ENABLED === "true";
}

// Phase 2B prod-safety switch: flag off => KB item routes behave exactly as
// today (status 'ready', no Inngest event). Flip on once the ADR-001 D5
// privacy gate is signed.
export function isIngestionEnabled(): boolean {
  return process.env.AI_INGESTION_ENABLED === "true";
}

// Phase 4A prod-safety switch: flag off => buildToolset() excludes every
// scope:"write" tool, so today's read-only toolset is byte-identical. Ships
// dark everywhere but local until Sadin signs off flipping stage (04-PHASE-4 §0.1).
export function isWriteToolsEnabled(): boolean {
  return process.env.AI_WRITE_TOOLS_ENABLED === "true";
}

// ADR-001 Decision 5: the env flags above are the environment-wide kill
// switch; tenants.ai_enabled (migration 174) is the per-tenant grant a
// signed client consent describes. Both must be true — neither alone is
// sufficient. Select just ai_enabled, never the whole tenant row; this runs
// on the hot chat path.
async function tenantAiEnabled(tenantId: string): Promise<boolean> {
  const db = await scopedClientForTenant(tenantId);
  const { data } = await db
    .fromGlobal("tenants")
    .select("ai_enabled")
    .eq("id", tenantId)
    .maybeSingle();
  return (data as { ai_enabled: boolean } | null)?.ai_enabled === true;
}

export async function isAssistantEnabledForTenant(tenantId: string): Promise<boolean> {
  if (!isAssistantEnabled()) return false;
  return tenantAiEnabled(tenantId);
}

export async function isIngestionEnabledForTenant(tenantId: string): Promise<boolean> {
  if (!isIngestionEnabled()) return false;
  return tenantAiEnabled(tenantId);
}
