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

function fakeReq(body: unknown = { user_id: "new-collab" }): NextRequest {
  return { headers: new Headers(), json: () => Promise.resolve(body) } as unknown as NextRequest;
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function fakeDb(lead: { id: string; assigned_to: string | null; branch_id: string | null } = { id: "lead-1", assigned_to: null, branch_id: null }) {
  const chain = (result: unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is"]) q[m] = vi.fn(() => q);
    q.single = vi.fn(() => Promise.resolve({ data: result }));
    q.maybeSingle = vi.fn(() => Promise.resolve({ data: result }));
    return q;
  };
  return {
    from: vi.fn((table: string) => {
      if (table === "leads") return chain(lead);
      if (table === "tenant_users") return chain({ user_id: "new-collab" });
      return { upsert: vi.fn(() => Promise.resolve({ error: null })) };
    }),
    auth: { admin: { getUserById: vi.fn(() => Promise.resolve({ data: { user: { email: "x@y.com", user_metadata: {} } } })) } },
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

describe("POST /api/v1/leads/[id]/collaborators", () => {
  it("401s when unauthenticated", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { POST } = await import("./route");
    expect((await POST(fakeReq(), params("lead-1"))).status).toBe(401);
  });

  it("allows owner and admin (no branch lookup needed)", async () => {
    const { POST } = await import("./route");
    for (const tier of ["owner", "admin"]) {
      authenticateRequestMock.mockResolvedValue(authWith(tier, "u-1"));
      expect((await POST(fakeReq(), params("lead-1"))).status).toBe(200);
    }
    expect(getLeadMembershipMock).not.toHaveBeenCalled();
  });

  it("allows a branch manager to add a collaborator on a lead in their own branch", async () => {
    authenticateRequestMock.mockResolvedValue(authWith("member", "manager-1", { leadScope: "team", branchId: "branch-A" }));
    getLeadMembershipMock.mockResolvedValue([{ branch_id: "branch-A", assigned_to: null, is_origin: true }]);
    const { POST } = await import("./route");
    expect((await POST(fakeReq(), params("lead-1"))).status).toBe(200);
  });

  it("403s a branch manager on a lead in ANOTHER branch", async () => {
    authenticateRequestMock.mockResolvedValue(authWith("member", "manager-1", { leadScope: "team", branchId: "branch-A" }));
    getLeadMembershipMock.mockResolvedValue([{ branch_id: "branch-B", assigned_to: null, is_origin: true }]);
    const { POST } = await import("./route");
    expect((await POST(fakeReq(), params("lead-1"))).status).toBe(403);
  });

  it("403s a team-scope user with no branch set", async () => {
    authenticateRequestMock.mockResolvedValue(authWith("member", "manager-1", { leadScope: "team", branchId: null }));
    getLeadMembershipMock.mockResolvedValue([{ branch_id: "branch-A", assigned_to: null, is_origin: true }]);
    const { POST } = await import("./route");
    expect((await POST(fakeReq(), params("lead-1"))).status).toBe(403);
  });

  it("403s own-scope counsellors and all-scope non-admins before touching the DB", async () => {
    const { POST } = await import("./route");
    for (const leadScope of ["own", "all"]) {
      authenticateRequestMock.mockResolvedValue(authWith("member", "c-1", { leadScope, branchId: "branch-A" }));
      expect((await POST(fakeReq(), params("lead-1"))).status).toBe(403);
    }
    expect(createServiceClientMock).not.toHaveBeenCalled();
  });
  it("allows a branch manager when the lead is assigned to a member of their branch (no roster row)", async () => {
    authenticateRequestMock.mockResolvedValue(authWith("member", "manager-1", { leadScope: "team", branchId: "branch-A", branchMemberIds: ["staff-1"] }));
    createServiceClientMock.mockResolvedValue(fakeDb({ id: "lead-1", assigned_to: "staff-1", branch_id: null }));
    getLeadMembershipMock.mockResolvedValue([]);
    const { POST } = await import("./route");
    expect((await POST(fakeReq(), params("lead-1"))).status).toBe(200);
  });

  it("403s a team-scope user whose position cannot edit leads", async () => {
    authenticateRequestMock.mockResolvedValue(authWith("member", "manager-1", { leadScope: "team", branchId: "branch-A", canEditLeads: false }));
    getLeadMembershipMock.mockResolvedValue([{ branch_id: "branch-A", assigned_to: null, is_origin: true }]);
    const { POST } = await import("./route");
    expect((await POST(fakeReq(), params("lead-1"))).status).toBe(403);
  });
});
