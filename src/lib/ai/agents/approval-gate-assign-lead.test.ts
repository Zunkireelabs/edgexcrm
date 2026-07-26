import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { AgentTool } from "@/lib/ai/tools/types";

// assign_lead's approval executor (5.4c-2b) runs the REAL applyLeadPatch (not
// a stub) so this suite proves the slice's actual claim — "executes as the
// approver's real AuthContext, every assignment rule already lives inside
// applyLeadPatch" — for real, the same way approval-gate-update-lead-stage
// proved it for update_lead_stage. Harness copied from that file; the only
// new fixture surface is `lead_notes` (isSelfCheckInAssign's own query) and
// chain-position users (both bypass-path pin tests).
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

// Wrapped (not replaced) so calls can be counted/asserted against, per the
// 5.4c-FIXUP / 5.4c-2a harness this suite reuses.
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
const BRANCH_A = "branch-A";
const NONEXISTENT_LEAD_ID = "99999999-9999-4999-8999-999999999999";
const OTHER_TENANT_ASSIGNEE_ID = "88888888-8888-4888-8888-888888888888";

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
  positions: { slug: string; permissions: Record<string, unknown> } | null;
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
const ASSIGNEE_USER: TenantUserRow = {
  user_id: "assignee-1",
  tenant_id: TENANT_ID,
  role: "counselor",
  position_id: null,
  branch_id: null,
  tenants: { industry_id: "education_consultancy", plan: "free", entitlement_overrides: {} },
  positions: null,
};
// A chain-position (lead-executive) caller, own-scope + canAssignLeads — the
// two bypass paths (isSelfCheckInAssign / isCrossBranchPooledAssign) only
// ever fire for this shape of caller (see ASSIGN_CHAIN_POSITIONS).
const LEAD_EXEC_USER: TenantUserRow = {
  user_id: "lead-exec-1",
  tenant_id: TENANT_ID,
  role: "counselor",
  position_id: "pos-lead-exec",
  branch_id: BRANCH_A,
  tenants: { industry_id: "education_consultancy", plan: "free", entitlement_overrides: {} },
  positions: { slug: "lead-executive", permissions: { leadScope: "own", canAssignLeads: true, nav: { mode: "all" }, pipelines: { mode: "all" }, dashboard: { widgets: { mode: "all" } } } },
};
// Peer of LEAD_EXEC_USER (same position, same branch) — the cross-branch-pool
// path only allows assigning to self/same-position peers, never a forward hop.
const LEAD_EXEC_PEER: TenantUserRow = {
  user_id: "lead-exec-peer-1",
  tenant_id: TENANT_ID,
  role: "counselor",
  position_id: "pos-lead-exec",
  branch_id: BRANCH_A,
  tenants: { industry_id: "education_consultancy", plan: "free", entitlement_overrides: {} },
  positions: { slug: "lead-executive", permissions: { leadScope: "own", canAssignLeads: true, nav: { mode: "all" }, pipelines: { mode: "all" }, dashboard: { widgets: { mode: "all" } } } },
};
// The forward target for the self-check-in path (lead-executive -> counselor).
// Same branch as LEAD_EXEC_USER — the forward chain check's okBranch also
// requires the target to be in the caller's branch once the caller has one.
const COUNSELOR_TARGET: TenantUserRow = {
  user_id: "counselor-target-1",
  tenant_id: TENANT_ID,
  role: "counselor",
  position_id: null,
  branch_id: BRANCH_A,
  tenants: { industry_id: "education_consultancy", plan: "free", entitlement_overrides: {} },
  positions: null,
};

interface FakeServiceClientOptions {
  lead?: Record<string, unknown> | null;
  tenantUsers?: TenantUserRow[];
  corruptUpdateReturnId?: boolean;
  /** lead_notes rows — only content/user_id/lead_id matter for the `.like("content", "[CHECK-IN]%")` count. */
  leadNotes?: Array<{ lead_id: string; user_id: string; content: string }>;
}

