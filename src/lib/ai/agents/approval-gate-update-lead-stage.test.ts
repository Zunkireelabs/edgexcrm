import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { AgentTool } from "@/lib/ai/tools/types";

// update_lead_stage's approval executor (5.4c-2a) runs the REAL applyLeadPatch
// (not a stub) so this suite proves the slice's actual claim — "executes as
// the approver's real AuthContext" — for real: a counselor approver really
// gets refused by requireLeadAccess, an owner approver really doesn't.
// applyLeadPatch (and buildUserAuthContext) both call createServiceClient()
// internally; faked here the same way apply-lead-patch.test.ts fakes it.
const {
  resolvePositionSlugMock,
  getLeadMembershipMock,
  syncOriginMembershipMock,
  addLeadCollaboratorMock,
  assignDisplayIdsMock,
  getPipelineLandingStageMock,
  createAuditLogMock,
  emitEventMock,
  createNotificationsExceptMock,
  getTenantAdminRecipientsMock,
  sendLeadAssignedEmailMock,
  processEmailForwardRulesMock,
  fetchBranchMemberIdsMock,
} = vi.hoisted(() => ({
  resolvePositionSlugMock: vi.fn(async () => null as string | null),
  getLeadMembershipMock: vi.fn(async () => [] as Array<{ branch_id: string; assigned_to: string | null; is_origin: boolean }>),
  syncOriginMembershipMock: vi.fn(async () => {}),
  addLeadCollaboratorMock: vi.fn(async () => {}),
  assignDisplayIdsMock: vi.fn(async () => {}),
  getPipelineLandingStageMock: vi.fn(async () => null as { id: string; slug: string } | null),
  createAuditLogMock: vi.fn(async () => {}),
  emitEventMock: vi.fn(async () => "event-1"),
  createNotificationsExceptMock: vi.fn(async () => {}),
  getTenantAdminRecipientsMock: vi.fn(async () => [] as string[]),
  sendLeadAssignedEmailMock: vi.fn(async () => {}),
  processEmailForwardRulesMock: vi.fn(async () => {}),
  fetchBranchMemberIdsMock: vi.fn(async () => [] as string[]),
}));

vi.mock("@/lib/leads/branch-membership", () => ({
  getLeadMembership: getLeadMembershipMock,
  syncOriginMembership: syncOriginMembershipMock,
  branchMemberIds: fetchBranchMemberIdsMock,
}));
vi.mock("@/lib/leads/collaborators", () => ({ addLeadCollaborator: addLeadCollaboratorMock }));
vi.mock("@/lib/leads/assign-display-ids", () => ({ assignDisplayIds: assignDisplayIdsMock }));
vi.mock("@/lib/leads/pipeline-stage", () => ({ getPipelineLandingStage: getPipelineLandingStageMock }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: createAuditLogMock, emitEvent: emitEventMock }));
vi.mock("@/lib/notifications", () => ({
  NotificationTypes: { LEAD_ASSIGNED: "lead.assigned", LEAD_UNASSIGNED: "lead.unassigned", LEAD_STAGE_CHANGED: "lead.stage_changed" },
  createNotificationsExcept: createNotificationsExceptMock,
  getTenantAdminRecipients: getTenantAdminRecipientsMock,
}));
vi.mock("@/lib/email/send-lead-assigned", () => ({ sendLeadAssignedEmail: sendLeadAssignedEmailMock }));
vi.mock("@/lib/email/email-forward", () => ({ processEmailForwardRules: processEmailForwardRulesMock }));
vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, resolvePositionSlug: resolvePositionSlugMock };
});
vi.mock("@/lib/logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createRequestLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}));

const { resolveAutomationLevelMock } = vi.hoisted(() => ({ resolveAutomationLevelMock: vi.fn() }));
vi.mock("./policy", () => ({ resolveAutomationLevel: resolveAutomationLevelMock }));

// Wrapped (not replaced) so the claim-collision/crash tests can assert the
// real governance function is never invoked, per the 5.4c-FIXUP harness this
// suite re-uses (see approval-gate.test.ts).
const { applyLeadPatchMock } = vi.hoisted(() => ({ applyLeadPatchMock: vi.fn() }));
vi.mock("@/lib/leads/apply-lead-patch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/leads/apply-lead-patch")>();
  applyLeadPatchMock.mockImplementation(actual.applyLeadPatch);
  return { ...actual, applyLeadPatch: applyLeadPatchMock };
});

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn() }));

