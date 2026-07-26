import { tool, type ToolSet } from "ai";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AgentTool } from "@/lib/ai/tools/types";
import { logger } from "@/lib/logger";
import { resolveAutomationLevel, type AutomationLevel } from "./policy";

// 04-PHASE-4-AUTONOMY-AND-WRITES.md §2: "rate cap per run (e.g. <=10 writes)".
export const MAX_WRITE_ATTEMPTS_PER_RUN = 10;

/**
 * (run_id, tool_call_id) is the idempotency key for an agent-issued write —
 * an Inngest retry replays the whole step, including the tool call, and must
 * never draft (or, once 5.4b/5.4c land, execute) the same call twice.
 */
export function deriveWriteIdempotencyKey(runId: string, toolCallId: string): string {
  return `${runId}:${toolCallId}`;
}

export interface RowFilter {
  column: string;
  value: unknown;
}

/**
 * `scopedClient.update()`/`.delete()` only ever auto-injects `tenant_id` —
 * the caller MUST supply at least one more filter (e.g. `.eq("id", leadId)`)
 * or the write targets every row in the tenant (the footgun scoped.ts's
 * docstring warns about, characterized in scoped.test.ts during 5.Gb). A
 * write tool with zero caller-supplied filters must be refused before it
 * ever reaches the database.
 */
export function assertMandatoryRowFilter(filters: RowFilter[]): void {
  if (filters.length === 0) {
    throw new Error("Write tool call is missing a mandatory row-level filter beyond tenant_id — refusing to run.");
  }
}

/**
 * Confirms a write's filter set resolves to exactly one row before any
 * mutation runs — no bulk writes by agents in this phase (04-PHASE-4 §2).
 */
export function assertSingleRowEffect(matchedRowCount: number): void {
  if (matchedRowCount !== 1) {
    throw new Error(
      `Write tool call would affect ${matchedRowCount} row(s) — exactly 1 is required for an agent-issued write.`,
    );
  }
}

/** True once a run has already made MAX_WRITE_ATTEMPTS_PER_RUN write attempts — the next (11th) call is refused. */
export function isWriteRateCapExceeded(attemptsSoFarThisRun: number): boolean {
  return attemptsSoFarThisRun >= MAX_WRITE_ATTEMPTS_PER_RUN;
}

export interface PolicyEnforcedWriteToolsParams {
  db: ScopedClient;
  tenantId: string;
  agentId: string;
  runId: string;
  subjectType: string | null;
  subjectId: string | null;
}

/**
 * Wraps every scope:"write" registry tool an agent definition declares so
 * that calling it never executes a live write in this slice (5.4a) —
 * regardless of the resolved automation level, the call is converted into an
 * `agent_outputs` draft describing the intended action, for a human to
 * review. This is deliberate for ALL THREE levels right now:
 *   - human_led        -> draft (matches today's behavior exactly)
 *   - agent_human       -> TODO(5.4b): execute + notify + undo. Drafts for now.
 *   - fully_automated   -> TODO(5.4c): execute, audit only. Drafts for now.
 *
 * Idempotent on (run_id, tool_call_id) so an Inngest retry can never
 * double-draft, and capped at MAX_WRITE_ATTEMPTS_PER_RUN drafts per run.
 *
 * NOT wired here (no live write target exists yet to check them against):
 * assertMandatoryRowFilter / assertSingleRowEffect. They're built and unit
 * tested now so 5.4b/5.4c's real executor can import them directly once a
 * write tool actually reaches a table.
 */
export function buildPolicyEnforcedWriteTools(writeTools: AgentTool[], params: PolicyEnforcedWriteToolsParams): ToolSet {
  const { db, tenantId, agentId, runId, subjectType, subjectId } = params;
  const toolset: ToolSet = {};
  let attemptsThisRun = 0;

  for (const agentTool of writeTools) {
    toolset[agentTool.id] = tool({
      description: agentTool.description,
      inputSchema: agentTool.inputSchema,
      execute: async (input: unknown, options: { toolCallId: string }) => {
        const toolCallId = options.toolCallId;
        const idempotencyKey = deriveWriteIdempotencyKey(runId, toolCallId);
        const log = logger.child({ tool: agentTool.id, runId, agentId, tenantId });

        const { data: existing } = await db
          .from("agent_outputs")
          .select("id")
          .eq("run_id", runId)
          .contains("payload", { idempotency_key: idempotencyKey })
          .maybeSingle();
        if (existing) {
          log.info({ toolCallId }, "agent write attempt idempotent replay — already queued");
          return { queued: true, message: "This action was already queued for human review." };
        }

        if (isWriteRateCapExceeded(attemptsThisRun)) {
          log.warn({ toolCallId, attemptsThisRun }, "agent write attempt rate-capped for this run");
          return { error: "This run has reached its write-attempt limit and cannot queue any more actions." };
        }
        attemptsThisRun++;

        const level: AutomationLevel = await resolveAutomationLevel({ db, tenantId, agentId, toolId: agentTool.id });

        const { error } = await db.from("agent_outputs").insert({
          run_id: runId,
          agent_id: agentId,
          kind: "write_action_proposal",
          subject_type: subjectType,
          subject_id: subjectId,
          payload: { tool_id: agentTool.id, input, idempotency_key: idempotencyKey, automation_level: level },
          status: "proposed",
        });
        if (error) throw new Error(`Failed to record write-action proposal: ${error.message}`);

        log.info({ toolCallId, level }, "agent write attempt converted to draft");
        return {
          queued: true,
          message:
            `The "${agentTool.id}" action was not executed — it requires human review under this tenant's ` +
            "current automation settings and has been queued for your review queue.",
        };
      },
    });
  }

  return toolset;
}
