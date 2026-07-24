import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";
import type { ResolvedPermissions } from "@/lib/api/permissions";

// --- mocks -----------------------------------------------------------
//
// @/lib/api/permissions is deliberately NOT mocked — leadQueryScope / canSeeNav /
// isSharedPoolList are the real scoping logic this suite proves is actually wired
// into GET /api/v1/leads, not just correct in isolation (5.Ga/5.Gb).

const authenticateRequestMock = vi.fn();
const createServiceClientMock = vi.fn();
const getFeatureAccessMock = vi.fn();
const branchMemberIdsMock = vi.fn();
const sharedBranchLeadIdsForAssigneeMock = vi.fn();
const unassignedCrossBranchLeadIdsMock = vi.fn();
const collaboratorLeadIdsForUserMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: createServiceClientMock }));

vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));

vi.mock("@/lib/logger", () => ({
  createRequestLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn() })),
}));

vi.mock("@/lib/leads/branch-membership", () => ({
  branchMemberIds: branchMemberIdsMock,
  sharedBranchLeadIdsForAssignee: sharedBranchLeadIdsForAssigneeMock,
  unassignedCrossBranchLeadIds: unassignedCrossBranchLeadIdsMock,
  syncOriginMembership: vi.fn(),
}));

vi.mock("@/lib/leads/collaborators", () => ({
  collaboratorLeadIdsForUser: collaboratorLeadIdsForUserMock,
  addLeadCollaborator: vi.fn(),
}));

// --- fixtures ----------------------------------------------------------

function permissions(overrides: Partial<ResolvedPermissions> = {}): ResolvedPermissions {
  return {
    baseTier: "member",
    allowedNavKeys: null,
    pipelineAccess: "all",
    listAccess: "all",
    leadScope: "own",
    sharedPoolListIds: new Set(),
    canAssignLeads: false,
    canEditLeads: false,
    canManageApplications: false,
    canManageClasses: false,
    canManageHR: false,
    canExport: false,
    dashboardWidgets: null,
    ...overrides,
  };
}

function authFixture(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "user-1",
    email: "human@example.com",
    tenantId: "tenant-1",
    role: "counselor",
    industryId: "it_agency",
    positionId: null,
    positionSlug: null,
    branchId: null,
    branchMemberIds: [],
    permissions: permissions(),
    plan: "free",
    entitlements: {} as AuthContext["entitlements"],
    ...overrides,
  };
}

function fakeReq(params: Record<string, string> = {}): NextRequest {
  return { nextUrl: { searchParams: new URLSearchParams(params) } } as unknown as NextRequest;
}

type Call = [method: string, args: unknown[]];

// Chainable `leads` table double: records every eq/is/or/in/not call (in order)
// into `calls`, and terminates the real route's `.order(...).range(...)` tail
// with an empty successful page — good enough to prove which filters were
// applied without modelling actual row data.
function makeLeadsChain(calls: Call[]) {
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push([method, args]);
      return chain;
    };
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: record("eq"),
    is: record("is"),
    or: record("or"),
    in: record("in"),
    not: record("not"),
    order: () => chain,
    range: () => Promise.resolve({ data: [], error: null, count: 0 }),
  };
  return chain;
}

function fakeDb(opts: { leadsCalls: Call[]; leadBranchesRows?: Array<{ lead_id: string }> }) {
  return {
    from: (table: string) => {
      if (table === "leads") return makeLeadsChain(opts.leadsCalls);
      if (table === "lead_branches") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: opts.leadBranchesRows ?? [] }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table} — getFeatureAccess should have skipped list resolution`);
    },
  };
}

describe("GET /api/v1/leads — counselor-scoping wiring", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    createServiceClientMock.mockReset();
    getFeatureAccessMock.mockReset();
    branchMemberIdsMock.mockReset();
    sharedBranchLeadIdsForAssigneeMock.mockReset();
    unassignedCrossBranchLeadIdsMock.mockReset();
    collaboratorLeadIdsForUserMock.mockReset();

    getFeatureAccessMock.mockReturnValue(false);
    sharedBranchLeadIdsForAssigneeMock.mockResolvedValue([]);
    unassignedCrossBranchLeadIdsMock.mockResolvedValue([]);
    collaboratorLeadIdsForUserMock.mockResolvedValue([]);
    branchMemberIdsMock.mockResolvedValue([]);
  });

  it("counselor (leadScope:'own') is self-scoped to assigned_to = their own userId", async () => {
    const calls: Call[] = [];
    authenticateRequestMock.mockResolvedValue(
      authFixture({ userId: "user-1", permissions: permissions({ leadScope: "own" }) }),
    );
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: calls }));

    const { GET } = await import("./route");
    const res = await GET(fakeReq());

    expect(res.status).toBe(200);
    expect(calls).toContainEqual(["eq", ["tenant_id", "tenant-1"]]);
    expect(calls).toContainEqual(["is", ["deleted_at", null]]);
    expect(calls).toContainEqual(["eq", ["assigned_to", "user-1"]]);
  });

  it("counselor cannot widen or redirect scope via ?assigned_to= — the client param is ignored, not honored", async () => {
    const calls: Call[] = [];
    authenticateRequestMock.mockResolvedValue(
      authFixture({ userId: "user-1", permissions: permissions({ leadScope: "own" }) }),
    );
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: calls }));

    const { GET } = await import("./route");
    const res = await GET(fakeReq({ assigned_to: "other-user" }));

    expect(res.status).toBe(200);
    expect(calls).not.toContainEqual(["eq", ["assigned_to", "other-user"]]);
    // Still self-scoped, regardless of the attempted redirect.
    expect(calls).toContainEqual(["eq", ["assigned_to", "user-1"]]);
  });

  it("admin/owner (leadScope:'all') is not self-restricted, and ?assigned_to= IS honored", async () => {
    const calls: Call[] = [];
    authenticateRequestMock.mockResolvedValue(
      authFixture({ userId: "admin-1", role: "owner", permissions: permissions({ leadScope: "all" }) }),
    );
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: calls }));

    const { GET } = await import("./route");
    const res = await GET(fakeReq({ assigned_to: "other-user" }));

    expect(res.status).toBe(200);
    // Only the client-requested filter appears — no self-restriction was ever applied.
    const assignedToCalls = calls.filter(([method, args]) => method === "eq" && args[0] === "assigned_to");
    expect(assignedToCalls).toEqual([["eq", ["assigned_to", "other-user"]]]);
  });

  it("branch-manager (leadScope:'team' + branchId) is restricted to branch member assignees", async () => {
    const calls: Call[] = [];
    authenticateRequestMock.mockResolvedValue(
      authFixture({
        userId: "user-1",
        branchId: "branch-1",
        branchMemberIds: ["u1", "u2"],
        permissions: permissions({ leadScope: "team" }),
      }),
    );
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: calls, leadBranchesRows: [] }));

    const { GET } = await import("./route");
    const res = await GET(fakeReq());

    expect(res.status).toBe(200);
    expect(calls).toContainEqual(["in", ["assigned_to", ["u1", "u2"]]]);
  });

  it("canSeeNav gate: a fixture without /leads nav access is forbidden before any query runs", async () => {
    authenticateRequestMock.mockResolvedValue(
      authFixture({ permissions: permissions({ allowedNavKeys: new Set(["/other"]) }) }),
    );

    const { GET } = await import("./route");
    const res = await GET(fakeReq());

    expect(res.status).toBe(403);
    expect(createServiceClientMock).not.toHaveBeenCalled();
  });
});