/** Fakes createServiceClient() — the internal client applyLeadPatch AND buildUserAuthContext both call fresh each invocation. */
function makeServiceClientFake(opts: FakeServiceClientOptions) {
  let leadRow = opts.lead ?? null;
  const tenantUsers = opts.tenantUsers ?? [];
  const leadNotes = opts.leadNotes ?? [];

  function resolve(table: string, state: { eq: Record<string, unknown>; like?: [string, string]; updateValues?: Record<string, unknown> }) {
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
    if (table === "lead_notes") {
      const leadId = state.eq.lead_id as string | undefined;
      const userId = state.eq.user_id as string | undefined;
      const prefix = state.like?.[1]?.replace(/%$/, "") ?? "";
      const count = leadNotes.filter(
        (n) => n.lead_id === leadId && n.user_id === userId && n.content.startsWith(prefix),
      ).length;
      return { data: null, error: null, count };
    }
    return { data: null, error: null };
  }

  function chain(table: string) {
    const state: { eq: Record<string, unknown>; like?: [string, string]; updateValues?: Record<string, unknown> } = { eq: {} };
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
      like(col: string, pattern: string) {
        state.like = [col, pattern];
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
      then(onFulfilled: (v: { data: unknown; error: unknown; count?: number }) => unknown, onRejected?: (e: unknown) => unknown) {
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

// ── approval-gate's own ScopedClient fake (agent_outputs/approvals/runs/ai_write_actions) ──

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
      // 5.4d: runWriteApprovalGate's mark-awaiting-approval/mark-approvals-settled
      // steps write agent_runs.status directly.
      update: (values: Record<string, unknown>) => {
        const filters: Array<[string, unknown]> = [];
        const chain = {
          eq: (col: string, val: unknown) => {
            filters.push([col, val]);
            return chain;
          },
          then: (resolve: (v: unknown) => void) => {
            const row = agentRuns.find((r) => filters.every(([c, v]) => (r as never)[c] === v));
            if (row) Object.assign(row, values);
            resolve({ error: null });
          },
        };
        return chain;
      },
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
          then: (resolve: (v: unknown) => void) => {
            const row = aiWriteActions.find((r) => filters.every(([c, v]) => (r as never)[c] === v));
            if (row) Object.assign(row, values);
            resolve({ error: null });
          },
        };
        return chain;
      },
    };
  }

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
  return { db: db as never, agentOutputs, agentApprovals, agentRuns, aiWriteActions };
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

const ASSIGN_LEAD_TOOL_FIXTURE: AgentTool = {
  id: "assign_lead",
  description: "fixture standing in for the real assign_lead tool",
  inputSchema: z.object({ leadId: z.string().optional(), assigneeId: z.string().optional() }),
  scope: "write",
  execute: vi.fn(async () => ({ ok: true })),
};

