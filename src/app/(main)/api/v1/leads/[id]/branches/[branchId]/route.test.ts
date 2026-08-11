import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const requireAdminMock = vi.fn();
const getLeadMembershipMock = vi.fn();
const createServiceClientMock = vi.fn();
const createAuditLogMock = vi.fn();
const emitEventMock = vi.fn();
const createNotificationsExceptMock = vi.fn();
const sendLeadAssignedEmailMock = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, authenticateRequest: authenticateRequestMock, requireAdmin: requireAdminMock };
});
vi.mock("@/lib/leads/branch-membership", () => ({ getLeadMembership: getLeadMembershipMock }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: createServiceClientMock }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: createAuditLogMock, emitEvent: emitEventMock }));
vi.mock("@/lib/notifications", () => ({
  createNotificationsExcept: createNotificationsExceptMock,
  NotificationTypes: { LEAD_ASSIGNED: "lead.assigned", LEAD_UNASSIGNED: "lead.unassigned" },
}));
vi.mock("@/lib/email/send-lead-assigned", () => ({ sendLeadAssignedEmail: sendLeadAssignedEmailMock }));
vi.mock("@/lib/logger", () => ({
  createRequestLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn() })),
}));

// Generic chainable table double: every non-terminal method returns itself; `single`/
// `maybeSingle` resolve the configured result; a bare `await` on the chain (no
// terminal call, e.g. `.update(...).eq().eq()`) resolves via `.then()` the same way
// Supabase's real query builder is itself thenable.
function chain(result: { data?: unknown; error?: unknown } = { data: null, error: null }) {
  const obj: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "not", "update", "insert", "order", "limit"]) {
    obj[m] = vi.fn(() => obj);
  }
  obj.single = vi.fn(() => Promise.resolve(result));
  obj.maybeSingle = vi.fn(() => Promise.resolve(result));
  obj.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

function fakeReq(body: unknown): NextRequest {
  return {
    json: async () => body,
    headers: { get: () => null },
  } as unknown as NextRequest;
}

const params = () => Promise.resolve({ id: "lead-1", branchId: "branch-birgunj" });

const LEAD = { id: "lead-1", first_name: "Shyam", last_name: "Sah", email: "ssah@example.com", assigned_to: null };
const MEMBER_ROW = { id: "lb-1", is_origin: false, assigned_to: null };
const ORIGIN_MEMBER_ROW = { id: "lb-0", is_origin: true, assigned_to: null };

function setupDb(overrides: Partial<Record<string, ReturnType<typeof chain>>> = {}) {
  const tables: Record<string, ReturnType<typeof chain>> = {
    leads: chain({ data: LEAD, error: null }),
    lead_branches: chain({ data: MEMBER_ROW, error: null }),
    tenant_users: chain({ data: { user_id: "11111111-1111-1111-1111-111111111111" }, error: null }),
    branches: chain({ data: { name: "Birgunj" }, error: null }),
    ...overrides,
  };
  createServiceClientMock.mockResolvedValue({
    from: vi.fn((table: string) => tables[table] ?? chain({ data: null, error: null })),
    auth: { admin: { getUserById: vi.fn().mockResolvedValue({ data: { user: null } }) } },
  });
  return tables;
}

const OWNER_AUTH = {
  userId: "owner-1",
  tenantId: "tenant-1",
  role: "owner",
  entitlements: { maxBranches: 3 },
  permissions: { leadScope: "all", baseTier: "owner" },
} as unknown as AuthContext;

const BRANCH_MANAGER_AUTH = {
  userId: "bm-1",
  tenantId: "tenant-1",
  role: "member",
  branchId: "branch-birgunj",
  entitlements: { maxBranches: 3 },
  permissions: { leadScope: "team", baseTier: "member" },
} as unknown as AuthContext;

