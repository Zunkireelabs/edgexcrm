import { describe, it, expect, vi } from "vitest";
import {
  APPROVAL_DECIDED_EVENT,
  loadAgentHumanWriteProposals,
  buildApprovalPreview,
  createApprovalRequest,
  expireApproval,
} from "./approval-flow";

interface FakeOutputRow {
  id: string;
  run_id: string;
  kind: string;
  payload: Record<string, unknown>;
}

function fakeOutputsDb(rows: FakeOutputRow[]) {
  const eq2 = vi.fn((col2: string, val2: unknown) => {
    // First eq() call filters run_id, second filters kind — order matches
    // loadAgentHumanWriteProposals's own .eq("run_id", ...).eq("kind", ...).
    return Promise.resolve({ data: rows.filter((r) => (r as never)[col2] === val2), error: null });
  });
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  return { from: vi.fn(() => ({ select })) } as unknown as Parameters<typeof loadAgentHumanWriteProposals>[0];
}

function fakeApprovalsDb() {
  const inserted: Array<Record<string, unknown>> = [];
  const updated: Array<{ values: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
  const insert = vi.fn((row: Record<string, unknown>) => {
    const stored = { id: "approval-1", ...row };
    inserted.push(stored);
    return { select: () => ({ single: () => Promise.resolve({ data: { id: stored.id }, error: null }) }) };
  });
  const update = vi.fn((values: Record<string, unknown>) => {
    const filters: Array<[string, unknown]> = [];
    const chain = {
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return chain;
      },
      // Awaiting the chain (after however many .eq() calls) resolves it —
      // record the filter set only at that point, once, matching how the
      // real query only executes when the whole chain is awaited.
      then: (resolve: (v: unknown) => void) => {
        updated.push({ values, filters: [...filters] });
        resolve({ error: null });
      },
    };
    return chain;
  });
  const db = { from: vi.fn(() => ({ insert, update })) };
  return { db: db as unknown as Parameters<typeof createApprovalRequest>[0]["db"], inserted, updated };
}

describe("loadAgentHumanWriteProposals", () => {
  it("returns only write_action_proposal rows resolved to agent_human", async () => {
    const db = fakeOutputsDb([
      { id: "out-1", run_id: "run-1", kind: "write_action_proposal", payload: { tool_id: "t1", input: { a: 1 }, idempotency_key: "k1", automation_level: "agent_human" } },
      { id: "out-2", run_id: "run-1", kind: "write_action_proposal", payload: { tool_id: "t2", input: { b: 2 }, idempotency_key: "k2", automation_level: "human_led" } },
      { id: "out-3", run_id: "run-1", kind: "write_action_proposal", payload: { tool_id: "t3", input: { c: 3 }, idempotency_key: "k3", automation_level: "fully_automated" } },
    ]);

    const proposals = await loadAgentHumanWriteProposals(db, "run-1");

    expect(proposals).toEqual([{ outputId: "out-1", toolId: "t1", input: { a: 1 } }]);
  });

  it("returns an empty list when there are none", async () => {
    const db = fakeOutputsDb([]);
    expect(await loadAgentHumanWriteProposals(db, "run-1")).toEqual([]);
  });
});

describe("buildApprovalPreview", () => {
  it("produces a human-readable summary containing the tool id and input", () => {
    const preview = buildApprovalPreview("update_lead_stage", { leadId: "lead-1", stage: "qualified" });
    expect(preview.summary).toContain("update_lead_stage");
    expect(preview.summary).toContain("lead-1");
  });
});

describe("createApprovalRequest", () => {
  it("inserts a pending row with the tool id/input and a preview, returns its id", async () => {
    const { db, inserted } = fakeApprovalsDb();

    const id = await createApprovalRequest({ db, runId: "run-1", toolId: "update_lead_stage", toolInput: { leadId: "lead-1" } });

    expect(id).toBe("approval-1");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      run_id: "run-1",
      tool_id: "update_lead_stage",
      tool_input: { leadId: "lead-1" },
      status: "pending",
    });
    expect(inserted[0].preview).toBeTruthy();
  });
});

describe("expireApproval", () => {
  it("updates status to expired, scoped to the approval id and pending status", async () => {
    const { db, updated } = fakeApprovalsDb();

    await expireApproval(db, "approval-1");

    expect(updated).toHaveLength(1);
    expect(updated[0].values).toEqual({ status: "expired" });
    expect(updated[0].filters).toEqual([
      ["id", "approval-1"],
      ["status", "pending"],
    ]);
  });
});

describe("APPROVAL_DECIDED_EVENT", () => {
  it("is a stable, namespaced event name", () => {
    expect(APPROVAL_DECIDED_EVENT).toBe("agent/approval.decided");
  });
});
