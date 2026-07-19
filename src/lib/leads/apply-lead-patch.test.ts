import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";
import type { ResolvedPermissions } from "@/lib/api/permissions";

const resolvePositionSlugMock = vi.fn(async () => null as string | null);
const getLeadMembershipMock = vi.fn(async () => [] as Array<{ branch_id: string; assigned_to: string | null; is_origin: boolean }>);
const syncOriginMembershipMock = vi.fn(async () => {});
const addLeadCollaboratorMock = vi.fn(async () => {});
const assignDisplayIdsMock = vi.fn(async () => {});
const getPipelineLandingStageMock = vi.fn(async () => null as { id: string; slug: string } | null);
const createAuditLogMock = vi.fn(async () => {});
const emitEventMock = vi.fn(async () => "event-1");
const createNotificationsExceptMock = vi.fn(async () => {});
const getTenantAdminRecipientsMock = vi.fn(async () => [] as string[]);
const sendLeadAssignedEmailMock = vi.fn(async () => {});
const processEmailForwardRulesMock = vi.fn(async () => {});

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, resolvePositionSlug: resolvePositionSlugMock };
});
vi.mock("@/lib/leads/branch-membership", () => ({
  getLeadMembership: getLeadMembershipMock,
  syncOriginMembership: syncOriginMembershipMock,
}));
vi.mock("@/lib/leads/collaborators", () => ({
  addLeadCollaborator: addLeadCollaboratorMock,
}));
vi.mock("@/lib/leads/assign-display-ids", () => ({
  assignDisplayIds: assignDisplayIdsMock,
}));
vi.mock("@/lib/leads/pipeline-stage", () => ({
  getPipelineLandingStage: getPipelineLandingStageMock,
}));
vi.mock("@/lib/api/audit", () => ({
  createAuditLog: createAuditLogMock,
  emitEvent: emitEventMock,
}));
vi.mock("@/lib/notifications", () => ({
  NotificationTypes: {
    LEAD_ASSIGNED: "lead.assigned",
    LEAD_UNASSIGNED: "lead.unassigned",
    LEAD_STAGE_CHANGED: "lead.stage_changed",
  },
  createNotificationsExcept: createNotificationsExceptMock,
  getTenantAdminRecipients: getTenantAdminRecipientsMock,
}));
vi.mock("@/lib/email/send-lead-assigned", () => ({
  sendLeadAssignedEmail: sendLeadAssignedEmailMock,
}));
vi.mock("@/lib/email/email-forward", () => ({
  processEmailForwardRules: processEmailForwardRulesMock,
}));
vi.mock("@/lib/logger", () => ({
  createRequestLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}));

// ── Scripted fake supabase client ──────────────────────────────────────
// Keyed by table name; each table's rows are looked up by whichever `.eq()`
// filter the real code applies (usually "id" or "user_id"). Callers supply
// only the tables/rows their scenario touches — everything else 404s clean
// (maybeSingle -> null, single -> null+error) rather than throwing, so an
// unexercised code path just sees "not found" instead of crashing the test.
interface QueryState {
  table: string;
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
  updateValues?: Record<string, unknown>;
  insertValues?: Record<string, unknown>;
}

type RowMap = Record<string, Record<string, unknown>>;

interface FakeDbOptions {
  leads?: Record<string, unknown>; // the existingLead row, keyed by id
  tenantUsers?: RowMap; // keyed by user_id
  leadLists?: RowMap; // keyed by id
  pipelineStages?: RowMap; // keyed by id
  leadAssignmentHistory?: Array<{ lead_id: string; to_user_id: string; from_user_id: string | null }>;
  tenants?: Record<string, unknown>;
}

