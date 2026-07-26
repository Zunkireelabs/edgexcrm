import type { ScopedClient } from "@/lib/supabase/scoped";

/**
 * 5.4b: reads back the write-action drafts write-executor.ts (5.4a) recorded
 * during a run's tool loop and, for the ones resolved to `agent_human`,
 * raises a durable approval request instead of executing anything. There is
 * still no live write path — approval only decides whether a human has
 * signed off; real execution lands in 5.4c.
 */

// Inngest event name the decide API route sends and the approval gate's
// step.waitForEvent listens for — the one seam between the two.
export const APPROVAL_DECIDED_EVENT = "agent/approval.decided";

export interface WriteActionProposal {
  outputId: string;
  toolId: string;
  input: unknown;
}

interface WriteActionProposalPayload {
  tool_id: string;
  input: unknown;
  idempotency_key: string;
  automation_level: string;
}

interface AgentOutputRow {
  id: string;
  payload: WriteActionProposalPayload;
}

/** This run's write_action_proposal drafts whose resolved automation level is `agent_human`. */
export async function loadAgentHumanWriteProposals(db: ScopedClient, runId: string): Promise<WriteActionProposal[]> {
  const { data, error } = await db
    .from("agent_outputs")
    .select("id, payload")
    .eq("run_id", runId)
    .eq("kind", "write_action_proposal");
  if (error) throw new Error(`Failed to load write-action proposals: ${error.message}`);

  const rows = (data ?? []) as unknown as AgentOutputRow[];
  return rows
    .filter((row) => row.payload.automation_level === "agent_human")
    .map((row) => ({ outputId: row.id, toolId: row.payload.tool_id, input: row.payload.input }));
}

/** Human-readable "what will happen" summary shown to the approver — 5.4d owns the review UI itself. */
export function buildApprovalPreview(toolId: string, input: unknown): Record<string, unknown> {
  return { summary: `Run "${toolId}" with input ${JSON.stringify(input)}` };
}

export interface CreateApprovalRequestParams {
  db: ScopedClient;
  runId: string;
  toolId: string;
  toolInput: unknown;
}

/** Inserts one pending agent_approvals row for a write-action proposal; returns its id. */
export async function createApprovalRequest(params: CreateApprovalRequestParams): Promise<string> {
  const { db, runId, toolId, toolInput } = params;
  const { data, error } = await db
    .from("agent_approvals")
    .insert({
      run_id: runId,
      tool_id: toolId,
      tool_input: toolInput,
      preview: buildApprovalPreview(toolId, toolInput),
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to create agent_approvals row: ${error?.message ?? "no row returned"}`);
  }
  return (data as { id: string }).id;
}

/** Marks a still-pending approval as expired once its wait times out with no human decision. */
export async function expireApproval(db: ScopedClient, approvalId: string): Promise<void> {
  const { error } = await db.from("agent_approvals").update({ status: "expired" }).eq("id", approvalId).eq("status", "pending");
  if (error) throw new Error(`Failed to expire agent_approvals row: ${error.message}`);
}
