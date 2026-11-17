import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const createServiceClientMock = vi.fn();
const createAuditLogMock = vi.fn();
const touchLeadUpdatedAtMock = vi.fn();
const getLeadMembershipMock = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  authenticateRequest: authenticateRequestMock,
  getClientIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: createServiceClientMock }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: createAuditLogMock }));
vi.mock("@/lib/leads/touch-updated-at", () => ({ touchLeadUpdatedAt: touchLeadUpdatedAtMock }));
vi.mock("@/lib/leads/branch-membership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/leads/branch-membership")>()),
  getLeadMembership: getLeadMembershipMock,
}));

function authWith(baseTier: string, userId: string, extra: { leadScope?: string; branchId?: string | null; canEditLeads?: boolean; branchMemberIds?: string[] } = {}): AuthContext {
  return {
    userId,
    tenantId: "tenant-1",
    branchId: extra.branchId ?? null,
    branchMemberIds: extra.branchMemberIds ?? [],
    permissions: { baseTier, leadScope: extra.leadScope, canEditLeads: extra.canEditLeads ?? true },
  } as unknown as AuthContext;
}

function fakeReq(): NextRequest {
  return { headers: new Headers() } as unknown as NextRequest;
}

function params(id: string, userId: string) {
  return { params: Promise.resolve({ id, userId }) };
}

function fakeDb({ lead = { id: "lead-1", assigned_to: null, branch_id: null } as { id: string; assigned_to: string | null; branch_id: string | null }, existing = { user_id: "collab-1" }, deleteError = null } = {}) {
  const leadQuery = {
    select: vi.fn(() => leadQuery),
    eq: vi.fn(() => leadQuery),
    is: vi.fn(() => leadQuery),
    single: vi.fn(() => Promise.resolve({ data: lead })),
  };
  const collabSelectQuery = {
    select: vi.fn(() => collabSelectQuery),
    eq: vi.fn(() => collabSelectQuery),
    maybeSingle: vi.fn(() => Promise.resolve({ data: existing })),
  };
  const collabDeleteQuery = {
    delete: vi.fn(() => collabDeleteQuery),
    eq: vi.fn(() => collabDeleteQuery),
  };
  Object.assign(
    collabDeleteQuery,
    { then: (resolve: (v: { error: unknown }) => void) => resolve({ error: deleteError }) },
  );

  let collabCallCount = 0;
  return {
    from: vi.fn((table: string) => {
      if (table === "leads") return leadQuery;
      collabCallCount += 1;
      return collabCallCount === 1 ? collabSelectQuery : collabDeleteQuery;
    }),
  };
}

beforeEach(() => {
  authenticateRequestMock.mockReset();
  createServiceClientMock.mockReset();
  createAuditLogMock.mockReset();
  touchLeadUpdatedAtMock.mockReset();
  getLeadMembershipMock.mockReset();
  createServiceClientMock.mockResolvedValue(fakeDb());
});

describe("DELETE /api/v1/leads/[id]/collaborators/[userId]", () => {
  it("401s when unauthenticated", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params("lead-1", "collab-1"));
    expect(res.status).toBe(401);
  });

  it("allows a collaborator to remove themselves", async () => {
    authenticateRequestMock.mockResolvedValue(authWith("counselor", "collab-1"));
    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params("lead-1", "collab-1"));
    expect(res.status).toBe(200);
  });

  it("403s when a non-admin tries to remove a DIFFERENT collaborator", async () => {
    authenticateRequestMock.mockResolvedValue(authWith("counselor", "someone-else"));
    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params("lead-1", "collab-1"));
    expect(res.status).toBe(403);
  });

  it("allows owner to remove any collaborator", async () => {
    authenticateRequestMock.mockResolvedValue(authWith("owner", "owner-user"));
    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params("lead-1", "collab-1"));
    expect(res.status).toBe(200);
  });

  it("allows admin to remove any collaborator", async () => {
    authenticateRequestMock.mockResolvedValue(authWith("admin", "admin-user"));
    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params("lead-1", "collab-1"));
    expect(res.status).toBe(200);
  });
  it("allows a branch manager to remove a collaborator on a lead in their own branch", async () => {
    authenticateRequestMock.mockResolvedValue(authWith("member", "manager-1", { leadScope: "team", branchId: "branch-A" }));
    getLeadMembershipMock.mockResolvedValue([{ branch_id: "branch-A", assigned_to: null, is_origin: true }]);
    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params("lead-1", "collab-1"));
    expect(res.status).toBe(200);
  });

  it("403s a branch manager removing a collaborator on a lead in ANOTHER branch", async () => {
    authenticateRequestMock.mockResolvedValue(authWith("member", "manager-1", { leadScope: "team", branchId: "branch-A" }));
    getLeadMembershipMock.mockResolvedValue([{ branch_id: "branch-B", assigned_to: null, is_origin: true }]);
    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params("lead-1", "collab-1"));
    expect(res.status).toBe(403);
  });

  it("403s a manager with no branch set", async () => {
    authenticateRequestMock.mockResolvedValue(authWith("member", "manager-1", { leadScope: "team", branchId: null }));
    getLeadMembershipMock.mockResolvedValue([{ branch_id: "branch-A", assigned_to: null, is_origin: true }]);
    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params("lead-1", "collab-1"));
    expect(res.status).toBe(403);
  });

  it("403s an own-scope counsellor removing someone else, even if the lead is in their branch", async () => {
    authenticateRequestMock.mockResolvedValue(authWith("member", "c-1", { leadScope: "own", branchId: "branch-A" }));
    getLeadMembershipMock.mockResolvedValue([{ branch_id: "branch-A", assigned_to: "c-1", is_origin: true }]);
    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params("lead-1", "collab-1"));
    expect(res.status).toBe(403);
  });
  it("allows a branch manager when the lead is assigned to a member of their branch (no roster row)", async () => {
    authenticateRequestMock.mockResolvedValue(authWith("member", "manager-1", { leadScope: "team", branchId: "branch-A", branchMemberIds: ["staff-1"] }));
    createServiceClientMock.mockResolvedValue(fakeDb({ lead: { id: "lead-1", assigned_to: "staff-1", branch_id: null } }));
    getLeadMembershipMock.mockResolvedValue([]);
    const { DELETE } = await import("./route");
    expect((await DELETE(fakeReq(), params("lead-1", "collab-1"))).status).toBe(200);
  });

  it("403s a team-scope user whose position cannot edit leads", async () => {
    authenticateRequestMock.mockResolvedValue(authWith("member", "manager-1", { leadScope: "team", branchId: "branch-A", canEditLeads: false }));
    getLeadMembershipMock.mockResolvedValue([{ branch_id: "branch-A", assigned_to: null, is_origin: true }]);
    const { DELETE } = await import("./route");
    expect((await DELETE(fakeReq(), params("lead-1", "collab-1"))).status).toBe(403);
  });
});
