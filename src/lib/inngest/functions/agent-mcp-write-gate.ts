// Durable Inngest consumer for MCP-proposed writes (Phase 5 slice 5.5).
// The MCP route (src/app/api/mcp/route.ts) runs synchronously inside an HTTP
// request/response cycle — it has no tool loop and no step runner of its own,
// so it cannot durably wait up to 48h for a human decision the way
// agent-lead-triage.ts's Inngest function does after runAgent() returns.
// Instead the route sends this event once a write_action_proposal row is
// committed, and this function's only job is the exact same approval-gate
// tail every other agent-run Inngest function already runs.
import { inngest } from "@/lib/inngest/client";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { runWriteApprovalGate, type ApprovalGateStep } from "@/lib/ai/agents/approval-gate";

export const MCP_WRITE_PROPOSED_EVENT = "agent/mcp.write.proposed";

export const agentMcpWriteGate = inngest.createFunction(
  {
    id: "agent-mcp-write-gate",
    triggers: [{ event: MCP_WRITE_PROPOSED_EVENT }],
    concurrency: { limit: 4, key: "event.data.tenantId" },
  },
  async ({ event, step }) => {
    const { tenantId, runId } = event.data as { tenantId: string; runId: string };
    const db = await scopedClientForTenant(tenantId);
    // Inngest's real `step` structurally satisfies ApprovalGateStep but its
    // generic run/waitForEvent return types don't unify against our narrower
    // interface — same cast agent-lead-triage.ts already uses.
    await runWriteApprovalGate({ step: step as unknown as ApprovalGateStep, db, runId });
    return { runId };
  },
);
