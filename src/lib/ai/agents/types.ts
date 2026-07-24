import type { IndustryId } from "@/industries/_registry";

/** agent_outputs.kind is free-text (no CHECK constraint) — this union is the app-level source of truth. */
export type AgentOutputKind = "draft_email" | "lead_summary" | "score_suggestion" | "task_suggestion" | "daily_digest";

export interface AgentDefinitionContext {
  tenantId: string;
  industryId: string | null;
}

export type AgentTrigger = { event: string } | { cron: string };

/**
 * A background agent's static definition (doc 03 §3) — one per registry
 * entry, collected from universal defs (this file's registry.ts) and, once
 * an industry pack exists, `src/industries/<id>/ai/agents/*.ts`. The runtime
 * (runtime.ts) turns one of these + an AgentAuthContext + a trigger into an
 * actual run.
 */
export interface AgentDefinition {
  key: string; // registry constant, e.g. 'lead-triage' — matches agent_identities.agent_key
  name: string;
  description: string;
  industries?: IndustryId[]; // undefined = universal
  triggers: AgentTrigger[];
  toolIds: string[]; // registry read-tool ids + draft-tool ids (propose_score, propose_task, ...)
  systemPrompt(ctx: AgentDefinitionContext): string;
  outputKinds: AgentOutputKind[];
  defaultModel?: "agent" | "fast";
  maxSteps?: number; // default 8
}
