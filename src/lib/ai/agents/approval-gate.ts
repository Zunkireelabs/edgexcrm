import type { ScopedClient } from "@/lib/supabase/scoped";
import { logger } from "@/lib/logger";
import {
  APPROVAL_DECIDED_EVENT,
  loadAgentHumanWriteProposals,
  createApprovalRequest,
  expireApproval,
  loadAgentRunContext,
} from "./approval-flow";
import { createTaskCore, type CreateTaskInput } from "@/lib/tasks/create-task";
import { mapCreateTaskToolInput } from "@/lib/ai/tools/universal/create-task";
import { applyLeadPatch } from "@/lib/leads/apply-lead-patch";
import { resolveUpdateLeadStageTarget } from "@/lib/ai/tools/universal/update-lead-stage";
import { leadPatchErrorResult, undoableLeadPrevious } from "@/lib/ai/tools/universal/lib/lead-patch-result";
import { buildUserAuthContext } from "@/lib/api/auth";
import { assertMandatoryRowFilter, assertSingleRowEffect } from "./write-executor";

export const APPROVAL_WAIT_TIMEOUT = "48h";

// Same convention as adapter.ts's write path (Phase 4A/4C): a duplicate
// insert on ai_write_actions' UNIQUE (tenant_id, tool_call_id) means a
// racing/replayed execution already recorded this exact approval — treat it
// as "already handled", not an error.
const UNIQUE_VIOLATION = "23505";

interface ApprovalExecutorParams {
  db: ScopedClient;
  tenantId: string;
  /** The approving human — createTaskCore's actor.defaultAssigneeId (see create-task.ts docstring). */
  defaultAssigneeId: string;
  input: unknown;
}

type ApprovalExecutorResult = { result: Record<string, unknown> } | { error: string };

/**
 * Per-tool executors for the "approved" branch below. Deliberately a small
 * explicit map, not a lookup into the AgentTool registry — an approved write
 * must call the exact same core the interactive path uses (createTaskCore /
 * applyLeadPatch), never the AgentTool.execute() wrapper, which asserts a
 * real user session (assertUserAuth) that doesn't exist here.
 *
 * Scope for 5.4c: create_task only. Phase 5.4c-2a added update_lead_stage —
 * the first agent-driven UPDATE to customer data (create_task is an INSERT).
 * Phase 5.4c-2b added assign_lead — same shape as update_lead_stage minus the
 * stage-name resolution step, since assign_lead's input already carries a
 * resolved assigneeId (team_lookup resolves it client-side, at draft time).
 * Unlike create_task's minimal actor shape, applyLeadPatch is auth-dependent
 * throughout (industry rules, list access, branch/chain governance) — there
 * is no reduced "core" to extract safely. Instead this builds the approving
 * human's REAL AuthContext (buildUserAuthContext) and executes as them: the
 * write can never exceed what its approver could do interactively, and
 * there's exactly one permission implementation (auth.ts) to keep in sync
 * with, never a parallel one.
 */
