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

// createTaskCore (5.4c's create_task executor) goes through the exact same
// audit/event/notification side effects as the interactive REST route and
// create_task AI tool — those hit their own service client internally, not
// the `db` passed around here, so they're mocked the same way
// src/lib/tasks/create-task.test.ts mocks them.
const { createAuditLogMock, emitEventMock, createNotificationsExceptMock } = vi.hoisted(() => ({
  createAuditLogMock: vi.fn(async () => {}),
  emitEventMock: vi.fn(async () => "event-1"),
  createNotificationsExceptMock: vi.fn(async () => {}),
}));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: createAuditLogMock, emitEvent: emitEventMock }));
vi.mock("@/lib/notifications", () => ({
  NotificationTypes: { TASK_ASSIGNED: "task.assigned" },
  createNotificationsExcept: createNotificationsExceptMock,
}));

// createTaskCore wrapped (not replaced) so the claim-collision test can
// assert the executor is never invoked, per the 5.4c-FIXUP brief — counting
// rows alone wouldn't distinguish "never called" from "called but rolled
// back". Every other test gets the real implementation via mockImplementation.
const { createTaskCoreMock } = vi.hoisted(() => ({ createTaskCoreMock: vi.fn() }));
vi.mock("@/lib/tasks/create-task", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tasks/create-task")>();
  createTaskCoreMock.mockImplementation(actual.createTaskCore);
  return { ...actual, createTaskCore: createTaskCoreMock };
});

import { buildPolicyEnforcedWriteTools } from "./write-executor";
import { runWriteApprovalGate, type ApprovalGateStep } from "./approval-gate";

// Test-only fixture write tool — deliberately NOT added to the tools
// registry or any AgentDefinition. No real write tool exists to gate on yet
// besides create_task; this is the minimum shape write-executor.ts needs to
// produce a real write_action_proposal draft so the approval gate has
// something genuine to read back, per the 5.4b brief's testing note.
const FIXTURE_WRITE_TOOL: AgentTool = {
  id: "fixture_update_lead_stage",
  description: "test-only fixture write tool for 5.4b's approval-gate test",
  inputSchema: z.object({ leadId: z.string() }),
  scope: "write",
  execute: vi.fn(async () => ({ ok: true })),
};

// A create_task fixture — write-executor.ts's draft wrapper never calls
// AgentTool.execute() itself (it replaces it with its own draft-recording
// execute), so only `id`/`inputSchema` matter here; the real create_task
// tool's schema lives in src/lib/ai/tools/universal/create-task.ts and isn't
// needed to exercise the approval-gate's create_task executor.
const CREATE_TASK_TOOL_FIXTURE: AgentTool = {
  id: "create_task",
  description: "fixture standing in for the real create_task tool",
  inputSchema: z.object({ title: z.string() }),
  scope: "write",
  execute: vi.fn(async () => ({ ok: true })),
};

interface FakeApprovalRow {
  id: string;
  run_id: string;
  tool_id: string;
  tool_input: unknown;
  preview: unknown;
  status: string;
  expires_at: string;
  decided_by: string | null;
  decided_at: string | null;
}

