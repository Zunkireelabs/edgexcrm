import { tool, type ToolSet } from "ai";
import type { Logger } from "pino";
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

export interface ProposeAgentWriteParams {
  db: ScopedClient;
  tenantId: string;
  agentId: string;
  runId: string;
  toolId: string;
  input: unknown;
  toolCallId: string;
  subjectType: string | null;
  subjectId: string | null;
  /** Write attempts already drafted earlier in this same run — 0 for MCP (D5: one agent_runs row per tools/call, so this never accumulates there). */
  attemptsSoFar: number;
  /** AgentTool.agentSuppressedInputFields for this tool — stripped from `input` before it's persisted. */
  agentSuppressedInputFields?: string[];
}

/**
 * Removes agent-suppressed fields (e.g. create_task's assigneeId — see
 * BRIEF-6-4-AGENT-SUPPRESSED-INPUT-FIELDS.md) from a write proposal's input
 * before it's persisted. A prompt-only fix ("never pass assigneeId") made
 * the model invent one MORE often, not less — negated instructions raise a
 * field's salience instead of suppressing it. Structural removal is the only
 * thing that can't be talked past. Returns `input` unchanged (same
 * reference) when there's nothing to strip, so an undeclared tool's payload
 * is byte-identical to what it received.
 */
function stripAgentSuppressedFields(
  input: unknown,
  fields: string[] | undefined,
  log: Logger,
  toolCallId: string,
): unknown {
  if (!fields || fields.length === 0) return input;
  if (typeof input !== "object" || input === null) return input;

  const record = input as Record<string, unknown>;
  let sanitized: Record<string, unknown> | null = null;
  for (const field of fields) {
    if (field in record) {
      sanitized ??= { ...record };
      delete sanitized[field];
      log.info({ toolCallId, field }, "stripped agent-suppressed input field before persisting write proposal");
    }
  }
  return sanitized ?? input;
}

export type ProposeAgentWriteResult =
  | {
      queued: true;
      message: string;
      /** Whether this call actually inserted a fresh proposal row (false on an idempotent replay). Callers use this to decide whether to bump their own attempt counter / send a downstream event — never sent to the model/MCP client as anything but part of a { queued, message } shape they already expect. */
      proposed: boolean;
    }
  | { error: string };

/**
 * The propose-core every write path shares (BRIEF-PHASE-5-5-MCP-SERVER.md §4
 * Part 3): converts one write-tool call into an `agent_outputs`
 * write_action_proposal draft, regardless of the resolved automation level —
 * extracted verbatim from buildPolicyEnforcedWriteTools's execute() closure
 * (5.4a) so the MCP route (5.5) calls the exact same core instead of a
 * second implementation. Idempotent on (run_id, tool_call_id): a replay
 * returns `proposed:false` and drafts nothing new. Rate-capped at
 * MAX_WRITE_ATTEMPTS_PER_RUN per run via the caller-supplied `attemptsSoFar`
 * (the caller owns the counter — see buildPolicyEnforcedWriteTools below for
 * the background-agent closure that accumulates it across a run's tool loop).
 */
export async function proposeAgentWrite(params: ProposeAgentWriteParams): Promise<ProposeAgentWriteResult> {
  const { db, tenantId, agentId, runId, toolId, input, toolCallId, subjectType, subjectId, attemptsSoFar, agentSuppressedInputFields } =
    params;
  const idempotencyKey = deriveWriteIdempotencyKey(runId, toolCallId);
  const log = logger.child({ tool: toolId, runId, agentId, tenantId });

  const { data: existing } = await db
    .from("agent_outputs")
    .select("id")
    .eq("run_id", runId)
    .contains("payload", { idempotency_key: idempotencyKey })
    .maybeSingle();
  if (existing) {
    log.info({ toolCallId }, "agent write attempt idempotent replay — already queued");
    return { queued: true, proposed: false, message: "This action was already queued for human review." };
  }

  if (isWriteRateCapExceeded(attemptsSoFar)) {
    log.warn({ toolCallId, attemptsSoFar }, "agent write attempt rate-capped for this run");
    return { error: "This run has reached its write-attempt limit and cannot queue any more actions." };
  }

  const level: AutomationLevel = await resolveAutomationLevel({ db, tenantId, agentId, toolId });
  const sanitizedInput = stripAgentSuppressedFields(input, agentSuppressedInputFields, log, toolCallId);

  const { error } = await db.from("agent_outputs").insert({
    run_id: runId,
    agent_id: agentId,
    kind: "write_action_proposal",
    subject_type: subjectType,
    subject_id: subjectId,
    payload: { tool_id: toolId, input: sanitizedInput, idempotency_key: idempotencyKey, automation_level: level },
    status: "proposed",
  });
  if (error) throw new Error(`Failed to record write-action proposal: ${error.message}`);

  log.info({ toolCallId, level }, "agent write attempt converted to draft");
  return {
    queued: true,
    proposed: true,
    message:
      `The "${toolId}" action was not executed — it requires human review under this tenant's ` +
      "current automation settings and has been queued for your review queue.",
  };
}

/**
 * Wraps every scope:"write" registry tool an agent definition declares so
 * that calling it never executes a live write in this slice — regardless of
 * the resolved automation level, the call is converted into an
 * `agent_outputs` draft describing the intended action, for a human to
 * review. This is deliberate for ALL THREE levels right now:
 *   - human_led        -> draft (matches today's behavior exactly)
 *   - agent_human       -> executes only via the approval gate (approval-gate.ts)
 *   - fully_automated   -> TODO: execute, audit only. Drafts for now.
 *
 * A thin AI-SDK wrapper around proposeAgentWrite (5.5 Part 3 extraction) —
 * this closure's only remaining job is tracking attemptsThisRun across the
 * run's whole tool loop (proposeAgentWrite itself is stateless per call).
 * The AI SDK can invoke several execute() calls concurrently within one
 * step, so the slot is reserved synchronously (before the `await`) and
 * released only if the call turned out not to draft anything new — an
 * idempotent replay, a rate-capped attempt, or an error. Reserving after
 * the await would let concurrent calls all read the same stale
 * attemptsThisRun and overshoot MAX_WRITE_ATTEMPTS_PER_RUN.
 *
 * NOT wired here (no live write target exists yet to check them against):
 * assertMandatoryRowFilter / assertSingleRowEffect. They're built and unit
 * tested now so a real executor can import them directly once a write tool
 * actually reaches a table (see approval-gate.ts's APPROVAL_EXECUTORS).
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
        attemptsThisRun++; // reserve BEFORE any await — see docstring above
        const result = await proposeAgentWrite({
          db,
          tenantId,
          agentId,
          runId,
          toolId: agentTool.id,
          input,
          toolCallId: options.toolCallId,
          subjectType,
          subjectId,
          attemptsSoFar: attemptsThisRun - 1,
          agentSuppressedInputFields: agentTool.agentSuppressedInputFields,
        });
        if (!("proposed" in result) || !result.proposed) attemptsThisRun--; // release on replay / cap / error
        // `proposed` is internal bookkeeping for this wrapper — never send it to the model.
        if ("proposed" in result) return { queued: result.queued, message: result.message };
        return result;
      },
    });
  }

  return toolset;
}