function makeFakeDb(opts: FakeDbOptions) {
  const inserts: Record<string, unknown[]> = {};
  const updates: Record<string, unknown[]> = {};

  function resolve(state: QueryState): { data: unknown; error: unknown } {
    const { table } = state;

    if (table === "leads") {
      if (state.updateValues) {
        const merged = { ...(opts.leads ?? {}), ...state.updateValues };
        return { data: merged, error: null };
      }
      const id = state.eq.id as string | undefined;
      const row = id && opts.leads && opts.leads.id === id ? opts.leads : null;
      return { data: row, error: row ? null : { message: "not found" } };
    }

    if (table === "tenant_users") {
      if (state.in.user_id) {
        const rows = state.in.user_id
          .map((uid) => (opts.tenantUsers ?? {})[uid as string])
          .filter(Boolean)
          .map((r) => ({ user_id: r!.user_id, position_id: r!.position_id ?? null }));
        return { data: rows, error: null };
      }
      const uid = state.eq.user_id as string | undefined;
      const row = uid ? (opts.tenantUsers ?? {})[uid] ?? null : null;
      return { data: row, error: null };
    }

    if (table === "lead_lists") {
      const id = state.eq.id as string | undefined;
      const row = id ? (opts.leadLists ?? {})[id] ?? null : null;
      return { data: row, error: null };
    }

    if (table === "pipeline_stages") {
      const id = state.eq.id as string | undefined;
      const row = id ? (opts.pipelineStages ?? {})[id] ?? null : null;
      return { data: row, error: null };
    }

    if (table === "lead_assignment_history") {
      if (state.insertValues) {
        inserts.lead_assignment_history = inserts.lead_assignment_history ?? [];
        inserts.lead_assignment_history.push(state.insertValues);
        return { data: null, error: null };
      }
      const leadId = state.eq.lead_id as string | undefined;
      const toUserId = state.eq.to_user_id as string | undefined;
      const match = (opts.leadAssignmentHistory ?? []).find((h) => h.lead_id === leadId && h.to_user_id === toUserId);
      return { data: match ? { from_user_id: match.from_user_id } : null, error: null };
    }

    if (table === "lead_branches") {
      updates.lead_branches = updates.lead_branches ?? [];
      updates.lead_branches.push(state.updateValues ?? {});
      return { data: null, error: null };
    }

    if (table === "tenants") {
      return { data: opts.tenants ?? { name: "Test Tenant", primary_color: null }, error: null };
    }

    if (table === "lead_notes") {
      return { data: null, error: null };
    }

    // Any other table (pipelines, tenant_entities, branches, ...) not needed
    // by the scenarios below — clean "not found" rather than a throw.
    return { data: null, error: null };
  }

  function chain(table: string) {
    const state: QueryState = { table, eq: {}, in: {} };
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
      in(col: string, vals: unknown[]) {
        state.in[col] = vals;
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
        updates[table] = updates[table] ?? [];
        updates[table].push(values);
        return builder;
      },
      insert(values: Record<string, unknown>) {
        state.insertValues = values;
        inserts[table] = inserts[table] ?? [];
        inserts[table].push(values);
        return builder;
      },
      async single() {
        const r = resolve(state);
        return { data: r.data, error: r.data ? null : (r.error ?? { message: "not found" }) };
      },
      async maybeSingle() {
        const r = resolve(state);
        return { data: r.data, error: null };
      },
      then(onFulfilled: (v: { data: unknown; error: unknown }) => unknown, onRejected?: (e: unknown) => unknown) {
        return Promise.resolve(resolve(state)).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  return {
    from: (table: string) => chain(table),
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: "assignee@example.com" } } }),
      },
    },
    _inserts: inserts,
    _updates: updates,
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));

async function setFakeDb(opts: FakeDbOptions) {
  const { createServiceClient } = await import("@/lib/supabase/server");
  const db = makeFakeDb(opts);
  (createServiceClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(db);
  return db;
}

function fixtureAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  const permissions: ResolvedPermissions = {
    baseTier: "member",
    allowedNavKeys: null,
    pipelineAccess: "all",
    listAccess: "all",
    leadScope: "own",
    sharedPoolListIds: new Set(),
    canAssignLeads: false,
    canEditLeads: true,
    canManageApplications: false,
    canManageClasses: false,
    canManageHR: false,
    canExport: false,
    dashboardWidgets: null,
    ...(overrides.permissions ?? {}),
  };
  return {
    userId: "user-1",
    email: "user1@example.com",
    tenantId: "tenant-1",
    role: "counselor",
    industryId: "education_consultancy",
    positionId: "pos-1",
    positionSlug: null,
    branchId: null,
    branchMemberIds: [],
    plan: "free",
    entitlements: {} as AuthContext["entitlements"],
    ...overrides,
    permissions,
  };
}