/** In-memory fake covering the table shapes write-executor.ts, approval-flow.ts, and approval-gate.ts actually use. */
function fakeDb() {
  const agentOutputs: Array<{ id: string; run_id: string; agent_id: string; kind: string; payload: Record<string, unknown>; status: string }> = [];
  const agentApprovals: FakeApprovalRow[] = [];
  const agentRuns: Array<{ id: string; tenant_id: string; agent_id: string }> = [{ id: "run-1", tenant_id: "tenant-1", agent_id: "agent-1" }];
  const aiWriteActions: Array<Record<string, unknown>> = [];
  const tasks: Array<Record<string, unknown>> = [];
  let outputSeq = 0;
  let approvalSeq = 0;
  let awaSeq = 0;
  let taskSeq = 0;

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
      select: () => ({
        eq: (col: string, val: unknown) => ({
          maybeSingle: () => Promise.resolve({ data: agentApprovals.find((r) => (r as never)[col] === val) ?? null }),
        }),
      }),
      insert: (row: Record<string, unknown>) => {
        const stored: FakeApprovalRow = {
          id: `approval-${++approvalSeq}`,
          status: "pending",
          expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
          decided_by: null,
          decided_at: null,
          ...row,
        } as FakeApprovalRow;
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

  function agentRunsTable() {
    return {
      select: () => ({
        eq: (col: string, val: unknown) => ({
          maybeSingle: () => Promise.resolve({ data: agentRuns.find((r) => (r as never)[col] === val) ?? null }),
        }),
      }),
      // 5.4d: runWriteApprovalGate's mark-awaiting-approval/mark-approvals-settled
      // steps write agent_runs.status directly — mirrors the agentApprovals
      // update() fake's filter-collecting-then-thenable shape below.
      update: (values: Record<string, unknown>) => {
        const filters: Array<[string, unknown]> = [];
        const chain = {
          eq: (col: string, val: unknown) => {
            filters.push([col, val]);
            return chain;
          },
          then: (resolve: (v: unknown) => void) => {
            // 5.4d-FIXUP: lets a test force this update to report a DB error,
            // same shape as crashController.crashNextFinalize below — proves
            // the gate throws (surfacing the failed flip) instead of silently
            // leaving agent_runs reading a status the update never applied.
            if (runsUpdateController.failNextUpdate) {
              runsUpdateController.failNextUpdate = false;
              resolve({ error: { message: "simulated agent_runs update failure" } });
              return;
            }
            const row = agentRuns.find((r) => filters.every(([c, v]) => (r as never)[c] === v));
            if (row) Object.assign(row, values);
            resolve({ error: null });
          },
        };
        return chain;
      },
    };
  }

  const runsUpdateController = { failNextUpdate: false };

  function aiWriteActionsTable() {
    return {
      select: () => ({
        eq: (col: string, val: unknown) => ({
          maybeSingle: () => Promise.resolve({ data: aiWriteActions.find((r) => (r as never)[col] === val) ?? null }),
        }),
      }),
      insert: (row: Record<string, unknown>) => {
        const dup = aiWriteActions.find((r) => r.tool_call_id === row.tool_call_id);
        if (dup) {
          return Promise.resolve({ error: { code: "23505", message: "duplicate key value violates unique constraint" } });
        }
        aiWriteActions.push({ id: `awa-${++awaSeq}`, ...row });
        return Promise.resolve({ error: null });
      },
      update: (values: Record<string, unknown>) => {
        const filters: Array<[string, unknown]> = [];
        const chain = {
          eq: (col: string, val: unknown) => {
            filters.push([col, val]);
            return chain;
          },
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
            if (crashController.crashNextFinalize) {
              crashController.crashNextFinalize = false;
              const err = new Error("simulated crash before finalize");
              if (reject) reject(err);
              else throw err;
              return;
            }
            const row = aiWriteActions.find((r) => filters.every(([c, v]) => (r as never)[c] === v));
            if (row) Object.assign(row, values);
            resolve({ error: null });
          },
        };
        return chain;
      },
    };
  }

  // Lets a test force the NEXT finalize update on ai_write_actions to reject,
  // simulating a process crash between the write executing and its audit row
  // being finalized (5.4c-FIXUP hazard test) — resets itself after firing once.
  const crashController = { crashNextFinalize: false };

  function tasksTable() {
    return {
      insert: (row: Record<string, unknown>) => {
        const stored = { id: `task-${++taskSeq}`, ...row };
        tasks.push(stored);
        return { select: () => ({ single: () => Promise.resolve({ data: stored, error: null }) }) };
      },
    };
  }

  const knownTables: Record<string, () => unknown> = {
    agent_outputs: outputsTable,
    agent_approvals: approvalsTable,
    agent_runs: agentRunsTable,
    ai_write_actions: aiWriteActionsTable,
    tasks: tasksTable,
  };
  const db = {
    from: (table: string) => {
      const factory = knownTables[table];
      if (!factory) throw new Error(`unexpected mutation against untracked table "${table}"`);
      return factory();
    },
  };
  return { db: db as never, agentOutputs, agentApprovals, agentRuns, aiWriteActions, tasks, crashController, runsUpdateController };
}

