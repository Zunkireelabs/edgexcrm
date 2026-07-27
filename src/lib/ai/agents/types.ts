import type { IndustryId } from "@/industries/_registry";

/** agent_outputs.kind is free-text (no CHECK constraint) — this union is the app-level source of truth. */
export type AgentOutputKind =
  | "draft_email"
  | "lead_summary"
  | "score_suggestion"
  | "task_suggestion"
  | "daily_digest"
  // Emitted by the RUNTIME rather than by a draft tool: write-executor.ts
  // converts every scope:"write" tool call into one of these instead of
  // executing it (5.4a). A definition that declares a write tool may therefore
  // list this in outputKinds so its capability card says so — mcp-client (5.5)
  // and lead-triage (6.1) both do. outputKinds is display metadata only
  // (capabilities.ts's "Produces" line); it filters no query and gates nothing,
  // so declaring or omitting it never changes what the runtime emits.
  | "write_action_proposal";

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
