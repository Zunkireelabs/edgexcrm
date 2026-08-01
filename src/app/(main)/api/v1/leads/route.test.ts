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
    select: record("select"),
    eq: record("eq"),
    is: record("is"),
    or: record("or"),
    in: record("in"),
    not: record("not"),
    order: record("order"),
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
        select: () => chain,
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

  it("branch-manager (leadScope:'team' + branchId) is routed through the uncapped leads_visible_to_user() RPC as scope 'branch', not the old hand-rolled lead_branches/.or() query (BRANCH-SCOPE-TRUNCATION-503-BRIEF)", async () => {
    const rpcCalls: RpcCall[] = [];
    // No lead_branches row given — if the route still fetched it, fakeDb's `from()`
    // would still resolve it (it's stubbed), but the real proof is rpcCalls below and
    // that the service-client leads table is never touched for the base query.
    const calls: Call[] = [];
    authenticateRequestMock.mockResolvedValue(
      authFixture({
        userId: "user-1",
        branchId: "branch-1",
        branchMemberIds: ["u1", "u2"],
        permissions: permissions({ leadScope: "team" }),
      }),
    );
    createClientMock.mockResolvedValue(fakeUserClient(rpcCalls));
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: calls }));

    const { GET } = await import("./route");
    const res = await GET(fakeReq());

    expect(res.status).toBe(200);
    expect(rpcCalls).toEqual([
      [
        "leads_visible_to_user",
        { p_tenant: "tenant-1", p_scope: "branch", p_branch_id: "branch-1" },
        { count: "exact" },
      ],
    ]);
    // The service client's leads table is never touched for the base query — no
    // .or(assigned_to.in.(…),id.in.(…)) built from an unbounded lead_branches fetch.
    expect(calls.some(([m]) => m === "or")).toBe(false);
    expect(calls).toEqual([]);
  });

  it("branch-manager scope never fetches lead_branches — the removed unbounded (PostgREST-capped-at-1000) shared-id query", async () => {
    const rpcCalls: RpcCall[] = [];
    let leadBranchesQueried = false;
    authenticateRequestMock.mockResolvedValue(
      authFixture({
        userId: "user-1",
        branchId: "branch-1",
        branchMemberIds: ["u1", "u2"],
        permissions: permissions({ leadScope: "team" }),
      }),
    );
    createClientMock.mockResolvedValue(fakeUserClient(rpcCalls));
    createServiceClientMock.mockResolvedValue({
      from: (table: string) => {
        if (table === "leads") return makeLeadsChain([]);
        if (table === "lead_branches") {
          leadBranchesQueried = true;
          return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [] }) }) }) };
        }
        throw new Error(`unexpected table ${table}`);
      },
    });

    const { GET } = await import("./route");
    const res = await GET(fakeReq());

    expect(res.status).toBe(200);
    expect(leadBranchesQueried).toBe(false);
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

