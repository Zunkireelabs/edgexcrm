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

// Outreach AI-drafting Stage 2 prod-safety switch: flag off => the "Draft with
// AI" button stays hidden and auto-AI steps fall back to template-merge at
// fire time (draft-source:'template'), so the cadence never breaks and no
// lead PII reaches a model. Stays off everywhere but stage until ADR-001 D5
// is signed.
export function isOutreachDraftEnabled(): boolean {
  return process.env.AI_OUTREACH_DRAFT_ENABLED === "true";
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

export async function isOutreachDraftEnabledForTenant(tenantId: string): Promise<boolean> {
  if (!isOutreachDraftEnabled()) return false;
  return tenantAiEnabled(tenantId);
}

// Phase 5 prod-safety switch: flag off => emitDomainEvent() no-ops and no
// Inngest agent function runs for any tenant. Stays off everywhere but local
// until the agent runtime (5.1b) ships and Sadin signs off flipping stage.
export function isAgentsEnabled(): boolean {
  return process.env.AI_AGENTS_ENABLED === "true";
}

// Migration 179: mirrors ai_enabled (mig 174) — the per-tenant grant. Agents
// send data to the AI provider, so the base D5 consent gate (tenantAiEnabled)
// still applies on top of this agent-specific switch.
async function tenantAgentsEnabled(tenantId: string): Promise<boolean> {
  const db = await scopedClientForTenant(tenantId);
  const { data } = await db
    .fromGlobal("tenants")
    .select("ai_agents_enabled")
    .eq("id", tenantId)
    .maybeSingle();
  return (data as { ai_agents_enabled: boolean } | null)?.ai_agents_enabled === true;
}

// Three-way layered gate — ALL must be true: the env kill switch, the base
// AI consent gate (tenants.ai_enabled), and the agent-specific per-tenant
// grant (tenants.ai_agents_enabled). Any one alone is insufficient.
export async function isAgentsEnabledForTenant(tenantId: string): Promise<boolean> {
  if (!isAgentsEnabled()) return false;
  if (!(await tenantAiEnabled(tenantId))) return false;
  return tenantAgentsEnabled(tenantId);
}
