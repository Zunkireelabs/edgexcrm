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
 * must call the exact same core the interactive path uses (createTaskCore),
 * never the AgentTool.execute() wrapper, which asserts a real user session
 * (assertUserAuth) that doesn't exist here.
 *
 * Scope for 5.4c: create_task only (see the slice brief). Adding another
 * tool here is 5.4c-2's job, not this one's.
 */
const APPROVAL_EXECUTORS: Record<string, (params: ApprovalExecutorParams) => Promise<ApprovalExecutorResult>> = {
  create_task: async ({ db, tenantId, defaultAssigneeId, input }) => {
    const coreInput: CreateTaskInput = mapCreateTaskToolInput(input as Parameters<typeof mapCreateTaskToolInput>[0]);
    const outcome = await createTaskCore(db, { tenantId, defaultAssigneeId }, coreInput);
    if (outcome.kind === "ok") return { result: outcome.task };
    if (outcome.kind === "validation") return { error: `Validation failed: ${JSON.stringify(outcome.errors)}` };
    return { error: "Database error while creating the task" };
  },
};

interface StoredWriteAction {
  status: string;
  result: unknown;
}

/**
 * Executes one approved write-action proposal and records it on
 * ai_write_actions, keyed by the approval's own id as tool_call_id (mig 182
 * adds agent_id/run_id provenance columns; user_id is the approving human,
 * per this slice's brief — the schema's NOT NULL user_id has no agent actor
 * to point to instead).
 *
 * Idempotency mirrors adapter.ts's interactive-write path exactly: check for
 * an existing 'executed' row first (the fast path for a forced step retry —
 * `step.run` on the caller side means this rarely re-enters at all, but a
 * fake/non-memoizing step, as in tests, will), then let the UNIQUE
 * (tenant_id, tool_call_id) constraint catch any genuine race the pre-check
 * misses. Either way, createTaskCore (and any future executor here) runs at
 * most once per approval.
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

  const { data: existing } = await db
    .from("ai_write_actions")
    .select("status, result")
    .eq("tool_call_id", approvalId)
    .maybeSingle();
  if ((existing as StoredWriteAction | null)?.status === "executed") {
    log.info("agent write idempotent replay — already executed, skipping");
    return;
  }

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

  const { error: insertError } = await db.from("ai_write_actions").insert({
    user_id: decidedBy,
    agent_id: runContext.agentId,
    run_id: runId,
    tool_call_id: approvalId,
    tool_id: toolId,
    input: toolInput,
    status,
    result,
    error,
  });

  if (insertError) {
    if ((insertError as { code?: string }).code === UNIQUE_VIOLATION) {
      log.info("concurrent duplicate on ai_write_actions insert — already recorded by a racing execution");
      return;
    }
    log.error({ err: insertError }, "ai_write_actions insert failed");
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

  // Waited on in parallel, not sequentially. agent_approvals.expires_at is
  // stamped `now() + 48h` at creation time (mig 181's column default) — a
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
}