import { buildPolicyEnforcedWriteTools } from "./write-executor";
import { runWriteApprovalGate, type ApprovalGateStep } from "./approval-gate";

const TENANT_ID = "tenant-1";
const LEAD_ID = "lead-1";
const TARGET_LIST_ID = "list-qualified";
const NONEXISTENT_LEAD_ID = "99999999-9999-4999-8999-999999999999";

const LEAD_LISTS: Record<
  string,
  { id: string; tenant_id: string; slug: string; name: string; is_archive: boolean; sort_order: number; pipeline_id: string | null; access: { mode: string } }
> = {
  [TARGET_LIST_ID]: {
    id: TARGET_LIST_ID,
    tenant_id: TENANT_ID,
    slug: "qualified",
    name: "Qualified",
    is_archive: false,
    sort_order: 20,
    pipeline_id: null,
    access: { mode: "all" },
  },
};

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID,
    tenant_id: TENANT_ID,
    pipeline_id: "pipe-1",
    assigned_to: null,
    branch_id: null,
    list_id: null,
    status: null,
    stage_id: null,
    first_name: "Jane",
    last_name: "Doe",
    email: null,
    deleted_at: null,
    ...overrides,
  };
}

interface TenantUserRow {
  user_id: string;
  tenant_id: string;
  role: string;
  position_id: string | null;
  branch_id: string | null;
  tenants: { industry_id: string | null; plan: string; entitlement_overrides: Record<string, unknown> };
  positions: null;
}

const ADMIN_USER: TenantUserRow = {
  user_id: "admin-1",
  tenant_id: TENANT_ID,
  role: "owner",
  position_id: null,
  branch_id: null,
  tenants: { industry_id: "education_consultancy", plan: "free", entitlement_overrides: {} },
  positions: null,
};
const COUNSELOR_USER: TenantUserRow = {
  user_id: "counselor-1",
  tenant_id: TENANT_ID,
  role: "counselor",
  position_id: null,
  branch_id: null,
  tenants: { industry_id: "education_consultancy", plan: "free", entitlement_overrides: {} },
  positions: null,
};

interface FakeServiceClientOptions {
  lead?: Record<string, unknown> | null;
  tenantUsers?: TenantUserRow[];
  corruptUpdateReturnId?: boolean;
}