/** Original (non-mutating) fake: returns a canned decision but never touches agent_approvals — used where decided_by is irrelevant (no real executor is registered for the fixture tool). */
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

/**
 * Mutating fake: when it resolves a decision, it also stamps `status` +
 * `decided_by` on the matching agent_approvals row — mirroring what the
 * real PATCH /api/v1/agent-approvals/[id] route does before sending the
 * decided event. executeApprovedWrite reads decided_by back off that row,
 * so any create_task-executing test needs this, not the plain fakeStep.
 */
function fakeApprovalDecisionStep(
  decisionQueue: Array<string | undefined>,
  agentApprovals: FakeApprovalRow[],
  decidedBy = "decider-1",
): ApprovalGateStep {
  const decisions = [...decisionQueue];
  return {
    run: async (_id, fn) => fn(),
    waitForEvent: async (_id, opts) => {
      const decision = decisions.shift();
      if (decision === undefined) return null;
      const match = /async\.data\.approvalId == "([^"]+)"/.exec(opts.if);
      const approvalId = match?.[1] ?? "unused-in-fake";
      const row = agentApprovals.find((r) => r.id === approvalId);
      if (row) {
        row.status = decision;
        row.decided_by = decidedBy;
      }
      return { data: { approvalId, decision } };
    },
  };
}

/**
 * Memoizing fake: `run()` caches by step id across repeated calls to
 * runWriteApprovalGate (mirroring real Inngest step memoization), EXCEPT for
 * step ids matching `forceRerunIdPrefix`, which always re-invoke fn() — that
 * models "this one step is forced to retry" without the whole function
 * replaying from scratch. `waitForEvent` is memoized the same way, so a
 * forced retry of only the execute step reuses the same approvalId and the
 * same already-resolved decision instead of consuming a fresh one off the
 * queue.
 */