describe("GET /api/v1/leads — facets=source (dashboard-aggregates review fixes)", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    createServiceClientMock.mockReset();
    createClientMock.mockReset();
    getFeatureAccessMock.mockReset();
    branchMemberIdsMock.mockReset();
    getFeatureAccessMock.mockReturnValue(false);
    branchMemberIdsMock.mockResolvedValue([]);
  });

  it("an empty pipeline allowlist returns options:[] and never calls the aggregate RPC — matches route.ts:370's .in(pipeline_id, []) zero-result semantics", async () => {
    const rpcCalls: RpcCall[] = [];
    authenticateRequestMock.mockResolvedValue(
      authFixture({
        userId: "admin-1",
        role: "owner",
        permissions: permissions({ leadScope: "all", pipelineAccess: { ids: new Set() } }),
      }),
    );
    createClientMock.mockResolvedValue(fakeUserClient(rpcCalls));
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: [] }));

    const { GET } = await import("./route");
    const res = await GET(fakeReq({ facets: "source" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ facet: "source", options: [] });
    expect(rpcCalls).toEqual([]);
  });

  it("branch-manager facets=source resolves p_scope to 'branch' + p_branch_id — the same leads_visible_to_user() predicate the page query uses, not the deleted 'ids_any' id-array path", async () => {
    const rpcCalls: RpcCall[] = [];
    authenticateRequestMock.mockResolvedValue(
      authFixture({
        userId: "user-1",
        branchId: "branch-1",
        branchMemberIds: ["u1", "u2"],
        permissions: permissions({ leadScope: "team" }),
      }),
    );
    createClientMock.mockResolvedValue({
      // Two RPC shapes go through this same client here: the base page query
      // (leads_visible_to_user, chained with .select()/.range() but never executed
      // on this facets=source path) and lead_aggregates (facet — awaited directly,
      // real supabase-js's PostgrestFilterBuilder is thenable the same way).
      rpc: (name: string, params: unknown, opts: unknown) => {
        rpcCalls.push([name, params, opts]);
        if (name === "lead_aggregates") return Promise.resolve({ data: [], error: null });
        const chain: Record<string, unknown> = {
          select: () => chain,
          is: () => chain,
          not: () => chain,
          eq: () => chain,
          order: () => chain,
          range: () => Promise.resolve({ data: [], error: null, count: 0 }),
        };
        return chain;
      },
    });
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: [] }));

    const { GET } = await import("./route");
    const res = await GET(fakeReq({ facets: "source" }));
    expect(res.status).toBe(200);

    // Two RPCs: the base page query (leads_visible_to_user) and lead_aggregates (facet).
    const facetCall = rpcCalls.find(([name]) => name === "lead_aggregates");
    expect(facetCall).toBeDefined();
    const [, facetParams] = facetCall as RpcCall;
    expect((facetParams as Record<string, unknown>).p_scope).toBe("branch");
    expect((facetParams as Record<string, unknown>).p_branch_id).toBe("branch-1");
    expect((facetParams as Record<string, unknown>).p_ids_any_assigned_to).toBeUndefined();
    expect((facetParams as Record<string, unknown>).p_ids_any_lead_id).toBeUndefined();
  });

  it("scope.restrictToSelf without scope.userId throws instead of silently widening the facet to tenant-wide counts", async () => {
    authenticateRequestMock.mockResolvedValue(
      authFixture({
        userId: "",
        role: "counselor",
        permissions: permissions({ leadScope: "own" }),
      }),
    );
    createClientMock.mockResolvedValue(fakeUserClient([]));
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: [] }));

    const { GET } = await import("./route");
    await expect(GET(fakeReq({ facets: "source" }))).rejects.toThrow(
      "leads/facets: scope.restrictToSelf requires scope.userId",
    );
  });

  it("facets=source for an explicitly requested staging list passes listIdEq and excludeListIds as never-both-present — mirrors the page query's either/or (route.ts:309-316) instead of ANDing them into a contradiction", async () => {
    const rpcCalls: RpcCall[] = [];
    getFeatureAccessMock.mockReturnValue(true);
    authenticateRequestMock.mockResolvedValue(
      authFixture({
        userId: "admin-1",
        role: "owner",
        permissions: permissions({ leadScope: "all" }),
      }),
    );
    createClientMock.mockResolvedValue({
      rpc: (name: string, params: unknown, opts: unknown) => {
        rpcCalls.push([name, params, opts]);
        return Promise.resolve({ data: [], error: null });
      },
    });
    createServiceClientMock.mockResolvedValue(
      fakeDbWithLists({
        leadsCalls: [],
        lists: [{ id: "list-mqc", slug: "migration-qc", is_staging: true, access: { mode: "all" } }],
      }),
    );

    const { GET } = await import("./route");
    const res = await GET(fakeReq({ list: "migration-qc", facets: "source" }));
    expect(res.status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    const [, rpcParams] = rpcCalls[0] as [string, Record<string, unknown>, unknown];
    expect(rpcParams.p_list_id_eq).toBe("list-mqc");
    expect(rpcParams.p_exclude_list_ids).toBeUndefined();
  });

  it("an RPC error from getSourceFacet surfaces as a 503 apiServiceUnavailable, not an unhandled 500 or empty options", async () => {
    authenticateRequestMock.mockResolvedValue(
      authFixture({
        userId: "admin-1",
        role: "owner",
        permissions: permissions({ leadScope: "all" }),
      }),
    );
    createClientMock.mockResolvedValue({
      rpc: () => Promise.resolve({ data: null, error: { message: "connection refused" } }),
    });
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: [] }));

    const { GET } = await import("./route");
    const res = await GET(fakeReq({ facets: "source" }));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });
});

// --- LEADS-SERVER-PAGINATION-BRIEF: sort allow-list, count=0, list/funnel/recycle-bin ---

