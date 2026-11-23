import type { ToolSet } from "ai";
import type { Logger } from "pino";
import type { IndustryId } from "@/industries/_registry";
import type { AgentAuthContext } from "@/lib/ai/agent-auth";
import type { ScopedClient } from "@/lib/supabase/scoped";

/** agent_outputs.kind is free-text (no CHECK constraint) — this union is the app-level source of truth. */
export type AgentOutputKind =
  | "draft_email"
  | "lead_summary"
  | "score_suggestion"
  | "task_suggestion"
  | "daily_digest"
  // EDGEX-109 P4a: Orca's read on a live process version (agent_outputs, keyed by the version id). The process improver's DRAFTS are
  // process_versions rows (source='agent'), not agent_outputs, so they have no kind here.
  | "process_read"
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

/** What a definition's own run-scoped tools are built from (one fresh set per run). */
export interface AgentRunToolsContext {
  agentAuth: AgentAuthContext;
  db: ScopedClient;
  runId: string;
  trigger: { event: string; subjectType: string | null; subjectId: string | null };
  logger: Logger;
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
  /**
   * Run-scoped tools the definition builds itself, merged into the run's toolset next to the registry read tools and the draft tools. For an
   * agent whose tools keep per-run state (the process improver's facts for its evidence guard) and must never reach the interactive
   * assistant, which is why they are not registry tools. They are NOT gated by `toolIds`.
   */
  buildRunTools?(ctx: AgentRunToolsContext): ToolSet;
  systemPrompt(ctx: AgentDefinitionContext): string;
  outputKinds: AgentOutputKind[];
  defaultModel?: "agent" | "fast";
  maxSteps?: number; // default 8
}