async function draftAssignLeadWrite(db: ReturnType<typeof fakeDb>["db"], runId: string, input: Record<string, unknown>) {
  const toolset = buildPolicyEnforcedWriteTools([ASSIGN_LEAD_TOOL_FIXTURE], {
    db,
    tenantId: TENANT_ID,
    agentId: "agent-1",
    runId,
    subjectType: "lead",
    subjectId: LEAD_ID,
  });
  const tool = toolset.assign_lead as unknown as {
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

describe("runWriteApprovalGate — assign_lead execution (5.4c-2b)", () => {
  it("agent_human approved (owner approver): assigns exactly one row and captures the previous assignee", async () => {
    await setFakeServiceClient({ lead: makeLead(), tenantUsers: [ADMIN_USER, ASSIGNEE_USER] });
    const { db, agentApprovals, aiWriteActions } = fakeDb();
    await draftAssignLeadWrite(db, "run-1", { leadId: LEAD_ID, assigneeId: ASSIGNEE_USER.user_id });

    await runWriteApprovalGate({ step: fakeApprovalDecisionStep(["approved"], agentApprovals, "admin-1"), db, runId: "run-1" });

    expect(applyLeadPatchMock).toHaveBeenCalledTimes(1);
    const authArg = applyLeadPatchMock.mock.calls[0][0];
    expect(authArg).toMatchObject({ userId: "admin-1", tenantId: TENANT_ID, role: "owner" });

    expect(aiWriteActions).toHaveLength(1);
    expect(aiWriteActions[0]).toMatchObject({
      user_id: "admin-1",
      agent_id: "agent-1",
      run_id: "run-1",
      tool_id: "assign_lead",
      tool_call_id: agentApprovals[0].id,
      status: "executed",
    });
    const result = aiWriteActions[0].result as { leadId: string; assignedTo: string; previous: Record<string, unknown> };
    expect(result).toMatchObject({ leadId: LEAD_ID, assignedTo: ASSIGNEE_USER.user_id, previous: { assigned_to: null } });
  });

  it("assignee is not a tenant member (valid UUID, no matching row) → validation failure, zero mutation", async () => {
    const client = await setFakeServiceClient({ lead: makeLead(), tenantUsers: [ADMIN_USER] });
    const { db, agentApprovals, aiWriteActions } = fakeDb();
    await draftAssignLeadWrite(db, "run-1", { leadId: LEAD_ID, assigneeId: OTHER_TENANT_ASSIGNEE_ID });

    await runWriteApprovalGate({ step: fakeApprovalDecisionStep(["approved"], agentApprovals, "admin-1"), db, runId: "run-1" });

    expect(applyLeadPatchMock).toHaveBeenCalledTimes(1);
    expect(client._lead()).toMatchObject({ id: LEAD_ID, assigned_to: null }); // unchanged

    expect(aiWriteActions).toHaveLength(1);
    expect(aiWriteActions[0].status).toBe("failed");
    expect(aiWriteActions[0].error as string).toContain("not a member of this tenant");
  });

  it("approver lacks canAssignLeads (owns the lead, but assigned_to is admin-only for them) → refused, zero mutation", async () => {
    // COUNSELOR_USER: default (no position) counselor permissions → canAssignLeads
    // is false. Made the lead's own assignee so requireLeadAccess itself would
    // pass — isolating this test to the ADMIN_ONLY_FIELDS gate specifically,
    // not conflated with the separate "can't access the lead" failure below.
    const client = await setFakeServiceClient({
      lead: makeLead({ assigned_to: "counselor-1" }),
      tenantUsers: [COUNSELOR_USER, ASSIGNEE_USER],
    });
    const { db, agentApprovals, aiWriteActions } = fakeDb();
    await draftAssignLeadWrite(db, "run-1", { leadId: LEAD_ID, assigneeId: ASSIGNEE_USER.user_id });

    await runWriteApprovalGate({ step: fakeApprovalDecisionStep(["approved"], agentApprovals, "counselor-1"), db, runId: "run-1" });

    expect(applyLeadPatchMock).toHaveBeenCalledTimes(1);
    expect(client._lead()).toMatchObject({ id: LEAD_ID, assigned_to: "counselor-1" }); // unchanged

    expect(aiWriteActions).toHaveLength(1);
    expect(aiWriteActions[0].status).toBe("failed");
  });

  it("approver can't access the lead (counselor who doesn't own it) → forbidden, zero mutation", async () => {
    const client = await setFakeServiceClient({
      lead: makeLead({ assigned_to: "someone-else" }),
      tenantUsers: [COUNSELOR_USER, ASSIGNEE_USER],
    });
    const { db, agentApprovals, aiWriteActions } = fakeDb();
    await draftAssignLeadWrite(db, "run-1", { leadId: LEAD_ID, assigneeId: ASSIGNEE_USER.user_id });

    await runWriteApprovalGate({ step: fakeApprovalDecisionStep(["approved"], agentApprovals, "counselor-1"), db, runId: "run-1" });

    expect(applyLeadPatchMock).toHaveBeenCalledTimes(1);
    const authArg = applyLeadPatchMock.mock.calls[0][0];
    expect(authArg).toMatchObject({ userId: "counselor-1", role: "counselor" });
    expect(client._lead()).toMatchObject({ id: LEAD_ID, assigned_to: "someone-else" }); // unchanged

    expect(aiWriteActions).toHaveLength(1);
    expect(aiWriteActions[0].status).toBe("failed");
  });

  it("hallucinated leadId (valid UUID, doesn't exist in this tenant) → not_found, zero mutation", async () => {
    const client = await setFakeServiceClient({ lead: makeLead(), tenantUsers: [ADMIN_USER, ASSIGNEE_USER] });
    const { db, agentApprovals, aiWriteActions } = fakeDb();
    await draftAssignLeadWrite(db, "run-1", { leadId: NONEXISTENT_LEAD_ID, assigneeId: ASSIGNEE_USER.user_id });

    await runWriteApprovalGate({ step: fakeApprovalDecisionStep(["approved"], agentApprovals, "admin-1"), db, runId: "run-1" });

    expect(applyLeadPatchMock).toHaveBeenCalledTimes(1);
    expect(client._lead()).toMatchObject({ id: LEAD_ID, assigned_to: null }); // real lead untouched

    expect(aiWriteActions).toHaveLength(1);
    expect(aiWriteActions[0]).toMatchObject({ status: "failed", error: "Lead not found." });
  });

  it("missing leadId → assertMandatoryRowFilter refuses before any DB call", async () => {
    const client = await setFakeServiceClient({ lead: makeLead(), tenantUsers: [ADMIN_USER, ASSIGNEE_USER] });
    const { db, agentApprovals, aiWriteActions } = fakeDb();
    await draftAssignLeadWrite(db, "run-1", { assigneeId: ASSIGNEE_USER.user_id }); // no leadId key at all

    await runWriteApprovalGate({ step: fakeApprovalDecisionStep(["approved"], agentApprovals, "admin-1"), db, runId: "run-1" });

    expect(applyLeadPatchMock).not.toHaveBeenCalled();
    expect(client._lead()).toMatchObject({ id: LEAD_ID, assigned_to: null });

    expect(aiWriteActions).toHaveLength(1);
    expect(aiWriteActions[0].status).toBe("failed");
    expect(aiWriteActions[0].error as string).toContain("mandatory row-level filter");
  });

  it("returned row identity mismatch → assertSingleRowEffect refuses (no real affected-row count from applyLeadPatch)", async () => {
    await setFakeServiceClient({ lead: makeLead(), tenantUsers: [ADMIN_USER, ASSIGNEE_USER], corruptUpdateReturnId: true });
    const { db, agentApprovals, aiWriteActions } = fakeDb();
    await draftAssignLeadWrite(db, "run-1", { leadId: LEAD_ID, assigneeId: ASSIGNEE_USER.user_id });

    await runWriteApprovalGate({ step: fakeApprovalDecisionStep(["approved"], agentApprovals, "admin-1"), db, runId: "run-1" });

    expect(aiWriteActions).toHaveLength(1);
    expect(aiWriteActions[0].status).toBe("failed");
    expect(aiWriteActions[0].error as string).toContain("row(s)");
  });

  it("human_led: still drafts only — zero approvals, zero ai_write_actions, lead unchanged (DB-diff proof)", async () => {
    resolveAutomationLevelMock.mockResolvedValue("human_led");
    const client = await setFakeServiceClient({ lead: makeLead(), tenantUsers: [ADMIN_USER, ASSIGNEE_USER] });
    const { db, agentOutputs, agentApprovals, aiWriteActions } = fakeDb();
    await draftAssignLeadWrite(db, "run-1", { leadId: LEAD_ID, assigneeId: ASSIGNEE_USER.user_id });

    await runWriteApprovalGate({ step: fakeApprovalDecisionStep([], agentApprovals), db, runId: "run-1" });

    expect(applyLeadPatchMock).not.toHaveBeenCalled();
    expect(client._lead()).toMatchObject({ id: LEAD_ID, assigned_to: null });
    expect(agentOutputs).toHaveLength(1); // the draft itself
    expect(agentApprovals).toHaveLength(0);
    expect(aiWriteActions).toHaveLength(0);
  });
});

describe("runWriteApprovalGate — assign_lead bypass paths pinned (5.4c-2b)", () => {
  it("isSelfCheckInAssign: an own-scope chain-position approver who checked this unassigned lead in may assign it to the next chain position, bypassing requireLeadAccess", async () => {
    await setFakeServiceClient({
      lead: makeLead({ assigned_to: null }), // unassigned — required for the bypass
      tenantUsers: [LEAD_EXEC_USER, COUNSELOR_TARGET],
      leadNotes: [{ lead_id: LEAD_ID, user_id: LEAD_EXEC_USER.user_id, content: "[CHECK-IN] walked in" }],
    });
    const { db, agentApprovals, aiWriteActions } = fakeDb();
    await draftAssignLeadWrite(db, "run-1", { leadId: LEAD_ID, assigneeId: COUNSELOR_TARGET.user_id });

    await runWriteApprovalGate({
      step: fakeApprovalDecisionStep(["approved"], agentApprovals, LEAD_EXEC_USER.user_id),
      db,
      runId: "run-1",
    });

    expect(applyLeadPatchMock).toHaveBeenCalledTimes(1);
    expect(aiWriteActions).toHaveLength(1);
    expect(aiWriteActions[0].status).toBe("executed"); // requireLeadAccess would otherwise have refused an own-scope non-assignee
    const result = aiWriteActions[0].result as { assignedTo: string };
    expect(result.assignedTo).toBe(COUNSELOR_TARGET.user_id);
  });

  it("isSelfCheckInAssign does NOT fire without a matching [CHECK-IN] note — falls through to requireLeadAccess and is refused", async () => {
    const client = await setFakeServiceClient({
      lead: makeLead({ assigned_to: null }),
      tenantUsers: [LEAD_EXEC_USER, COUNSELOR_TARGET],
      leadNotes: [], // no check-in note recorded
    });
    const { db, agentApprovals, aiWriteActions } = fakeDb();
    await draftAssignLeadWrite(db, "run-1", { leadId: LEAD_ID, assigneeId: COUNSELOR_TARGET.user_id });

    await runWriteApprovalGate({
      step: fakeApprovalDecisionStep(["approved"], agentApprovals, LEAD_EXEC_USER.user_id),
      db,
      runId: "run-1",
    });

    expect(client._lead()).toMatchObject({ id: LEAD_ID, assigned_to: null }); // unchanged
    expect(aiWriteActions).toHaveLength(1);
    expect(aiWriteActions[0].status).toBe("failed");
  });

  it("isCrossBranchPooledAssign: an own-scope chain-position approver may claim an unassigned cross-branch-pooled lead for a same-position peer, bypassing requireLeadAccess", async () => {
    getLeadMembershipMock.mockResolvedValue([{ branch_id: BRANCH_A, assigned_to: null, is_origin: false }]);
    await setFakeServiceClient({
      lead: makeLead({ assigned_to: null, list_id: TARGET_LIST_ID }), // list slug "qualified" matches lead-executive's route
      tenantUsers: [LEAD_EXEC_USER, LEAD_EXEC_PEER],
      leadNotes: [], // no check-in note — proves this is the pool path, not self-check-in
    });
    const { db, agentApprovals, aiWriteActions } = fakeDb();
    await draftAssignLeadWrite(db, "run-1", { leadId: LEAD_ID, assigneeId: LEAD_EXEC_PEER.user_id });

    await runWriteApprovalGate({
      step: fakeApprovalDecisionStep(["approved"], agentApprovals, LEAD_EXEC_USER.user_id),
      db,
      runId: "run-1",
    });

    expect(applyLeadPatchMock).toHaveBeenCalledTimes(1);
    expect(aiWriteActions).toHaveLength(1);
    expect(aiWriteActions[0].status).toBe("executed"); // requireLeadAccess would otherwise have refused an own-scope non-assignee
    const result = aiWriteActions[0].result as { assignedTo: string };
    expect(result.assignedTo).toBe(LEAD_EXEC_PEER.user_id);
  });

  it("isCrossBranchPooledAssign does NOT let the pool caller reach past a peer to the forward chain position — refused", async () => {
    getLeadMembershipMock.mockResolvedValue([{ branch_id: BRANCH_A, assigned_to: null, is_origin: false }]);
    const client = await setFakeServiceClient({
      lead: makeLead({ assigned_to: null, list_id: TARGET_LIST_ID }),
      tenantUsers: [LEAD_EXEC_USER, COUNSELOR_TARGET], // forward hop, not a peer
      leadNotes: [],
    });
    const { db, agentApprovals, aiWriteActions } = fakeDb();
    await draftAssignLeadWrite(db, "run-1", { leadId: LEAD_ID, assigneeId: COUNSELOR_TARGET.user_id });

    await runWriteApprovalGate({
      step: fakeApprovalDecisionStep(["approved"], agentApprovals, LEAD_EXEC_USER.user_id),
      db,
      runId: "run-1",
    });

    expect(client._lead()).toMatchObject({ id: LEAD_ID, assigned_to: null }); // unchanged
    expect(aiWriteActions).toHaveLength(1);
    expect(aiWriteActions[0].status).toBe("failed");
  });
});
