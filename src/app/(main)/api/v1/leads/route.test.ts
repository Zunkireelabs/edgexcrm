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
const createClientMock = vi.fn();
const getFeatureAccessMock = vi.fn();
const branchMemberIdsMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));

// createClient() is the RLS-context client leads_visible_to_user() needs for auth.uid()
// (migration 179, wired into own-scope in this route by stage's ea18d789). It is called
// unconditionally at the top of GET regardless of scope, so every test needs it resolved —
// only the own-scope tests below actually inspect what was done with it.
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: createServiceClientMock,
  createClient: createClientMock,
}));

vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));

vi.mock("@/lib/logger", () => ({
  createRequestLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn() })),
}));

// route.ts's own-scope cross-branch-pool visibility used to call
// sharedBranchLeadIdsForAssignee / unassignedCrossBranchLeadIds directly; stage's ea18d789
// moved that logic inside leads_visible_to_user() itself (p_cross_pool_slug), so only
// branchMemberIds (branch-scope) and syncOriginMembership (write path) are still live here.
vi.mock("@/lib/leads/branch-membership", () => ({
  branchMemberIds: branchMemberIdsMock,
  syncOriginMembership: vi.fn(),
}));

// route.ts only calls addLeadCollaborator (write path, on lead create) — own-scope
// visibility no longer goes through collaborator lookups here, that's the RPC's job now.
vi.mock("@/lib/leads/collaborators", () => ({
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

type RpcCall = [name: string, params: unknown, opts: unknown];

// Own-scope's RLS-context client double: records every rpc(name, params, opts) call
// (this is where leads_visible_to_user() visibility is actually enforced — SQL-side,
// invisible to any eq()/is() call capture on the leads table) and terminates the
// route's chained .is(...).not(...).order(...).range(...) tail with an empty page.
function fakeUserClient(rpcCalls: RpcCall[]) {
  return {
    rpc: (name: string, params: unknown, opts: unknown) => {
      rpcCalls.push([name, params, opts]);
      const chain: Record<string, unknown> = {
        is: () => chain,
        not: () => chain,
        eq: () => chain,
        order: () => chain,
        range: () => Promise.resolve({ data: [], error: null, count: 0 }),
      };
      return chain;
    },
  };
}

describe("GET /api/v1/leads — counselor-scoping wiring", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    createServiceClientMock.mockReset();
    createClientMock.mockReset();
    getFeatureAccessMock.mockReset();
    branchMemberIdsMock.mockReset();

    getFeatureAccessMock.mockReturnValue(false);
    branchMemberIdsMock.mockResolvedValue([]);
    // Default: resolved but unused — only own-scope tests below route a query through it.
    createClientMock.mockResolvedValue(fakeUserClient([]));
  });

  it("counselor (leadScope:'own') is routed through the uncapped leads_visible_to_user() RPC as scope 'own', scoped to their own userId", async () => {
    const rpcCalls: RpcCall[] = [];
    authenticateRequestMock.mockResolvedValue(
      authFixture({ userId: "user-1", permissions: permissions({ leadScope: "own" }) }),
    );
    createClientMock.mockResolvedValue(fakeUserClient(rpcCalls));
    // Own-scope never touches the plain service client's leads table — if it did, this
    // table double would be exercised too; asserting rpcCalls below is the real proof.
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: [] }));

    const { GET } = await import("./route");
    const res = await GET(fakeReq());

    expect(res.status).toBe(200);
    expect(rpcCalls).toEqual([
      [
        "leads_visible_to_user",
        { p_tenant: "tenant-1", p_user: "user-1", p_scope: "own" },
        { count: "exact" },
      ],
    ]);
  });

  it("counselor cannot widen or redirect scope via ?assigned_to= — the RPC is still called with the caller's own userId, not the client param", async () => {
    const rpcCalls: RpcCall[] = [];
    authenticateRequestMock.mockResolvedValue(
      authFixture({ userId: "user-1", permissions: permissions({ leadScope: "own" }) }),
    );
    createClientMock.mockResolvedValue(fakeUserClient(rpcCalls));
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: [] }));

    const { GET } = await import("./route");
    const res = await GET(fakeReq({ assigned_to: "other-user" }));

    expect(res.status).toBe(200);
    // The RPC's p_user is the authenticated caller — "other-user" never appears anywhere.
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0][1]).toEqual({ p_tenant: "tenant-1", p_user: "user-1", p_scope: "own" });
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