// Exported (read-only shape) so 5.5's MCP tool-exposure test can assert
// D9's hard rule: a write tool is only ever exposed over MCP if it has an
// entry here — otherwise an agent_human approval could resolve to "no
// approval executor registered" for a caller who already clicked Approve.
export const APPROVAL_EXECUTORS: Record<string, (params: ApprovalExecutorParams) => Promise<ApprovalExecutorResult>> = {
  create_task: async ({ db, tenantId, defaultAssigneeId, input }) => {
    const coreInput: CreateTaskInput = mapCreateTaskToolInput(input as Parameters<typeof mapCreateTaskToolInput>[0]);
    const outcome = await createTaskCore(db, { tenantId, defaultAssigneeId }, coreInput);
    if (outcome.kind === "ok") return { result: outcome.task };
    if (outcome.kind === "validation") return { error: `Validation failed: ${JSON.stringify(outcome.errors)}` };
    return { error: "Database error while creating the task" };
  },

  update_lead_stage: async ({ db, tenantId, defaultAssigneeId, input }) => {
    const raw = (input ?? {}) as { leadId?: unknown; stageName?: unknown; stageId?: unknown };
    const leadId = typeof raw.leadId === "string" && raw.leadId.length > 0 ? raw.leadId : null;

    // Double gate, part 1: the leadId reaching here came from the model —
    // a model can hallucinate a UUID — so a stage update with no row
    // identifier at all must never reach the database. This only proves a
    // filter is PRESENT; whether it resolves to a real, accessible row is
    // proven below by applyLeadPatch's own tenant-scoped fetch + access check.
    try {
      assertMandatoryRowFilter(leadId ? [{ column: "id", value: leadId }] : []);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Missing required row filter" };
    }

    // Double gate, part 2: execute as the approver's real AuthContext so
    // applyLeadPatch's requireLeadAccess / list-access / industry checks run
    // for real, under the exact permissions of the human who approved this.
    const auth = await buildUserAuthContext(defaultAssigneeId, tenantId);
    if (!auth) {
      return { error: "Could not resolve the approving user's permissions for this tenant." };
    }

    const resolved = await resolveUpdateLeadStageTarget(db, auth, {
      stageName: typeof raw.stageName === "string" ? raw.stageName : undefined,
      stageId: typeof raw.stageId === "string" ? raw.stageId : undefined,
    });
    if ("error" in resolved) return { error: resolved.error };

    const outcome = await applyLeadPatch(
      auth,
      leadId as string,
      { list_id: resolved.matched.id },
      { requestId: crypto.randomUUID(), ip: null, userAgent: null },
    );

    if (outcome.kind !== "ok") return leadPatchErrorResult(outcome);

    // applyLeadPatch exposes no affected-row count — its update() is itself
    // PK-scoped (.eq("id", leadId)) and calls .single(), which already fails
    // the whole outcome if it matched anything other than exactly one row.
    // Verified here via the returned row's identity instead, per the
    // 5.4c-2a brief's noted limitation (no real count to check against).
    try {
      assertSingleRowEffect(outcome.lead.id === leadId ? 1 : 0);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Write affected an unexpected number of rows" };
    }

    // Previous list/stage value captured into the result (-> ai_write_actions.result
    // below) so undo_lead_action (Phase 4B/5.4d) has something to restore from.
    return {
      result: {
        leadId,
        stage: resolved.matched.name,
        previous: undoableLeadPrevious(outcome.previousValues),
      },
    };
  },

  assign_lead: async ({ tenantId, defaultAssigneeId, input }) => {
    const raw = (input ?? {}) as { leadId?: unknown; assigneeId?: unknown };
    const leadId = typeof raw.leadId === "string" && raw.leadId.length > 0 ? raw.leadId : null;

    // Double gate, part 1 (see update_lead_stage above for the rationale):
    // refuse a hallucinated/missing leadId before any DB call.
    try {
      assertMandatoryRowFilter(leadId ? [{ column: "id", value: leadId }] : []);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Missing required row filter" };
    }

    // Double gate, part 2: execute as the approver's real AuthContext. Every
    // assignment rule (ADMIN_ONLY_FIELDS + canAssignLeads, tenant-membership
    // of the assignee, requireLeadAccess, the self-check-in and cross-branch
    // pooled bypasses) already lives inside applyLeadPatch — this executor
    // does not re-check any of it.
    const auth = await buildUserAuthContext(defaultAssigneeId, tenantId);
    if (!auth) {
      return { error: "Could not resolve the approving user's permissions for this tenant." };
    }

    const assigneeId = typeof raw.assigneeId === "string" && raw.assigneeId.length > 0 ? raw.assigneeId : null;

    const outcome = await applyLeadPatch(
      auth,
      leadId as string,
      { assigned_to: assigneeId },
      { requestId: crypto.randomUUID(), ip: null, userAgent: null },
    );

    if (outcome.kind !== "ok") return leadPatchErrorResult(outcome);

    // Same honest substitute as update_lead_stage — applyLeadPatch exposes no
    // affected-row count; its update() is itself PK-scoped + .single().
    try {
      assertSingleRowEffect(outcome.lead.id === leadId ? 1 : 0);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Write affected an unexpected number of rows" };
    }

    return {
      result: {
        leadId,
        assignedTo: assigneeId,
        previous: undoableLeadPrevious(outcome.previousValues),
      },
    };
  },
};

interface StoredWriteAction {
  status: string;
  result: unknown;
}

/**
 * Executes one approved write-action proposal and records it on
 * ai_write_actions, keyed by the approval's own id as tool_call_id (mig 188
 * adds agent_id/run_id provenance columns; user_id is the approving human,
 * per this slice's brief — the schema's NOT NULL user_id has no agent actor
 * to point to instead).
 *
 * Claim-then-execute (5.4c-FIXUP, mig 189 adds the 'claimed' status): for
 * customer-data writes a lost write is strictly recoverable (a human can
 * re-approve) but a duplicate write is not (nobody can un-send it), so this
 * is deliberately at-most-once rather than at-least-once —
 *   1. Claim: insert a 'claimed' row first. UNIQUE (tenant_id, tool_call_id)
 *      (mig 173) makes this insert itself the race-free ownership check.
 *   2. On a 23505 collision, read the existing row back: 'executed' -> this
 *      approval already ran, return without re-executing; 'claimed' -> a
 *      prior attempt crashed between claiming and finalizing — do NOT
 *      execute again (that risks the exact duplicate this design avoids);
 *      instead surface it loudly for human follow-up; 'failed' -> a prior
 *      attempt's stale failure, safe to retry — fall through and repair it.
 *   3. Execute only after the claim is won (fresh claim or a 'failed' repair).
 *   4. Finalize: update the claimed row to 'executed'+result or 'failed'+error.
 * A row stuck at 'claimed' is the visible symptom of a crash mid-write —
 * that's intentional; it surfaces instead of silently duplicating.
 */