function fakeMemoizingStep(
  decisionQueue: Array<string | undefined>,
  agentApprovals: FakeApprovalRow[],
  opts: { forceRerunIdPrefix?: string; decidedBy?: string } = {},
): ApprovalGateStep {
  const cache = new Map<string, unknown>();
  const decisions = [...decisionQueue];
  const decidedBy = opts.decidedBy ?? "decider-1";
  const isForced = (id: string) => !!opts.forceRerunIdPrefix && id.startsWith(opts.forceRerunIdPrefix);
  return {
    run: async (id, fn) => {
      if (isForced(id)) return fn();
      if (cache.has(id)) return cache.get(id) as never;
      const result = await fn();
      cache.set(id, result);
      return result;
    },
    waitForEvent: async (id, waitOpts) => {
      if (cache.has(id)) return cache.get(id) as never;
      const decision = decisions.shift();
      let outcome: { data: { approvalId: string; decision: string } } | null = null;
      if (decision !== undefined) {
        const match = /async\.data\.approvalId == "([^"]+)"/.exec(waitOpts.if);
        const approvalId = match?.[1] ?? "unused-in-fake";
        const row = agentApprovals.find((r) => r.id === approvalId);
        if (row) {
          row.status = decision;
          row.decided_by = decidedBy;
        }
        outcome = { data: { approvalId, decision } };
      }
      cache.set(id, outcome);
      return outcome;
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

async function draftCreateTaskWrite(db: ReturnType<typeof fakeDb>["db"], runId: string, input: Record<string, unknown>) {
  const toolset = buildPolicyEnforcedWriteTools([CREATE_TASK_TOOL_FIXTURE], {
    db,
    tenantId: "tenant-1",
    agentId: "agent-1",
    runId,
    subjectType: null,
    subjectId: null,
  });
  const tool = toolset.create_task as unknown as {
    execute: (input: unknown, opts: { toolCallId: string }) => Promise<unknown>;
  };
  await tool.execute(input, { toolCallId: "call-1" });
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

  it("approve without a decided_by on the row takes no DB action (defensive — the real decide route always sets one)", async () => {
    const { db, agentApprovals, agentOutputs, aiWriteActions } = fakeDb();
    await draftOneAgentHumanWrite(db, "run-1");

    await runWriteApprovalGate({ step: fakeStep(["approved"]), db, runId: "run-1" });

    expect(agentOutputs).toHaveLength(1); // only the original draft — no execution occurred
    expect(agentApprovals).toHaveLength(1); // gate created no second approval row
    expect(agentApprovals[0].status).toBe("pending"); // gate itself never rewrites agent_approvals
    expect(aiWriteActions).toHaveLength(0); // no decided_by to attribute the write to -> refuses to execute
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

describe("runWriteApprovalGate — create_task execution (5.4c)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAutomationLevelMock.mockResolvedValue("agent_human");
  });

  it("agent_human approved: creates exactly one task and one ai_write_actions row attributed to the approving human", async () => {
    const { db, agentApprovals, tasks, aiWriteActions } = fakeDb();
    await draftCreateTaskWrite(db, "run-1", { title: "Follow up with lead" });

    await runWriteApprovalGate({ step: fakeApprovalDecisionStep(["approved"], agentApprovals, "decider-1"), db, runId: "run-1" });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: "Follow up with lead", assignee_id: "decider-1", assigned_by_id: null, status: "todo" });

    expect(aiWriteActions).toHaveLength(1);
    expect(aiWriteActions[0]).toMatchObject({
      user_id: "decider-1",
      agent_id: "agent-1",
      run_id: "run-1",
      tool_id: "create_task",
      tool_call_id: agentApprovals[0].id,
      status: "executed",
    });
    expect((aiWriteActions[0].result as { title: string }).title).toBe("Follow up with lead");
  });

  it("forced retry of just the execute step creates exactly one task (idempotency via ai_write_actions' tool_call_id)", async () => {
    const { db, agentApprovals, tasks, aiWriteActions } = fakeDb();
    await draftCreateTaskWrite(db, "run-1", { title: "Follow up with lead" });

    const step = fakeMemoizingStep(["approved"], agentApprovals, { forceRerunIdPrefix: "execute-approval-" });

    await runWriteApprovalGate({ step, db, runId: "run-1" });
    await runWriteApprovalGate({ step, db, runId: "run-1" }); // create/wait steps memoized; execute step forced to rerun

    expect(tasks).toHaveLength(1);
    expect(aiWriteActions).toHaveLength(1);
  });

  it("agent_human rejected: zero tasks, zero ai_write_actions", async () => {
    const { db, agentApprovals, tasks, aiWriteActions } = fakeDb();
    await draftCreateTaskWrite(db, "run-1", { title: "Follow up with lead" });

    await runWriteApprovalGate({ step: fakeApprovalDecisionStep(["rejected"], agentApprovals), db, runId: "run-1" });

    expect(agentApprovals[0].status).toBe("rejected");
    expect(tasks).toHaveLength(0);
    expect(aiWriteActions).toHaveLength(0);
  });

  it("timeout: expired, zero tasks, zero ai_write_actions", async () => {
    const { db, agentApprovals, tasks, aiWriteActions } = fakeDb();
    await draftCreateTaskWrite(db, "run-1", { title: "Follow up with lead" });

    await runWriteApprovalGate({ step: fakeApprovalDecisionStep([undefined], agentApprovals), db, runId: "run-1" });

    expect(agentApprovals[0].status).toBe("expired");
    expect(tasks).toHaveLength(0);
    expect(aiWriteActions).toHaveLength(0);
  });

  it("human_led: still drafts only — zero approvals, zero tasks, zero ai_write_actions (DB-diff proof)", async () => {
    resolveAutomationLevelMock.mockResolvedValue("human_led");
    const { db, agentOutputs, agentApprovals, tasks, aiWriteActions } = fakeDb();
    await draftCreateTaskWrite(db, "run-1", { title: "Follow up with lead" });

    await runWriteApprovalGate({ step: fakeStep([]), db, runId: "run-1" });

    expect(agentOutputs).toHaveLength(1); // the draft itself
    expect(agentApprovals).toHaveLength(0);
    expect(tasks).toHaveLength(0);
    expect(aiWriteActions).toHaveLength(0);
  });

  it("fully_automated: still drafts only — zero approvals, zero tasks, zero ai_write_actions", async () => {
    resolveAutomationLevelMock.mockResolvedValue("fully_automated");
    const { db, agentOutputs, agentApprovals, tasks, aiWriteActions } = fakeDb();
    await draftCreateTaskWrite(db, "run-1", { title: "Follow up with lead" });

    await runWriteApprovalGate({ step: fakeStep([]), db, runId: "run-1" });

    expect(agentOutputs).toHaveLength(1);
    expect(agentApprovals).toHaveLength(0);
    expect(tasks).toHaveLength(0);
    expect(aiWriteActions).toHaveLength(0);
  });
});

