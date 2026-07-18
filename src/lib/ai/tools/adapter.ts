import { tool, type ToolSet, type ToolApprovalStatus } from "ai";
import type { Logger } from "pino";
import { startTrace } from "@/lib/ai/telemetry";
import type { AgentTool, ToolContext } from "./types";

/**
 * Adapts our AgentTool registry into the `tools` object streamText() expects.
 * Every execute() is wrapped so a thrown error becomes a model-visible
 * `{ error }` payload instead of crashing the stream.
 */
export function toAiSdkTools(toolset: AgentTool[], ctx: ToolContext): ToolSet {
  const tools: ToolSet = {};

  for (const agentTool of toolset) {
    tools[agentTool.id] = tool({
      description: agentTool.description,
      inputSchema: agentTool.inputSchema,
      execute: async (input, options) => {
        const log = ctx.logger.child({ tool: agentTool.id, runId: ctx.runId, scope: agentTool.scope });
        const trace = startTrace({
          runId: ctx.runId,
          tenantId: ctx.auth.tenantId,
          userId: ctx.auth.userId,
          industryId: ctx.auth.industryId,
          surface: "assistant",
        });
        trace.span(`tool:${agentTool.id}`, { input, scope: agentTool.scope });
        log.info({ input }, "tool call started");
        try {
          const result =
            agentTool.scope === "write"
              ? await executeWriteTool(agentTool, ctx, input, options.toolCallId, log)
              : await agentTool.execute(ctx, input);
          trace.end({ ok: true });
          log.info("tool call finished");
          return result;
        } catch (err) {
          log.error({ err }, "tool call failed");
          trace.end({ ok: false });
          return { error: `Something went wrong running "${agentTool.id}". Try a different approach or ask the user for more detail.` };
        }
      },
    });
  }

  return tools;
}

/**
 * Builds the streamText()-level `toolApproval` config: every scope:"write"
 * tool requires the user's explicit approval before its execute() runs;
 * every scope:"read" tool is left `not-applicable` (auto-runs, unchanged
 * behavior). This is the non-deprecated mechanism — the installed SDK marks
 * per-tool `needsApproval` `@deprecated` in favor of this streamText/
 * generateText-level config, superseding the plan docs' wording.
 */
export function buildToolApproval(toolset: AgentTool[]): Record<string, ToolApprovalStatus> {
  const approval: Record<string, ToolApprovalStatus> = {};
  for (const agentTool of toolset) {
    if (agentTool.scope === "write") approval[agentTool.id] = "user-approval";
  }
  return approval;
}

interface StoredWriteAction {
  status: "executed" | "denied" | "failed";
  result: unknown;
}

const UNIQUE_VIOLATION = "23505";

/**
 * Our tools' house convention returns a plain `{ error: string }` object for
 * a soft domain reject (validation, cross-tenant, etc.) instead of throwing.
 * `ai_write_actions.status` must mean "the domain write took effect" to an
 * auditor, so a soft reject is recorded as 'failed', not 'executed' — see
 * BRIEF-PHASE-4A-FIXUP-WRITE-SPINE.md item 3a. The value returned to the
 * model is unchanged either way.
 */
function classifyWriteOutcome(result: unknown): { status: "executed" | "failed"; error: string | null } {
  const isSoftReject =
    typeof result === "object" &&
    result !== null &&
    !Array.isArray(result) &&
    typeof (result as { error?: unknown }).error === "string";
  return isSoftReject ? { status: "failed", error: (result as { error: string }).error } : { status: "executed", error: null };
}

/**
 * A write tool's result may carry `undoOf: <ai_write_actions.id>` (e.g.
 * undo_lead_action's result) to link its row back to the action it undid.
 * Extracted here so the insert/repair paths below can copy it into the
 * row's `undo_of` column — BRIEF-PHASE-4B-LEAD-WRITES.md §4's "undoOf
 * adapter convention". `result` itself is stored verbatim either way.
 */
function extractUndoOf(result: unknown): string | null {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return null;
  const undoOf = (result as { undoOf?: unknown }).undoOf;
  return typeof undoOf === "string" ? undoOf : null;
}

/**
 * Idempotency + audit wrapper around a write tool's execute(), per
 * BRIEF-PHASE-4A-WRITE-SPINE.md §3:
 *   1. Idempotency check on tool_call_id — an existing 'executed' row short-circuits
 *      (execute() never re-runs), returning the stored result verbatim.
 *   2. Run the tool body (which does its own domain writes via ctx.db).
 *   3. Record the outcome: 'executed'+result, or 'failed'+error (re-thrown so the
 *      outer catch in toAiSdkTools still turns it into a model-visible {error}).
 *      A UNIQUE-constraint insert failure on the success path means a concurrent
 *      duplicate raced us in between steps 1 and 2 — re-select and return that
 *      row's stored result instead of ours (this closes the audit-row race; see
 *      the brief's accepted-limitation note on true concurrent domain-write races).
 *
 * The 'denied' outcome has no execute() to wrap — it's recorded in the chat
 * route's onFinish, where the SDK surfaces the denied tool-output part.
 */