async function executeApprovedWrite(params: {
  db: ScopedClient;
  runId: string;
  approvalId: string;
  toolId: string;
  toolInput: unknown;
}): Promise<void> {
  const { db, runId, approvalId, toolId, toolInput } = params;
  const log = logger.child({ runId, approvalId, toolId });

  const { data: approvalRow } = await db.from("agent_approvals").select("decided_by").eq("id", approvalId).maybeSingle();
  const decidedBy = (approvalRow as { decided_by: string | null } | null)?.decided_by ?? null;
  if (!decidedBy) {
    log.error("approved agent_approvals row has no decided_by — cannot attribute the write to a human actor, refusing to execute");
    return;
  }

  const runContext = await loadAgentRunContext(db, runId);
  if (!runContext) {
    log.error("could not resolve agent_runs row for this run — refusing to execute");
    return;
  }

  const { error: claimError } = await db.from("ai_write_actions").insert({
    user_id: decidedBy,
    agent_id: runContext.agentId,
    run_id: runId,
    tool_call_id: approvalId,
    tool_id: toolId,
    input: toolInput,
    status: "claimed",
  });

  if (claimError) {
    if ((claimError as { code?: string }).code !== UNIQUE_VIOLATION) {
      log.error({ err: claimError }, "ai_write_actions claim insert failed");
      return;
    }

    const { data: existing } = await db
      .from("ai_write_actions")
      .select("status, result")
      .eq("tool_call_id", approvalId)
      .maybeSingle();
    const existingRow = existing as StoredWriteAction | null;

    if (existingRow?.status === "executed") {
      log.info("agent write idempotent replay — already executed, skipping");
      return;
    }
    if (existingRow?.status !== "failed") {
      // 'claimed' (a prior attempt crashed mid-write, result unknown) or any
      // other unexpected state — at-most-once means we never execute again
      // here; a lost write can be re-approved, a duplicate can't be undone.
      log.error(
        { existingStatus: existingRow?.status ?? null },
        "ai_write_actions row already claimed and not yet finalized — refusing to execute again, needs human follow-up",
      );
      return;
    }
    // status === "failed": a prior attempt's stale failure — safe to retry.
    // Fall through and repair it via the finalize update below.
  }

  const executor = APPROVAL_EXECUTORS[toolId];
  let status: "executed" | "failed";
  let result: unknown = null;
  let error: string | null = null;

  if (!executor) {
    status = "failed";
    error = `No approval executor registered for tool "${toolId}"`;
  } else {
    const outcome = await executor({ db, tenantId: runContext.tenantId, defaultAssigneeId: decidedBy, input: toolInput });
    if ("error" in outcome) {
      status = "failed";
      error = outcome.error;
    } else {
      status = "executed";
      result = outcome.result;
    }
  }

  const { error: finalizeError } = await db.from("ai_write_actions").update({ status, result, error }).eq("tool_call_id", approvalId);

  if (finalizeError) {
    log.error({ err: finalizeError }, "ai_write_actions finalize update failed — row left at 'claimed', needs human follow-up");
    return;
  }

  if (status === "executed") log.info("agent write executed on approval");
  else log.error({ error }, "agent write execution failed");
}

/**
 * The subset of Inngest's `step` tooling this gate needs. Kept as a narrow
 * structural interface (rather than importing Inngest's own step type)
 * purely so this logic can run under a fake `step` in tests, without an
 * Inngest test harness — the real `step` object Inngest's handler passes in
 * satisfies this shape directly.
 */
export interface ApprovalGateStep {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<T>;
  waitForEvent(
    id: string,
    opts: { event: string; if: string; timeout: string },
  ): Promise<{ data: { approvalId: string; decision: string } } | null>;
}

export interface RunWriteApprovalGateParams {
  step: ApprovalGateStep;
  db: ScopedClient;
  runId: string;
}