describe("runWriteApprovalGate — claim-then-execute hazards (5.4c-FIXUP)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAutomationLevelMock.mockResolvedValue("agent_human");
  });

  it("crash between execute and finalize: leaves the row 'claimed' — a retry does not create a second task", async () => {
    const { db, agentApprovals, tasks, aiWriteActions, crashController } = fakeDb();
    await draftCreateTaskWrite(db, "run-1", { title: "Follow up with lead" });

    // A single memoizing step across both calls, exactly like a real Inngest
    // retry: the create-approval/wait-approval steps already succeeded and
    // stay cached, only the execute step (never cached — it threw) re-enters.
    const step = fakeMemoizingStep(["approved"], agentApprovals, { decidedBy: "decider-1" });

    crashController.crashNextFinalize = true;
    await expect(runWriteApprovalGate({ step, db, runId: "run-1" })).rejects.toThrow("simulated crash before finalize");

    expect(tasks).toHaveLength(1); // createTaskCore ran before the simulated crash
    expect(aiWriteActions).toHaveLength(1);
    expect(aiWriteActions[0].status).toBe("claimed"); // never finalized — not silently marked executed

    await runWriteApprovalGate({ step, db, runId: "run-1" }); // retry

    expect(tasks).toHaveLength(1); // no duplicate task
    expect(aiWriteActions).toHaveLength(1);
    expect(aiWriteActions[0].status).toBe("claimed"); // still stuck — surfaced for human follow-up, not silently fixed
    expect(createTaskCoreMock).toHaveBeenCalledTimes(1); // the retry did not re-invoke the executor
  });

  it("claim collision: a pre-existing 'claimed' row blocks execution — createTaskCore is never invoked", async () => {
    const { db, agentApprovals, tasks, aiWriteActions } = fakeDb();
    await draftCreateTaskWrite(db, "run-1", { title: "Follow up with lead" });

    // Deterministic id: this fakeDb's first-ever agent_approvals insert gets
    // "approval-1" (approvalSeq starts at 0), which is what runWriteApprovalGate
    // will use as ai_write_actions.tool_call_id for this run's one proposal.
    aiWriteActions.push({
      id: "awa-preexisting",
      user_id: "decider-1",
      agent_id: "agent-1",
      run_id: "run-1",
      tool_call_id: "approval-1",
      tool_id: "create_task",
      input: { title: "Follow up with lead" },
      status: "claimed",
      result: null,
      error: null,
    });

    await runWriteApprovalGate({ step: fakeApprovalDecisionStep(["approved"], agentApprovals, "decider-1"), db, runId: "run-1" });

    expect(createTaskCoreMock).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(0);
    expect(aiWriteActions).toHaveLength(1); // unchanged — still the pre-existing row
    expect(aiWriteActions[0].status).toBe("claimed");
  });

  it("stale-'failed' repair: a pre-existing 'failed' row on a succeeding retry ends 'executed' with the fresh result", async () => {
    const { db, agentApprovals, tasks, aiWriteActions } = fakeDb();
    await draftCreateTaskWrite(db, "run-1", { title: "Follow up with lead" });

    aiWriteActions.push({
      id: "awa-stale",
      user_id: "decider-1",
      agent_id: "agent-1",
      run_id: "run-1",
      tool_call_id: "approval-1",
      tool_id: "create_task",
      input: { title: "Follow up with lead" },
      status: "failed",
      result: null,
      error: "stale error from a prior attempt",
    });

    await runWriteApprovalGate({ step: fakeApprovalDecisionStep(["approved"], agentApprovals, "decider-1"), db, runId: "run-1" });

    expect(tasks).toHaveLength(1);
    expect(aiWriteActions).toHaveLength(1); // repaired in place, not a second row
    expect(aiWriteActions[0]).toMatchObject({ status: "executed", error: null });
    expect((aiWriteActions[0].result as { title: string }).title).toBe("Follow up with lead");
  });
});

