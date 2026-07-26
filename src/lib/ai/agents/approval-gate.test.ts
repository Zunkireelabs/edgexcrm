import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { AgentTool } from "@/lib/ai/tools/types";

// write-executor.ts (5.4a, unmodified) is exercised for real here to produce
// the write_action_proposal draft this gate reads back — only
// resolveAutomationLevel is faked, so we can force the "agent_human" tier
// without a real per-tenant policy row.
const { resolveAutomationLevelMock } = vi.hoisted(() => ({ resolveAutomationLevelMock: vi.fn() }));
vi.mock("./policy", () => ({ resolveAutomationLevel: resolveAutomationLevelMock }));
vi.mock("@/lib/logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { buildPolicyEnforcedWriteTools } from "./write-executor";
import { runWriteApprovalGate, type ApprovalGateStep } from "./approval-gate";

// Test-only fixture write tool — deliberately NOT added to the tools
// registry or any AgentDefinition. No real write tool exists to gate on yet
// (5.4c); this is the minimum shape write-executor.ts needs to produce a
// real write_action_proposal draft so the approval gate has something
// genuine to read back, per the 5.4b brief's testing note.
const FIXTURE_WRITE_TOOL: AgentTool = {
  id: "fixture_update_lead_stage",
  description: "test-only fixture write tool for 5.4b's approval-gate test",
  inputSchema: z.object({ leadId: z.string() }),
  scope: "write",
  execute: vi.fn(async () => ({ ok: true })),
};

/** In-memory fake covering only the agent_outputs/agent_approvals query shapes write-executor.ts and approval-flow.ts actually use. */
function fakeDb() {
  const agentOutputs: Array<{ id: string; run_id: string; agent_id: string; kind: string; payload: Record<string, unknown>; status: string }> = [];
  const agentApprovals: Array<{ id: string; run_id: string; tool_id: string; tool_input: unknown; preview: unknown; status: string; expires_at: string; decided_by: string | null; decided_at: string | null }> = [];
  let outputSeq = 0;
  let approvalSeq = 0;

  function outputsTable() {
    return {
      select: () => ({
        eq: (col1: string, val1: unknown) => ({
          contains: (col: string, obj: Record<string, unknown>) => ({
            maybeSingle: () =>
              Promise.resolve({
                data:
                  agentOutputs.find(
                    (r) => (r as never)[col1] === val1 && Object.entries(obj).every(([k, v]) => (r.payload as never)[k] === v),
                  ) ?? null,
              }),
          }),
          eq: (col2: string, val2: unknown) =>
            Promise.resolve({
              data: agentOutputs.filter((r) => (r as never)[col1] === val1 && (r as never)[col2] === val2),
              error: null,
            }),
        }),
      }),
      insert: (row: Record<string, unknown>) => {
        const stored = { id: `output-${++outputSeq}`, status: "proposed", ...row } as (typeof agentOutputs)[number];
        agentOutputs.push(stored);
        return Promise.resolve({ error: null });
      },
    };
  }

  function approvalsTable() {
    return {
      insert: (row: Record<string, unknown>) => {
        const stored = {
          id: `approval-${++approvalSeq}`,
          status: "pending",
          expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
          decided_by: null,
          decided_at: null,
          ...row,
        } as (typeof agentApprovals)[number];
        agentApprovals.push(stored);
        return { select: () => ({ single: () => Promise.resolve({ data: { id: stored.id }, error: null }) }) };
      },
      update: (values: Record<string, unknown>) => {
        const filters: Array<[string, unknown]> = [];
        const chain = {
          eq: (col: string, val: unknown) => {
            filters.push([col, val]);
            return chain;
          },
          then: (resolve: (v: unknown) => void) => {
            const row = agentApprovals.find((r) => filters.every(([c, v]) => (r as never)[c] === v));
            if (row) Object.assign(row, values);
            resolve({ error: null });
          },
        };
        return chain;
      },
    };
  }

  const knownTables: Record<string, () => unknown> = { agent_outputs: outputsTable, agent_approvals: approvalsTable };
  const db = {
    from: (table: string) => {
      const factory = knownTables[table];
      if (!factory) throw new Error(`unexpected mutation against untracked table "${table}"`);
      return factory();
    },
  };
  return { db: db as never, agentOutputs, agentApprovals };
}

/** Records step ids invoked and resolves waitForEvent from a canned decision queue — no real Inngest durability needed to exercise this gate's branching. */
function fakeStep(decisionQueue: Array<string | undefined>): ApprovalGateStep {
  const decisions = [...decisionQueue];
  return {
    run: async (_id, fn) => fn(),
    waitForEvent: async () => {
      const decision = decisions.shift();
      if (decision === undefined) return null;
      return { data: { approvalId: "unused-in-fake", decision } };
    },
  };
}

async function draftOneAgentHumanWrite(db: ReturnType<typeof fakeDb>["db"], runId: string) {
  const toolset = buildPolicyEnforcedWriteTools([FIXTURE_WRITE_TOOL], {
    db,
    tenantId: "tenant-1",
    agentId: "agent-1",
    runId,
    subjectType: "lead",
    subjectId: "lead-1",
  });
  const tool = toolset.fixture_update_lead_stage as unknown as {
    execute: (input: unknown, opts: { toolCallId: string }) => Promise<unknown>;
  };
  await tool.execute({ leadId: "lead-1" }, { toolCallId: "call-1" });
}

describe("runWriteApprovalGate (end to end via write-executor's real draft path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAutomationLevelMock.mockResolvedValue("agent_human");
  });

  it("creates an agent_approvals row with the correct run/tool_input and a non-null expires_at", async () => {
    const { db, agentApprovals } = fakeDb();
    await draftOneAgentHumanWrite(db, "run-1");

    await runWriteApprovalGate({ step: fakeStep(["approved"]), db, runId: "run-1" });

    expect(agentApprovals).toHaveLength(1);
    expect(agentApprovals[0]).toMatchObject({ run_id: "run-1", tool_id: "fixture_update_lead_stage", tool_input: { leadId: "lead-1" } });
    expect(agentApprovals[0].expires_at).toBeTruthy();
  });

  it("approve: takes no DB action itself — the decide route (tested separately) owns writing 'approved'", async () => {
    const { db, agentApprovals, agentOutputs } = fakeDb();
    await draftOneAgentHumanWrite(db, "run-1");

    await runWriteApprovalGate({ step: fakeStep(["approved"]), db, runId: "run-1" });

    expect(agentOutputs).toHaveLength(1); // only the original draft — no execution occurred
    expect(agentApprovals).toHaveLength(1); // gate created no second approval row
    expect(agentApprovals[0].status).toBe("pending"); // gate itself never rewrites on approve
  });

  it("reject: takes no action, approval stays whatever the decide route set it to", async () => {
    const { db, agentApprovals, agentOutputs } = fakeDb();
    await draftOneAgentHumanWrite(db, "run-1");

    await runWriteApprovalGate({ step: fakeStep(["rejected"]), db, runId: "run-1" });

    expect(agentOutputs).toHaveLength(1);
    expect(agentApprovals[0].status).toBe("pending"); // gate itself never rewrites on reject — decide route already did
  });

  it("timeout: marks the approval expired and takes no action", async () => {
    const { db, agentApprovals, agentOutputs } = fakeDb();
    await draftOneAgentHumanWrite(db, "run-1");

    await runWriteApprovalGate({ step: fakeStep([undefined]), db, runId: "run-1" });

    expect(agentApprovals[0].status).toBe("expired");
    expect(agentOutputs).toHaveLength(1); // no execution, no other mutation
  });

  it("queues nothing when the draft resolved to a level other than agent_human", async () => {
    resolveAutomationLevelMock.mockResolvedValue("human_led");
    const { db, agentApprovals } = fakeDb();
    await draftOneAgentHumanWrite(db, "run-1");

    await runWriteApprovalGate({ step: fakeStep([]), db, runId: "run-1" });

    expect(agentApprovals).toHaveLength(0);
  });
});