/**
 * Runs after an agent's tool loop (runAgent) has already returned and
 * agent_runs is already marked completed (04-PHASE-4-AUTONOMY-AND-WRITES.md
 * §2). For every `agent_human`-level write draft the run produced, raises a
 * durable approval request and waits (durably — this can span an Inngest
 * step boundary/retry) for a human decision:
 *
 *   - approved  -> executed via executeApprovedWrite (create_task only — 5.4c)
 *   - rejected  -> logged, no action taken
 *   - timed out -> the approval row itself is marked `expired`, no action taken
 *
 * `fully_automated` and `human_led` drafts are untouched here — this gate
 * only exists for the middle tier that needs a human in the loop before
 * anything executes.
 */
export async function runWriteApprovalGate({ step, db, runId }: RunWriteApprovalGateParams): Promise<void> {
  const proposals = await step.run("load-write-proposals", () => loadAgentHumanWriteProposals(db, runId));

  // One step per proposal, keyed by the stable agent_outputs row id, rather
  // than a single step wrapping the whole create loop. Inngest memoizes a
  // step only on success: with one combined step, a failure on the Nth insert
  // re-runs the entire loop on retry and duplicates the N-1 approvals already
  // created (agent_approvals has no unique constraint to catch it). Per-
  // proposal steps make each insert individually memoized, which is what
  // 04-PHASE-4 §5's "forced step retry does not double-write" requires.
  const queued: Array<{ approvalId: string; toolId: string; toolInput: unknown }> = [];
  for (const proposal of proposals) {
    const approvalId = await step.run(`create-approval-${proposal.outputId}`, () =>
      createApprovalRequest({ db, runId, toolId: proposal.toolId, toolInput: proposal.input }),
    );
    queued.push({ approvalId, toolId: proposal.toolId, toolInput: proposal.input });
  }

  // 5.4d: runAgent already marked this run 'completed' before this gate ever
  // ran (doc-04 §2) — that's dishonest for as long as a real human decision
  // is still outstanding, so flip it to 'awaiting_approval' for the duration
  // of the waits below and back to 'completed' once every wait resolves.
  // Skipped entirely when nothing was queued: a run with zero write
  // proposals must never take a spurious status round-trip. Each transition
  // is its own memoized step (same reasoning as the per-proposal steps
  // above) — a combined step would re-run this whole function's body,
  // including the flip back to 'completed', on every retry. A run left
  // stuck at 'awaiting_approval' after a crash between these two steps is
  // intentional and visible, same philosophy as an ai_write_actions row
  // stuck at 'claimed' (5.4c-FIXUP) — it surfaces for human follow-up
  // instead of silently reporting a status that isn't true.
  if (queued.length > 0) {
    await step.run("mark-awaiting-approval", async () => {
      const { error } = await db.from("agent_runs").update({ status: "awaiting_approval" }).eq("id", runId);
      if (error) throw new Error(`Failed to mark agent_runs row awaiting_approval: ${error.message}`);
    });
  }

  // Waited on in parallel, not sequentially. agent_approvals.expires_at is
  // stamped `now() + 48h` at creation time (mig 187's column default) — a
  // moment after the LAST row in `queued` was created. A sequential `for`
  // loop here would only start approval 2's wait once approval 1's resolves,
  // which for a real human-in-the-loop decision can take nearly the full
  // 48h window — so approval 2's wait could start hours or days after its
  // own row already stamped its expiry, badly diverging from what
  // expires_at says. Now that "approved" actually executes a write, that
  // drift is no longer just cosmetic. Firing every wait concurrently keeps
  // each wait's actual start within moments of its row's expires_at stamp,
  // which is what makes the flat 48h timeout below correct at all.
  await Promise.all(
    queued.map(async ({ approvalId, toolId, toolInput }) => {
      const decided = await step.waitForEvent(`wait-approval-${approvalId}`, {
        event: APPROVAL_DECIDED_EVENT,
        if: `async.data.approvalId == "${approvalId}"`,
        timeout: APPROVAL_WAIT_TIMEOUT,
      });

      if (!decided) {
        await step.run(`expire-approval-${approvalId}`, () => expireApproval(db, approvalId));
        logger.info({ runId, approvalId, toolId }, "agent write approval timed out — expired, no action taken");
        return;
      }

      // The decide API route already persisted the decision on
      // agent_approvals before sending this event (mirrors
      // agent-outputs/[id]/route.ts) — this gate only needs to react to it,
      // never re-write the row.
      if (decided.data.decision === "approved") {
        await step.run(`execute-approval-${approvalId}`, () => executeApprovedWrite({ db, runId, approvalId, toolId, toolInput }));
      } else {
        logger.info({ runId, approvalId, toolId }, "agent write approval rejected — no action taken");
      }
    }),
  );

  if (queued.length > 0) {
    await step.run("mark-approvals-settled", async () => {
      const { error } = await db.from("agent_runs").update({ status: "completed" }).eq("id", runId);
      if (error) throw new Error(`Failed to mark agent_runs row completed: ${error.message}`);
    });
  }
}