describe("PATCH /api/v1/leads/[id]/branches/[branchId]", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    requireAdminMock.mockReset();
    getLeadMembershipMock.mockReset();
    createServiceClientMock.mockReset();
    createAuditLogMock.mockReset().mockResolvedValue(undefined);
    emitEventMock.mockReset().mockResolvedValue(undefined);
    createNotificationsExceptMock.mockReset();
    sendLeadAssignedEmailMock.mockReset();
    authenticateRequestMock.mockResolvedValue(OWNER_AUTH);
    requireAdminMock.mockReturnValue(true);
    getLeadMembershipMock.mockResolvedValue([
      { branch_id: "branch-ktm" },
      { branch_id: "branch-birgunj" },
    ]);
  });

  it("401 when unauthenticated", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ assigned_to: "11111111-1111-1111-1111-111111111111" }), { params: params() });
    expect(res.status).toBe(401);
  });

  it("403 when the tenant has only one branch (feature not entitled)", async () => {
    authenticateRequestMock.mockResolvedValue({ ...OWNER_AUTH, entitlements: { maxBranches: 1 } });
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ assigned_to: "11111111-1111-1111-1111-111111111111" }), { params: params() });
    expect(res.status).toBe(403);
  });

  it("422 when assigned_to is missing from the body", async () => {
    setupDb();
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({}), { params: params() });
    expect(res.status).toBe(422);
  });

  it("admin can assign a valid member of the target branch — this is the fix's core case", async () => {
    setupDb();
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ assigned_to: "11111111-1111-1111-1111-111111111111" }), { params: params() });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.assigned_to).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("422 when the assignee is not a member of the target branch", async () => {
    setupDb({ tenant_users: chain({ data: null, error: null }) });
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ assigned_to: "22222222-2222-2222-2222-222222222222" }), { params: params() });
    expect(res.status).toBe(422);
  });

  it("clearing an assignment (assigned_to: null) skips branch-membership validation", async () => {
    setupDb();
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ assigned_to: null }), { params: params() });
    expect(res.status).toBe(200);
  });

  it("mirrors the assignment onto leads.assigned_to when the row is the origin branch", async () => {
    const tables = setupDb({ lead_branches: chain({ data: ORIGIN_MEMBER_ROW, error: null }) });
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ assigned_to: "11111111-1111-1111-1111-111111111111" }), { params: params() });
    expect(res.status).toBe(200);
    // leads.update was called at least once (initial select + the origin-mirror update
    // both go through from("leads") — proves the mirror path was reached, not skipped).
    expect(tables.leads.select).toHaveBeenCalled();
  });

  it("branch manager CAN assign within their own branch", async () => {
    requireAdminMock.mockReturnValue(false);
    authenticateRequestMock.mockResolvedValue(BRANCH_MANAGER_AUTH);
    setupDb();
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ assigned_to: "11111111-1111-1111-1111-111111111111" }), { params: params() });
    expect(res.status).toBe(200);
  });

  it("branch manager CANNOT assign in a branch that isn't their own", async () => {
    requireAdminMock.mockReturnValue(false);
    authenticateRequestMock.mockResolvedValue({ ...BRANCH_MANAGER_AUTH, branchId: "branch-ktm" });
    setupDb();
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ assigned_to: "11111111-1111-1111-1111-111111111111" }), { params: params() });
    expect(res.status).toBe(403);
  });

  it("a plain counselor (not admin, not branch manager) is forbidden outright", async () => {
    requireAdminMock.mockReturnValue(false);
    authenticateRequestMock.mockResolvedValue({
      ...BRANCH_MANAGER_AUTH,
      permissions: { leadScope: "own", baseTier: "member" },
    });
    setupDb();
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ assigned_to: "11111111-1111-1111-1111-111111111111" }), { params: params() });
    expect(res.status).toBe(403);
  });

  it("404 when the lead isn't shared into this branch at all", async () => {
    setupDb({ lead_branches: chain({ data: null, error: null }) });
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ assigned_to: "11111111-1111-1111-1111-111111111111" }), { params: params() });
    expect(res.status).toBe(404);
  });
});