describe("runWriteApprovalGate — run status transitions (5.4d, mig 184)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAutomationLevelMock.mockResolvedValue("agent_human");
  });

  it("with a queued proposal: the run goes awaiting_approval then back to completed", async () => {
    const { db, agentApprovals, agentRuns } = fakeDb();
    await draftOneAgentHumanWrite(db, "run-1");

    const statusesSeen: string[] = [];
    const base = fakeApprovalDecisionStep(["approved"], agentApprovals, "decider-1");
    const step: ApprovalGateStep = {
      ...base,
      run: async (id, fn) => {
        const result = await base.run(id, fn);
        if (id === "mark-awaiting-approval" || id === "mark-approvals-settled") {
          const run = agentRuns.find((r) => r.id === "run-1") as { status?: string } | undefined;
          statusesSeen.push(run?.status ?? "<unset>");
        }
        return result;
      },
    };

    await runWriteApprovalGate({ step, db, runId: "run-1" });

    expect(statusesSeen).toEqual(["awaiting_approval", "completed"]);
  });

  it("with zero proposals: run status is never touched (no spurious update)", async () => {
    resolveAutomationLevelMock.mockResolvedValue("human_led"); // drafts only — nothing gets queued
    const { db, agentRuns } = fakeDb();
    await draftOneAgentHumanWrite(db, "run-1");

    await runWriteApprovalGate({ step: fakeStep([]), db, runId: "run-1" });

    const run = agentRuns.find((r) => r.id === "run-1") as { status?: string } | undefined;
    expect(run?.status).toBeUndefined();
  });

  it("mark-awaiting-approval: a Supabase error on the flip throws instead of silently leaving the run reading 'Completed'", async () => {
    const { db, agentApprovals, runsUpdateController } = fakeDb();
    await draftOneAgentHumanWrite(db, "run-1");
    runsUpdateController.failNextUpdate = true;

    await expect(
      runWriteApprovalGate({ step: fakeApprovalDecisionStep(["approved"], agentApprovals, "decider-1"), db, runId: "run-1" }),
    ).rejects.toThrow("Failed to mark agent_runs row awaiting_approval");
  });

  it("mark-approvals-settled: a Supabase error on the flip back throws instead of silently leaving the run stuck at awaiting_approval", async () => {
    const { db, agentApprovals, agentRuns, runsUpdateController } = fakeDb();
    await draftOneAgentHumanWrite(db, "run-1");

    const step = fakeApprovalDecisionStep(["approved"], agentApprovals, "decider-1");
    const failingStep: ApprovalGateStep = {
      ...step,
      run: async (id, fn) => {
        // Only the second (settle-back-to-completed) flip fails — the first
        // (awaiting_approval) must succeed for the run to reach the settle
        // step at all.
        if (id === "mark-approvals-settled") runsUpdateController.failNextUpdate = true;
        return step.run(id, fn);
      },
    };

    await expect(runWriteApprovalGate({ step: failingStep, db, runId: "run-1" })).rejects.toThrow(
      "Failed to mark agent_runs row completed",
    );

    const run = agentRuns.find((r) => r.id === "run-1") as { status?: string } | undefined;
    expect(run?.status).toBe("awaiting_approval"); // left visibly stuck, not silently reported "completed"
  });
});