function fakeDbWithLists(opts: {
  leadsCalls: Call[];
  lists: Array<{
    id: string;
    slug: string;
    is_archive?: boolean;
    is_staging?: boolean;
    funnel_key?: string | null;
    access?: { mode: string; positionIds?: string[] };
  }>;
}) {
  return {
    from: (table: string) => {
      if (table === "leads") return makeLeadsChain(opts.leadsCalls);
      if (table === "lead_lists") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: opts.lists.map((l) => ({
                  id: l.id,
                  slug: l.slug,
                  is_archive: l.is_archive ?? false,
                  is_staging: l.is_staging ?? false,
                  funnel_key: l.funnel_key ?? null,
                  access: l.access ?? { mode: "all" },
                })),
              }),
          }),
        };
      }
      if (table === "lead_branches") {
        return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [] }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe("GET /api/v1/leads — sort/count/list/funnel/recycle-bin (LEADS-SERVER-PAGINATION-BRIEF)", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    createServiceClientMock.mockReset();
    createClientMock.mockReset();
    getFeatureAccessMock.mockReset();
    branchMemberIdsMock.mockReset();
    branchMemberIdsMock.mockResolvedValue([]);
    createClientMock.mockResolvedValue(fakeUserClient([]));
    authenticateRequestMock.mockResolvedValue(
      authFixture({ userId: "admin-1", role: "owner", permissions: permissions({ leadScope: "all" }) }),
    );
  });

  it("rejects an unknown sort key with 422 instead of interpolating it into the query", async () => {
    getFeatureAccessMock.mockReturnValue(false);
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: [] }));
    const { GET } = await import("./route");
    const res = await GET(fakeReq({ sort: "custom_fields->x" }));
    expect(res.status).toBe(422);
  });

  it("rejects an invalid order value with 422", async () => {
    getFeatureAccessMock.mockReturnValue(false);
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: [] }));
    const { GET } = await import("./route");
    const res = await GET(fakeReq({ order: "sideways" }));
    expect(res.status).toBe(422);
  });

  it("defaults to created_at DESC with id DESC as the final tiebreaker (index-ordered, stable across pages)", async () => {
    const calls: Call[] = [];
    getFeatureAccessMock.mockReturnValue(false);
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: calls }));
    const { GET } = await import("./route");
    const res = await GET(fakeReq());
    expect(res.status).toBe(200);
    const orderCalls = calls.filter(([m]) => m === "order");
    expect(orderCalls).toEqual([
      ["order", ["created_at", { ascending: false }]],
      ["order", ["id", { ascending: false }]],
    ]);
  });

  it("?count=0 skips the exact count and returns the -1 sentinel, never a false 0", async () => {
    getFeatureAccessMock.mockReturnValue(false);
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: [] }));
    const { GET } = await import("./route");
    const res = await GET(fakeReq({ count: "0" }));
    const body = await res.json();
    expect(body.meta.total).toBe(-1);
    expect(body.meta.totalPages).toBe(-1);
  });

  it("?list=delete resolves to the recycle bin: deleted_at flips to NOT NULL, list_id filter is skipped entirely", async () => {
    const calls: Call[] = [];
    getFeatureAccessMock.mockReturnValue(true);
    createServiceClientMock.mockResolvedValue(
      fakeDbWithLists({ leadsCalls: calls, lists: [{ id: "list-delete", slug: "delete", is_staging: true }] }),
    );
    const { GET } = await import("./route");
    const res = await GET(fakeReq({ list: "delete" }));
    expect(res.status).toBe(200);
    expect(calls).toContainEqual(["not", ["deleted_at", "is", null]]);
    expect(calls.some(([m, a]) => m === "is" && a[0] === "deleted_at")).toBe(false);
    expect(calls.some(([m, a]) => m === "eq" && a[0] === "list_id")).toBe(false);
  });

  it("?funnel=<key> resolves to .in(list_id, [...]) over every accessible stage-list sharing that funnel_key", async () => {
    const calls: Call[] = [];
    getFeatureAccessMock.mockReturnValue(true);
    createServiceClientMock.mockResolvedValue(
      fakeDbWithLists({
        leadsCalls: calls,
        lists: [
          { id: "l1", slug: "new", funnel_key: "lead_processing" },
          { id: "l2", slug: "contacted", funnel_key: "lead_processing" },
          { id: "l3", slug: "won", funnel_key: "sales_leads" },
        ],
      }),
    );
    const { GET } = await import("./route");
    const res = await GET(fakeReq({ funnel: "lead_processing" }));
    expect(res.status).toBe(200);
    expect(calls).toContainEqual(["in", ["list_id", ["l1", "l2"]]]);
  });

  it("master view (no list/funnel) excludes BOTH archive and staging lists, not just archive", async () => {
    const calls: Call[] = [];
    getFeatureAccessMock.mockReturnValue(true);
    createServiceClientMock.mockResolvedValue(
      fakeDbWithLists({
        leadsCalls: calls,
        lists: [
          { id: "l1", slug: "archived-list", is_archive: true },
          { id: "l2", slug: "staging-list", is_staging: true },
          { id: "l3", slug: "normal-list" },
        ],
      }),
    );
    const { GET } = await import("./route");
    const res = await GET(fakeReq());
    expect(res.status).toBe(200);
    expect(calls).toContainEqual(["or", ["list_id.is.null,list_id.not.in.(l1,l2)"]]);
  });

  it("a staging list is 403 for a non-admin/owner even under an otherwise-open access mode", async () => {
    getFeatureAccessMock.mockReturnValue(true);
    authenticateRequestMock.mockResolvedValue(
      authFixture({ userId: "user-1", role: "counselor", permissions: permissions({ leadScope: "own" }) }),
    );
    createServiceClientMock.mockResolvedValue(
      fakeDbWithLists({
        leadsCalls: [],
        lists: [{ id: "l1", slug: "staging-qc", is_staging: true, access: { mode: "all" } }],
      }),
    );
    const { GET } = await import("./route");
    const res = await GET(fakeReq({ list: "staging-qc" }));
    expect(res.status).toBe(403);
  });
});