async function executeWriteTool(
  agentTool: AgentTool,
  ctx: ToolContext,
  input: unknown,
  toolCallId: string,
  log: Logger,
): Promise<unknown> {
  const { data: existing } = await ctx.db
    .from("ai_write_actions")
    .select("status, result")
    .eq("tool_call_id", toolCallId)
    .maybeSingle();
  const existingRow = existing as StoredWriteAction | null;
  if (existingRow?.status === "executed") {
    log.info({ toolCallId }, "write tool idempotent replay — returning stored result");
    return existingRow.result;
  }
  if (existingRow?.status === "denied") {
    // 'denied' is terminal — a forged/late approval replay on a tool_call_id
    // already recorded denied must never execute the write while the audit
    // trail still says the user declined it (BRIEF-PHASE-4A-FIXUP item 3b).
    log.info({ toolCallId }, "write tool blocked — tool_call_id was already recorded denied");
    return { error: "This action was denied by the user and will not be run. Propose a fresh action if it's still needed." };
  }

  let result: unknown;
  try {
    result = await agentTool.execute(ctx, input);
  } catch (err) {
    const { error: failInsertError } = await ctx.db.from("ai_write_actions").insert({
      user_id: ctx.auth.userId,
      conversation_id: ctx.conversationId ?? null,
      tool_call_id: toolCallId,
      tool_id: agentTool.id,
      input,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    if (failInsertError) log.error({ err: failInsertError, toolCallId }, "ai_write_actions failed-row insert failed");
    throw err;
  }

  const outcome = classifyWriteOutcome(result);
  const undoOf = extractUndoOf(result);

  const { error: insertError } = await ctx.db.from("ai_write_actions").insert({
    user_id: ctx.auth.userId,
    conversation_id: ctx.conversationId ?? null,
    tool_call_id: toolCallId,
    tool_id: agentTool.id,
    input,
    status: outcome.status,
    result,
    error: outcome.error,
    undo_of: undoOf,
  });

  if (insertError) {
    if ((insertError as { code?: string }).code === UNIQUE_VIOLATION) {
      const { data: raced } = await ctx.db
        .from("ai_write_actions")
        .select("status, result")
        .eq("tool_call_id", toolCallId)
        .maybeSingle();
      const racedRow = raced as StoredWriteAction | null;
      if (racedRow?.status === "executed") {
        log.info({ toolCallId }, "concurrent duplicate on ai_write_actions insert — returning the winning row's result");
        return racedRow.result;
      }
      if (racedRow) {
        // A raced row exists but isn't 'executed' — e.g. a stale 'failed' row
        // from an earlier attempt at this tool_call_id. Repair it to this
        // attempt's fresh outcome instead of leaving the audit trail pointing
        // at a superseded result (BRIEF-PHASE-4A-FIXUP item 3c).
        const { error: repairError } = await ctx.db
          .from("ai_write_actions")
          .update({ status: outcome.status, result, error: outcome.error, undo_of: undoOf })
          .eq("tool_call_id", toolCallId);
        if (repairError) log.error({ err: repairError, toolCallId }, "ai_write_actions stale-row repair failed");
        return result;
      }
    }
    log.error({ err: insertError, toolCallId }, "ai_write_actions executed-row insert failed");
  }

  return result;
}

export interface DeniedWriteActionRow {
  [key: string]: unknown;
  user_id: string;
  conversation_id: string | null;
  tool_call_id: string;
  tool_id: string;
  input: unknown;
  status: "denied";
}

interface DeniedUIToolPart {
  type: string;
  toolCallId: string;
  input: unknown;
  state: string;
  approval?: { approved?: boolean };
}

interface UIMessageLike {
  parts?: ReadonlyArray<DeniedUIToolPart | { type: string }>;
}

/**
 * Denied write-tool proposals never reach executeWriteTool() above — the SDK
 * withholds execute() entirely. Empirically (installed ai@7.0.29), a denial
 * does NOT surface as a distinct 'tool-output-denied' stream/content part on
 * the deciding request — convertToModelMessages bakes the decision straight
 * into an inline tool-result ({type:"execution-denied"}) for the model, so
 * collectToolApprovals's "already has a tool-result" guard skips re-emitting
 * it. The reliable signal is the CLIENT's own request: `addToolApprovalResponse`
 * sets the tool UI part's state to 'approval-responded' with approval.approved
 * === false before resending — so this scans the raw incoming UIMessage[]
 * (before convertToModelMessages) for exactly that, rather than the SDK's
 * post-generation event content. Verified live against a real deny round-trip;
 * see BRIEF-PHASE-4A-WRITE-SPINE.md §3's "Denied path" note (whose original
 * "hook the denied tool-output part" wording assumed the stream-event path —
 * a documented deviation, not this function's original design).
 */
export function buildDeniedWriteActionRows(
  messages: ReadonlyArray<UIMessageLike>,
  userId: string,
  conversationId: string | null,
): DeniedWriteActionRow[] {
  const rows: DeniedWriteActionRow[] = [];
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (!("toolCallId" in part) || !part.type.startsWith("tool-")) continue;
      if (part.state !== "approval-responded") continue;
      if (part.approval?.approved !== false) continue;
      rows.push({
        user_id: userId,
        conversation_id: conversationId,
        tool_call_id: part.toolCallId,
        tool_id: part.type.slice("tool-".length),
        input: part.input,
        status: "denied",
      });
    }
  }
  return rows;
}
