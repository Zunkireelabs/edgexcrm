import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin, getClientIp } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiValidationError } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { applyLeadPatch } from "@/lib/leads/apply-lead-patch";
import { leadPatchErrorResult, UNDOABLE_LEAD_FIELDS } from "@/lib/ai/tools/universal/lib/lead-patch-result";
import { UNDOABLE_TOOL_IDS } from "@/lib/ai/tools/universal/undo-lead-action";

interface Props {
  params: Promise<{ id: string }>;
}

// Same idempotency-key convention as executeApprovedWrite (approval-gate.ts,
// 5.4c-FIXUP): the UNIQUE (tenant_id, tool_call_id) on ai_write_actions (mig
// 173) IS the race-free ownership check. "undo:" + targetId is stable per
// target, so a double-click always collides on the SAME row instead of
// racing a select-then-insert check.
const UNIQUE_VIOLATION = "23505";

interface WriteActionTargetRow {
  id: string;
  tool_id: string;
  agent_id: string | null;
  run_id: string | null;
  status: string;
  input: unknown;
  result: unknown;
}

interface ClaimedRow {
  status: string;
  result: unknown;
}

/**
 * POST /api/v1/agent-writes/[id]/undo — reverts one executed, agent-driven
 * ai_write_actions row by explicit id (5.4d Part 6). Interactive chat writes
 * already have their own undo path (undo_lead_action tool, targets "my most
 * recent action") — this route is agent_id-scoped by design, not a second
 * implementation of that one.
 *
 * Execution reuses the exact claim-then-execute shape 5.4c-FIXUP established
 * for approved writes: insert a 'claimed' row first (the UNIQUE constraint is
 * the ownership check), execute only after the claim is won, finalize by
 * tool_call_id. At-most-once is deliberate here too — a lost undo is
 * recoverable by clicking again; a duplicate undo could double-revert state
 * that's since changed again.
 */
export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/agent-writes/${id}/undo` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);

  // 1. Target row exists in this tenant.
  const { data: targetRaw } = await db
    .from("ai_write_actions")
    .select("id, tool_id, agent_id, run_id, status, input, result")
    .eq("id", id)
    .maybeSingle();
  const target = targetRaw as unknown as WriteActionTargetRow | null;
  if (!target) return apiNotFound("Write action");

  // 2. Only an executed write can be undone.
  if (target.status !== "executed") {
    return apiValidationError({ status: [`This action is "${target.status}", not executed — nothing to undo.`] });
  }

  // 3. Only a known-undoable tool.
  if (!UNDOABLE_TOOL_IDS.includes(target.tool_id)) {
    return apiValidationError({ toolId: [`Action "${target.tool_id}" cannot be undone.`] });
  }

  // 4. Agent writes only — interactive writes have their own undo path.
  if (!target.agent_id) {
    return apiValidationError({ agentId: ["This write wasn't made by an agent — use the in-chat undo instead."] });
  }

  // 5. There must be a prior-state snapshot to restore.
  const previous = (target.result as { previous?: Record<string, unknown> } | null)?.previous ?? {};
  const patch: Record<string, unknown> = {};
  for (const field of UNDOABLE_LEAD_FIELDS) {
    if (field in previous) patch[field] = previous[field];
  }
  if (Object.keys(patch).length === 0) {
    return apiValidationError({ result: ["No prior state was recorded for this action — cannot undo."] });
  }

  // 6. Must know which lead to restore.
  const leadId = (target.input as { leadId?: string } | null)?.leadId;
  if (!leadId) {
    return apiValidationError({ leadId: ["Could not determine which lead to restore."] });
  }

  const toolCallId = `undo:${id}`;

  const { error: claimError } = await db.from("ai_write_actions").insert({
    user_id: auth.userId,
    agent_id: target.agent_id,
    run_id: target.run_id,
    tool_call_id: toolCallId,
    tool_id: target.tool_id,
    input: { leadId, patch },
    status: "claimed",
    undo_of: id,
  });

  if (claimError) {
    if ((claimError as { code?: string }).code !== UNIQUE_VIOLATION) {
      log.error({ err: claimError }, "ai_write_actions claim insert failed");
      return apiError("DB_ERROR", "Failed to record the undo action", 500);
    }

    const { data: existingRaw } = await db
      .from("ai_write_actions")
      .select("status, result")
      .eq("tool_call_id", toolCallId)
      .maybeSingle();
    const existing = existingRaw as unknown as ClaimedRow | null;

    if (existing?.status === "executed") {
      return apiValidationError({ id: ["This action was already undone."] });
    }
    if (existing?.status !== "failed") {
      // 'claimed' — a prior attempt crashed mid-undo; at-most-once means we
      // never execute again here, same reasoning as executeApprovedWrite.
      return apiValidationError({ id: ["This undo is already in progress and needs human follow-up."] });
    }
    // status === "failed": stale failure from a prior attempt — safe to
    // retry. Fall through to execute + the finalize update below, which
    // repairs this same row (matched by tool_call_id) rather than inserting
    // a second one.
  }

  // Runs as the acting admin's own AuthContext — the undo can never exceed
  // what the person clicking it could do interactively. No buildUserAuthContext
  // needed here (that exists only for the session-less Inngest gate).
  const outcome = await applyLeadPatch(auth, leadId, patch, {
    requestId,
    ip: getClientIp(request),
    userAgent: request.headers.get("user-agent"),
  });

  let finalStatus: "executed" | "failed";
  let result: unknown = null;
  let errorMessage: string | null = null;

  if (outcome.kind !== "ok") {
    // Includes governance refusals (e.g. "First holder cannot revert this
    // lead") — expected behavior, not a bug. Surfaced plainly, not swallowed.
    finalStatus = "failed";
    errorMessage = leadPatchErrorResult(outcome).error;
  } else {
    finalStatus = "executed";
    result = { leadId, restored: patch };
  }

  const { error: finalizeError } = await db
    .from("ai_write_actions")
    .update({ status: finalStatus, result, error: errorMessage })
    .eq("tool_call_id", toolCallId);

  if (finalizeError) {
    log.error({ err: finalizeError }, "ai_write_actions finalize update failed — row left at 'claimed', needs human follow-up");
    return apiError("DB_ERROR", "Failed to finalize the undo action", 500);
  }

  if (finalStatus === "failed") {
    log.warn({ id, leadId, error: errorMessage }, "undo did not apply");
    return apiValidationError({ undo: [errorMessage ?? "Failed to undo this action"] });
  }

  log.info({ id, leadId }, "agent write undone");
  return apiSuccess({ id, leadId, restored: patch });
}