const OPTS = { requestId: "req-1", ip: null, userAgent: null };

beforeEach(() => {
  resolvePositionSlugMock.mockReset().mockResolvedValue(null);
  getLeadMembershipMock.mockReset().mockResolvedValue([]);
  syncOriginMembershipMock.mockClear();
  addLeadCollaboratorMock.mockClear();
  assignDisplayIdsMock.mockClear();
  getPipelineLandingStageMock.mockReset().mockResolvedValue(null);
  createAuditLogMock.mockClear();
  emitEventMock.mockClear();
  createNotificationsExceptMock.mockClear();
  getTenantAdminRecipientsMock.mockClear();
  sendLeadAssignedEmailMock.mockClear();
  processEmailForwardRulesMock.mockClear();
});

describe("applyLeadPatch — governance branches", () => {
  it("counselor (member+own, no canAssignLeads) is blocked on assigned_to", async () => {
    await setFakeDb({ leads: { id: "lead-1", pipeline_id: "pipe-1", assigned_to: "user-1", branch_id: null, list_id: null } });
    const auth = fixtureAuth({ permissions: { leadScope: "own", canAssignLeads: false } as ResolvedPermissions });
    const { applyLeadPatch } = await import("./apply-lead-patch");
    const outcome = await applyLeadPatch(auth, "lead-1", { assigned_to: "other-user" }, OPTS);
    expect(outcome).toEqual({ kind: "forbidden" });
  });

  it("canAssignLeads caller may set assigned_to but is still blocked on branch_id", async () => {
    await setFakeDb({ leads: { id: "lead-1", pipeline_id: "pipe-1", assigned_to: "user-1", branch_id: null, list_id: null } });
    const auth = fixtureAuth({ permissions: { leadScope: "own", canAssignLeads: true } as ResolvedPermissions });
    const { applyLeadPatch } = await import("./apply-lead-patch");
    const outcome = await applyLeadPatch(auth, "lead-1", { assigned_to: "other-user", branch_id: "branch-2" }, OPTS);
    expect(outcome).toEqual({ kind: "forbidden" });
  });

  it("§4.2 — a team-scoped manager cannot touch a lead that isn't in their branch (even if assigned to a branch member)", async () => {
    await setFakeDb({
      leads: { id: "lead-1", pipeline_id: "pipe-1", assigned_to: "member-x", branch_id: "branch-other", list_id: null },
      tenantUsers: { "member-y": { user_id: "member-y", branch_id: "branch-mgr", role: "counselor", positions: { slug: "counselor" } } },
    });
    const auth = fixtureAuth({
      branchId: "branch-mgr",
      branchMemberIds: ["member-x"],
      permissions: { leadScope: "team", canAssignLeads: true } as ResolvedPermissions,
    });
    const { applyLeadPatch } = await import("./apply-lead-patch");
    const outcome = await applyLeadPatch(auth, "lead-1", { assigned_to: "member-y" }, OPTS);
    expect(outcome).toEqual({ kind: "forbidden" });
  });

  it("§4.2 — a team-scoped manager cannot assign to a target outside their branch", async () => {
    await setFakeDb({
      leads: { id: "lead-1", pipeline_id: "pipe-1", assigned_to: "user-1", branch_id: "branch-mgr", list_id: null },
      tenantUsers: { "member-outside": { user_id: "member-outside", branch_id: "branch-other", role: "counselor", positions: { slug: "counselor" } } },
    });
    const auth = fixtureAuth({
      branchId: "branch-mgr",
      permissions: { leadScope: "team", canAssignLeads: true } as ResolvedPermissions,
    });
    const { applyLeadPatch } = await import("./apply-lead-patch");
    const outcome = await applyLeadPatch(auth, "lead-1", { assigned_to: "member-outside" }, OPTS);
    expect(outcome).toEqual({ kind: "forbidden" });
  });

  it("chain forward — an allowed chain target (lead-executive -> counselor, same branch) passes", async () => {
    await setFakeDb({
      leads: { id: "lead-1", pipeline_id: "pipe-1", assigned_to: "user-1", branch_id: null, list_id: null, status: "s", lead_type: "lead" },
      tenantUsers: { "counselor-user": { user_id: "counselor-user", branch_id: "branch-1", role: "counselor", positions: { slug: "counselor" } } },
    });
    const auth = fixtureAuth({
      positionSlug: "lead-executive",
      branchId: "branch-1",
      permissions: { leadScope: "own", canAssignLeads: true } as ResolvedPermissions,
    });
    const { applyLeadPatch } = await import("./apply-lead-patch");
    const outcome = await applyLeadPatch(auth, "lead-1", { assigned_to: "counselor-user" }, OPTS);
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.lead.assigned_to).toBe("counselor-user");
      expect(outcome.previousValues.assigned_to).toBe("user-1");
    }
  });

  it("chain forward — a non-chain target is forbidden", async () => {
    await setFakeDb({
      leads: { id: "lead-1", pipeline_id: "pipe-1", assigned_to: "user-1", branch_id: null, list_id: null },
      tenantUsers: { "other-branch-mgr": { user_id: "other-branch-mgr", branch_id: "branch-1", role: "branch-manager", positions: { slug: "branch-manager" } } },
    });
    const auth = fixtureAuth({
      positionSlug: "lead-executive",
      branchId: "branch-1",
      permissions: { leadScope: "own", canAssignLeads: true } as ResolvedPermissions,
    });
    const { applyLeadPatch } = await import("./apply-lead-patch");
    const outcome = await applyLeadPatch(auth, "lead-1", { assigned_to: "other-branch-mgr" }, OPTS);
    expect(outcome).toEqual({ kind: "forbidden" });
  });

  it("revert — reassigning to the previous holder is allowed", async () => {
    await setFakeDb({
      leads: {
        id: "lead-1", pipeline_id: "pipe-1", assigned_to: "user-1", branch_id: null,
        list_id: "list-b", status: "s", lead_type: "lead",
      },
      leadLists: {
        "list-a": { id: "list-a", slug: "list-a", name: "List A", pipeline_id: null, is_archive: false, sort_order: 10, access: { mode: "all" } },
        "list-b": { id: "list-b", slug: "list-b", name: "List B", pipeline_id: null, is_archive: false, sort_order: 20, access: { mode: "all" } },
      },
      leadAssignmentHistory: [{ lead_id: "lead-1", to_user_id: "user-1", from_user_id: "prev-holder" }],
      tenantUsers: {
        "prev-holder": { user_id: "prev-holder", branch_id: "branch-1", role: "counselor", positions: { slug: "counselor" } },
      },
    });
    const auth = fixtureAuth({
      positionSlug: "counselor",
      branchId: "branch-1",
      permissions: { leadScope: "own", canAssignLeads: true } as ResolvedPermissions,
    });
    const { applyLeadPatch } = await import("./apply-lead-patch");
    // caller isn't in tenantUsers map, but as the assignee we don't need memberCheck on the caller —
    // only the incoming assigned_to ("prev-holder") is looked up. Provide that above.
    const outcome = await applyLeadPatch(auth, "lead-1", { list_id: "list-a", assigned_to: "prev-holder" }, OPTS);
    expect(outcome.kind).toBe("ok");
  });

  it("revert — reassigning to a non-peer is forbidden", async () => {
    await setFakeDb({
      leads: { id: "lead-1", pipeline_id: "pipe-1", assigned_to: "user-1", branch_id: null, list_id: "list-b", status: "s" },
      leadLists: {
        "list-a": { id: "list-a", slug: "list-a", name: "List A", pipeline_id: null, is_archive: false, sort_order: 10 },
        "list-b": { id: "list-b", slug: "list-b", name: "List B", pipeline_id: null, is_archive: false, sort_order: 20 },
      },
      leadAssignmentHistory: [{ lead_id: "lead-1", to_user_id: "user-1", from_user_id: "prev-holder" }],
      tenantUsers: {
        "prev-holder": { user_id: "prev-holder", branch_id: "branch-1", role: "counselor", positions: { slug: "counselor" } },
        "not-a-peer": { user_id: "not-a-peer", branch_id: "branch-1", role: "application-executive", positions: { slug: "application-executive" } },
      },
    });
    const auth = fixtureAuth({
      positionSlug: "counselor",
      branchId: "branch-1",
      permissions: { leadScope: "own", canAssignLeads: true } as ResolvedPermissions,
    });
    const { applyLeadPatch } = await import("./apply-lead-patch");
    const outcome = await applyLeadPatch(auth, "lead-1", { list_id: "list-a", assigned_to: "not-a-peer" }, OPTS);
    expect(outcome).toEqual({ kind: "forbidden" });
  });

  it("revert — the first holder (no prior handoff) cannot revert", async () => {
    await setFakeDb({
      leads: { id: "lead-1", pipeline_id: "pipe-1", assigned_to: "user-1", branch_id: null, list_id: "list-b", status: "s" },
      leadLists: {
        "list-a": { id: "list-a", slug: "list-a", name: "List A", pipeline_id: null, is_archive: false, sort_order: 10 },
        "list-b": { id: "list-b", slug: "list-b", name: "List B", pipeline_id: null, is_archive: false, sort_order: 20 },
      },
      leadAssignmentHistory: [], // no prior handoff recorded for user-1
      tenantUsers: {
        "someone-else": { user_id: "someone-else", branch_id: "branch-1", role: "counselor", positions: { slug: "counselor" } },
      },
    });
    const auth = fixtureAuth({
      positionSlug: "counselor",
      branchId: "branch-1",
      permissions: { leadScope: "own", canAssignLeads: true } as ResolvedPermissions,
    });
    const { applyLeadPatch } = await import("./apply-lead-patch");
    const outcome = await applyLeadPatch(auth, "lead-1", { list_id: "list-a", assigned_to: "someone-else" }, OPTS);
    expect(outcome).toEqual({ kind: "forbidden", message: "First holder cannot revert this lead" });
  });

  it("a list the caller cannot access is forbidden", async () => {
    await setFakeDb({
      leads: { id: "lead-1", pipeline_id: "pipe-1", assigned_to: "user-1", branch_id: null, list_id: null },
      leadLists: {
        "admin-list": { id: "admin-list", slug: "admin-only", name: "Admin Only", is_archive: false, access: { mode: "allow", positionIds: ["some-other-position"] } },
      },
    });
    const auth = fixtureAuth({
      positionId: "pos-1",
      permissions: { leadScope: "own", listAccess: "all" } as ResolvedPermissions,
    });
    const { applyLeadPatch } = await import("./apply-lead-patch");
    const outcome = await applyLeadPatch(auth, "lead-1", { list_id: "admin-list" }, OPTS);
    expect(outcome).toEqual({ kind: "forbidden" });
  });

  it("prospect gate — moving to Prospects without a qualifying academic record is a validation error", async () => {
    await setFakeDb({
      leads: { id: "lead-1", pipeline_id: "pipe-1", assigned_to: "user-1", branch_id: null, list_id: "list-qualified", status: "s" },
      leadLists: {
        "list-qualified": { id: "list-qualified", slug: "qualified", name: "Qualified", is_archive: false, sort_order: 10 },
        "list-prospects": { id: "list-prospects", slug: "prospects", name: "Prospects", pipeline_id: null, is_archive: false, sort_order: 20, access: { mode: "all" } },
      },
    });
    const auth = fixtureAuth({ permissions: { leadScope: "own" } as ResolvedPermissions });
    const { applyLeadPatch } = await import("./apply-lead-patch");
    const outcome = await applyLeadPatch(auth, "lead-1", { list_id: "list-prospects" }, OPTS);
    expect(outcome).toEqual({
      kind: "validation",
      errors: { academic: ["Add the student's highest qualification (%/GPA) before moving to Prospects."] },
    });
  });

  // Regression guard for PRs #235/#236, whose bypass lived in the PATCH route
  // before Phase 4B extracted that route's body into apply-lead-patch.ts. The
  // extraction predated the bypass, so rebasing onto stage dropped it here
  // silently — this file was new on the branch, so git merged it clean while
  // the only conflict surfaced in the route it came from. These three assert
  // the bypass survives any future move of this logic.
  const PROSPECT_MOVE_DB = {
    leads: { id: "lead-1", pipeline_id: "pipe-1", assigned_to: "user-1", branch_id: null, list_id: "list-qualified", status: "s" },
    leadLists: {
      "list-qualified": { id: "list-qualified", slug: "qualified", name: "Qualified", is_archive: false, sort_order: 10 },
      "list-prospects": { id: "list-prospects", slug: "prospects", name: "Prospects", pipeline_id: null, is_archive: false, sort_order: 20, access: { mode: "all" } },
    },
  };

  it("prospect gate — an owner may move an unqualified lead to Prospects (bypass)", async () => {
    await setFakeDb(PROSPECT_MOVE_DB);
    const auth = fixtureAuth({ permissions: { leadScope: "all", baseTier: "owner" } as ResolvedPermissions });
    const { applyLeadPatch } = await import("./apply-lead-patch");
    const outcome = await applyLeadPatch(auth, "lead-1", { list_id: "list-prospects" }, OPTS);
    expect(outcome.kind).not.toBe("validation");
  });

  it("prospect gate — an admin may move an unqualified lead to Prospects (bypass)", async () => {
    await setFakeDb(PROSPECT_MOVE_DB);
    const auth = fixtureAuth({ permissions: { leadScope: "all", baseTier: "admin" } as ResolvedPermissions });
    const { applyLeadPatch } = await import("./apply-lead-patch");
    const outcome = await applyLeadPatch(auth, "lead-1", { list_id: "list-prospects" }, OPTS);
    expect(outcome.kind).not.toBe("validation");
  });

  it("prospect gate — a branch-manager may move an unqualified lead to Prospects (bypass)", async () => {
    await setFakeDb(PROSPECT_MOVE_DB);
    const auth = fixtureAuth({
      positionSlug: "branch-manager",
      permissions: { leadScope: "all" } as ResolvedPermissions,
    });
    const { applyLeadPatch } = await import("./apply-lead-patch");
    const outcome = await applyLeadPatch(auth, "lead-1", { list_id: "list-prospects" }, OPTS);
    expect(outcome.kind).not.toBe("validation");
  });

  it("happy path — a forward stage move returns previousValues with the pre-move list_id/status/stage_id/pipeline_id", async () => {
    await setFakeDb({
      leads: {
        id: "lead-1", pipeline_id: "pipe-old", assigned_to: "user-2", branch_id: null,
        list_id: "list-current", status: "qualified", stage_id: "stage-cur", lead_type: "lead", archive_reason: null, archived_at: null,
      },
      leadLists: {
        "list-current": { id: "list-current", slug: "current", name: "Pre-qualified", pipeline_id: "pipe-old", is_archive: false, sort_order: 10 },
        "list-target": { id: "list-target", slug: "qualified", name: "Qualified", pipeline_id: "pipe-new", is_archive: false, sort_order: 20, access: { mode: "all" } },
      },
      pipelineStages: { "stage-landing": { is_terminal: false } },
    });
    getPipelineLandingStageMock.mockResolvedValue({ id: "stage-landing", slug: "new" });
    const auth = fixtureAuth({ role: "owner", permissions: { baseTier: "owner", leadScope: "all" } as ResolvedPermissions });
    const { applyLeadPatch } = await import("./apply-lead-patch");
    const outcome = await applyLeadPatch(auth, "lead-1", { list_id: "list-target" }, OPTS);

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.previousValues).toMatchObject({
      list_id: "list-current",
      status: "qualified",
      stage_id: "stage-cur",
      pipeline_id: "pipe-old",
    });
    expect(outcome.changes.list).toEqual({ old: "Pre-qualified", new: "Qualified" });
    expect(outcome.changes.list_id).toBeUndefined();
    expect(outcome.lead.pipeline_id).toBe("pipe-new");
    expect(outcome.lead.stage_id).toBe("stage-landing");
    expect(outcome.lead.status).toBe("new");
  });
});
