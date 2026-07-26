import type { ScopedClient } from "@/lib/supabase/scoped";
import { logger } from "@/lib/logger";
import { APPROVAL_DECIDED_EVENT, loadAgentHumanWriteProposals, createApprovalRequest, expireApproval } from "./approval-flow";

export const APPROVAL_WAIT_TIMEOUT = "48h";

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
 *   - approved  -> logged, no action taken (no write executor exists yet — 5.4c)
 *   - rejected  -> logged, no action taken
 *   - timed out -> the approval row itself is marked `expired`, no action taken
 *
 * `fully_automated` and `human_led` drafts are untouched here — this gate
 * only exists for the middle tier that needs a human in the loop before
 * anything (eventually) executes.
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
  const queued: Array<{ approvalId: string; toolId: string }> = [];
  for (const proposal of proposals) {
    const approvalId = await step.run(`create-approval-${proposal.outputId}`, () =>
      createApprovalRequest({ db, runId, toolId: proposal.toolId, toolInput: proposal.input }),
    );
    queued.push({ approvalId, toolId: proposal.toolId });
  }

  for (const { approvalId, toolId } of queued) {
    const decided = await step.waitForEvent(`wait-approval-${approvalId}`, {
      event: APPROVAL_DECIDED_EVENT,
      if: `async.data.approvalId == "${approvalId}"`,
      timeout: APPROVAL_WAIT_TIMEOUT,
    });

    if (!decided) {
      await step.run(`expire-approval-${approvalId}`, () => expireApproval(db, approvalId));
      logger.info({ runId, approvalId, toolId }, "agent write approval timed out — expired, no action taken");
      continue;
    }

    // The decide API route already persisted the decision on agent_approvals
    // before sending this event (mirrors agent-outputs/[id]/route.ts) — this
    // gate only needs to react to it, never re-write the row.
    if (decided.data.decision === "approved") {
      logger.info({ runId, approvalId, toolId }, "agent write approval approved — no write executor yet (5.4c), no action taken");
    } else {
      logger.info({ runId, approvalId, toolId }, "agent write approval rejected — no action taken");
    }
  }
}