/** Fakes createServiceClient() — the internal client applyLeadPatch AND buildUserAuthContext both call fresh each invocation. */
function makeServiceClientFake(opts: FakeServiceClientOptions) {
  let leadRow = opts.lead ?? null;
  const tenantUsers = opts.tenantUsers ?? [];

  function resolve(table: string, state: { eq: Record<string, unknown>; updateValues?: Record<string, unknown> }) {
    if (table === "leads") {
      if (state.updateValues) {
        leadRow = { ...(leadRow ?? {}), ...state.updateValues };
        if (opts.corruptUpdateReturnId) {
          return { data: { ...leadRow, id: "some-other-lead-id" }, error: null };
        }
        return { data: leadRow, error: null };
      }
      const id = state.eq.id as string | undefined;
      const row = id && leadRow && leadRow.id === id ? leadRow : null;
      return { data: row, error: row ? null : { message: "not found" } };
    }
    if (table === "tenant_users") {
      const uid = state.eq.user_id as string | undefined;
      const row = uid ? tenantUsers.find((r) => r.user_id === uid) ?? null : null;
      return { data: row, error: null };
    }
    if (table === "lead_lists") {
      const id = state.eq.id as string | undefined;
      const row = id ? LEAD_LISTS[id] ?? null : null;
      return { data: row, error: null };
    }
    return { data: null, error: null };
  }

  function chain(table: string) {
    const state: { eq: Record<string, unknown>; updateValues?: Record<string, unknown> } = { eq: {} };
    const builder = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        state.eq[col] = val;
        return builder;
      },
      is() {
        return builder;
      },
      like() {
        return builder;
      },
      in() {
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      update(values: Record<string, unknown>) {
        state.updateValues = values;
        return builder;
      },
      async single() {
        const r = resolve(table, state);
        return { data: r.data, error: r.data ? null : (r.error ?? { message: "not found" }) };
      },
      async maybeSingle() {
        const r = resolve(table, state);
        return { data: r.data, error: null };
      },
      then(onFulfilled: (v: { data: unknown; error: unknown }) => unknown, onRejected?: (e: unknown) => unknown) {
        return Promise.resolve(resolve(table, state)).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  return {
    from: (table: string) => chain(table),
    auth: { admin: { getUserById: async (uid: string) => ({ data: { user: { email: `${uid}@example.com` } } }) } },
    _lead: () => leadRow,
  };
}

async function setFakeServiceClient(opts: FakeServiceClientOptions) {
  const { createServiceClient } = await import("@/lib/supabase/server");
  const client = makeServiceClientFake(opts);
  (createServiceClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return client;
}

// ── approval-gate's own ScopedClient fake (agent_outputs/approvals/runs/ai_write_actions + lead_lists for resolution) ──

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

function fakeDb() {
  const agentOutputs: Array<{ id: string; run_id: string; agent_id: string; kind: string; payload: Record<string, unknown>; status: string }> = [];
  const agentApprovals: FakeApprovalRow[] = [];
  const agentRuns: Array<{ id: string; tenant_id: string; agent_id: string }> = [{ id: "run-1", tenant_id: TENANT_ID, agent_id: "agent-1" }];
  const aiWriteActions: Array<Record<string, unknown>> = [];
  let outputSeq = 0;
  let approvalSeq = 0;
  let awaSeq = 0;

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
    };
  }

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

  const crashController = { crashNextFinalize: false };

  function leadListsTable() {
    return {
      select: () => Promise.resolve({ data: Object.values(LEAD_LISTS), error: null }),
    };
  }

  const knownTables: Record<string, () => unknown> = {
    agent_outputs: outputsTable,
    agent_approvals: approvalsTable,
    agent_runs: agentRunsTable,
    ai_write_actions: aiWriteActionsTable,
    lead_lists: leadListsTable,
  };
  const db = {
    from: (table: string) => {
      const factory = knownTables[table];
      if (!factory) throw new Error(`unexpected mutation against untracked table "${table}"`);
      return factory();
    },
  };
  return { db: db as never, agentOutputs, agentApprovals, agentRuns, aiWriteActions, crashController };
}

function fakeApprovalDecisionStep(decisionQueue: Array<string | undefined>, agentApprovals: FakeApprovalRow[], decidedBy = "admin-1"): ApprovalGateStep {
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

function fakeMemoizingStep(
  decisionQueue: Array<string | undefined>,
  agentApprovals: FakeApprovalRow[],
  opts: { forceRerunIdPrefix?: string; decidedBy?: string } = {},
): ApprovalGateStep {
  const cache = new Map<string, unknown>();
  const decisions = [...decisionQueue];
  const decidedBy = opts.decidedBy ?? "admin-1";
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

const UPDATE_LEAD_STAGE_TOOL_FIXTURE: AgentTool = {
  id: "update_lead_stage",
  description: "fixture standing in for the real update_lead_stage tool",
  inputSchema: z.object({ leadId: z.string().optional(), stageName: z.string().optional() }),
  scope: "write",
  execute: vi.fn(async () => ({ ok: true })),
};

async function draftUpdateLeadStageWrite(db: ReturnType<typeof fakeDb>["db"], runId: string, input: Record<string, unknown>) {
  const toolset = buildPolicyEnforcedWriteTools([UPDATE_LEAD_STAGE_TOOL_FIXTURE], {
    db,
    tenantId: TENANT_ID,
    agentId: "agent-1",
    runId,
    subjectType: "lead",
    subjectId: LEAD_ID,
  });
  const tool = toolset.update_lead_stage as unknown as {
    execute: (input: unknown, opts: { toolCallId: string }) => Promise<unknown>;
  };
  await tool.execute(input, { toolCallId: "call-1" });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveAutomationLevelMock.mockResolvedValue("agent_human");
  resolvePositionSlugMock.mockResolvedValue(null);
  getLeadMembershipMock.mockResolvedValue([]);
});

describe("runWriteApprovalGate — update_lead_stage execution (5.4c-2a)", () => {
  it("agent_human approved (owner approver): moves the lead to exactly the resolved Stage and captures the previous value", async () => {
    await setFakeServiceClient({ lead: makeLead(), tenantUsers: [ADMIN_USER] });
    const { db, agentApprovals, aiWriteActions } = fakeDb();
    await draftUpdateLeadStageWrite(db, "run-1", { leadId: LEAD_ID, stageName: "Qualified" });

    await runWriteApprovalGate({ step: fakeApprovalDecisionStep(["approved"], agentApprovals, "admin-1"), db, runId: "run-1" });

    expect(applyLeadPatchMock).toHaveBeenCalledTimes(1);
    const authArg = applyLeadPatchMock.mock.calls[0][0];
    expect(authArg).toMatchObject({ userId: "admin-1", tenantId: TENANT_ID, role: "owner" });

    expect(aiWriteActions).toHaveLength(1);
    expect(aiWriteActions[0]).toMatchObject({
      user_id: "admin-1",
      agent_id: "agent-1",
      run_id: "run-1",
      tool_id: "update_lead_stage",
      tool_call_id: agentApprovals[0].id,
      status: "executed",
    });
    const result = aiWriteActions[0].result as { leadId: string; stage: string; previous: Record<string, unknown> };
    expect(result).toMatchObject({ leadId: LEAD_ID, stage: "Qualified", previous: { list_id: null } });
  });

  it("hallucinated leadId (valid UUID, doesn't exist in this tenant) → refused, zero mutation, recorded failed", async () => {
    const client = await setFakeServiceClient({ lead: makeLead(), tenantUsers: [ADMIN_USER] });
    const { db, agentApprovals, aiWriteActions } = fakeDb();
    await draftUpdateLeadStageWrite(db, "run-1", { leadId: NONEXISTENT_LEAD_ID, stageName: "Qualified" });

    await runWriteApprovalGate({ step: fakeApprovalDecisionStep(["approved"], agentApprovals, "admin-1"), db, runId: "run-1" });

    expect(applyLeadPatchMock).toHaveBeenCalledTimes(1);
    expect(client._lead()).toMatchObject({ id: LEAD_ID, list_id: null }); // real lead untouched

    expect(aiWriteActions).toHaveLength(1);
    expect(aiWriteActions[0]).toMatchObject({ status: "failed", error: "Lead not found." });
  });

  it("approver lacks permission for that lead (counselor who doesn't own it) → refused, zero mutation", async () => {
    const client = await setFakeServiceClient({
      lead: makeLead({ assigned_to: "someone-else" }),
      tenantUsers: [COUNSELOR_USER],
    });
    const { db, agentApprovals, aiWriteActions } = fakeDb();
    await draftUpdateLeadStageWrite(db, "run-1", { leadId: LEAD_ID, stageName: "Qualified" });

    await runWriteApprovalGate({ step: fakeApprovalDecisionStep(["approved"], agentApprovals, "counselor-1"), db, runId: "run-1" });

    expect(applyLeadPatchMock).toHaveBeenCalledTimes(1);
    const authArg = applyLeadPatchMock.mock.calls[0][0];
    expect(authArg).toMatchObject({ userId: "counselor-1", role: "counselor" });
    expect(client._lead()).toMatchObject({ id: LEAD_ID, list_id: null, assigned_to: "someone-else" }); // unchanged

    expect(aiWriteActions).toHaveLength(1);
    expect(aiWriteActions[0].status).toBe("failed");
  });

  it("missing leadId → assertMandatoryRowFilter refuses before any DB call", async () => {
    const client = await setFakeServiceClient({ lead: makeLead(), tenantUsers: [ADMIN_USER] });
    const { db, agentApprovals, aiWriteActions } = fakeDb();
    await draftUpdateLeadStageWrite(db, "run-1", { stageName: "Qualified" }); // no leadId key at all

    await runWriteApprovalGate({ step: fakeApprovalDecisionStep(["approved"], agentApprovals, "admin-1"), db, runId: "run-1" });

    expect(applyLeadPatchMock).not.toHaveBeenCalled();
    expect(client._lead()).toMatchObject({ id: LEAD_ID, list_id: null });

    expect(aiWriteActions).toHaveLength(1);
    expect(aiWriteActions[0].status).toBe("failed");
    expect(aiWriteActions[0].error as string).toContain("mandatory row-level filter");
  });

  it("returned row identity mismatch → assertSingleRowEffect refuses (no real affected-row count from applyLeadPatch)", async () => {
    await setFakeServiceClient({ lead: makeLead(), tenantUsers: [ADMIN_USER], corruptUpdateReturnId: true });
    const { db, agentApprovals, aiWriteActions } = fakeDb();
    await draftUpdateLeadStageWrite(db, "run-1", { leadId: LEAD_ID, stageName: "Qualified" });

    await runWriteApprovalGate({ step: fakeApprovalDecisionStep(["approved"], agentApprovals, "admin-1"), db, runId: "run-1" });

    expect(aiWriteActions).toHaveLength(1);
    expect(aiWriteActions[0].status).toBe("failed");
    expect(aiWriteActions[0].error as string).toContain("row(s)");
  });

  it("human_led: still drafts only — zero approvals, zero ai_write_actions, lead unchanged (DB-diff proof)", async () => {
    resolveAutomationLevelMock.mockResolvedValue("human_led");
    const client = await setFakeServiceClient({ lead: makeLead(), tenantUsers: [ADMIN_USER] });
    const { db, agentOutputs, agentApprovals, aiWriteActions } = fakeDb();
    await draftUpdateLeadStageWrite(db, "run-1", { leadId: LEAD_ID, stageName: "Qualified" });

    await runWriteApprovalGate({ step: fakeStep([]), db, runId: "run-1" });

    expect(applyLeadPatchMock).not.toHaveBeenCalled();
    expect(client._lead()).toMatchObject({ id: LEAD_ID, list_id: null });
    expect(agentOutputs).toHaveLength(1); // the draft itself
    expect(agentApprovals).toHaveLength(0);
    expect(aiWriteActions).toHaveLength(0);
  });
});

describe("runWriteApprovalGate — update_lead_stage claim-then-execute hazards (5.4c-FIXUP harness reused)", () => {
  it("claim collision: a pre-existing 'claimed' row blocks execution — applyLeadPatch is never invoked", async () => {
    const client = await setFakeServiceClient({ lead: makeLead(), tenantUsers: [ADMIN_USER] });
    const { db, agentApprovals, aiWriteActions } = fakeDb();
    await draftUpdateLeadStageWrite(db, "run-1", { leadId: LEAD_ID, stageName: "Qualified" });

    aiWriteActions.push({
      id: "awa-preexisting",
      user_id: "admin-1",
      agent_id: "agent-1",
      run_id: "run-1",
      tool_call_id: "approval-1",
      tool_id: "update_lead_stage",
      input: { leadId: LEAD_ID, stageName: "Qualified" },
      status: "claimed",
      result: null,
      error: null,
    });

    await runWriteApprovalGate({ step: fakeApprovalDecisionStep(["approved"], agentApprovals, "admin-1"), db, runId: "run-1" });

    expect(applyLeadPatchMock).not.toHaveBeenCalled();
    expect(client._lead()).toMatchObject({ id: LEAD_ID, list_id: null });
    expect(aiWriteActions).toHaveLength(1); // unchanged — still the pre-existing row
    expect(aiWriteActions[0].status).toBe("claimed");
  });

  it("crash between execute and finalize: leaves the row 'claimed' — a retry does not move the lead a second time", async () => {
    await setFakeServiceClient({ lead: makeLead(), tenantUsers: [ADMIN_USER] });
    const { db, agentApprovals, aiWriteActions, crashController } = fakeDb();
    await draftUpdateLeadStageWrite(db, "run-1", { leadId: LEAD_ID, stageName: "Qualified" });

    const step = fakeMemoizingStep(["approved"], agentApprovals, { decidedBy: "admin-1" });

    crashController.crashNextFinalize = true;
    await expect(runWriteApprovalGate({ step, db, runId: "run-1" })).rejects.toThrow("simulated crash before finalize");

    expect(applyLeadPatchMock).toHaveBeenCalledTimes(1); // ran before the simulated crash
    expect(aiWriteActions).toHaveLength(1);
    expect(aiWriteActions[0].status).toBe("claimed"); // never finalized

    await runWriteApprovalGate({ step, db, runId: "run-1" }); // retry

    expect(applyLeadPatchMock).toHaveBeenCalledTimes(1); // retry did not re-invoke the executor
    expect(aiWriteActions).toHaveLength(1);
    expect(aiWriteActions[0].status).toBe("claimed"); // still stuck — surfaced for human follow-up
  });
});
