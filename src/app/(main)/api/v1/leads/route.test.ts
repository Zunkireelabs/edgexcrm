import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";
import type { ResolvedPermissions } from "@/lib/api/permissions";
import { legacyLeadsParamsToTree } from "@/lib/filters/legacy-leads-params";
import { encodeFilterTree, FILTER_PARAM } from "@/lib/filters/serialize";

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
    canManageProjects: false,
    canApproveTime: false,
    canManageBilling: false,
    canExport: false,
    canSendSms: false,
    dashboardWidgets: null,
    ...overrides,
  };
}

function authFixture(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "user-1",
    email: "human@example.com",
    tenantId: "tenant-1",
    role: "staff",
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
    neq: record("neq"),
    is: record("is"),
    or: record("or"),
    in: record("in"),
    not: record("not"),
    // gt/gte/lt/lte/ilike/contains/overlaps: unexercised before the Phase 2
    // ?f=/legacy-toolbar equivalence tests below — those are the first tests
    // in this file to reach compileFilter's native fast path for these ops
    // (e.g. .contains() for a tag filter, which route.ts has called directly
    // since before this phase, just never under a test).
    gt: record("gt"),
    gte: record("gte"),
    lt: record("lt"),
    lte: record("lte"),
    ilike: record("ilike"),
    contains: record("contains"),
    overlaps: record("overlaps"),
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

// FACET-COUNT-CONSISTENCY: assignee/collaborator facet counts are now the list's OWN query
// run with head:true, once per candidate person. This double serves that path: a
// `tenant_users` candidate list, plus a `leads` chain per count query that records its
// calls and resolves (thenable, like a real postgrest-js builder) with a count chosen by
// `countFor(calls)` — tests key that off the candidate id appearing in the recorded calls.
function facetDb(opts: { memberIds: string[]; countFor: (calls: Call[]) => number }) {
  const countChains: Call[][] = [];
  return {
    countChains,
    from: (table: string) => {
      if (table === "tenant_users") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: opts.memberIds.map((user_id) => ({ user_id })), error: null }),
          }),
        };
      }
      if (table === "leads") {
        const calls: Call[] = [];
        countChains.push(calls);
        const chain = makeLeadsChain(calls) as Record<string, unknown>;
        chain.then = (resolve: (v: { data: null; error: null; count: number }) => void) =>
          resolve({ data: null, error: null, count: opts.countFor(calls) });
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

const callsMention = (calls: Call[], needle: string) => JSON.stringify(calls).includes(needle);

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
    // A real uuid-shaped id — a non-uuid value like the old "other-user" fixture
    // is now correctly dropped by the UUID guard (it would 22P02 against the
    // real leads.assigned_to column; see compile.ts's sanitizeUuidCondition).
    const res = await GET(fakeReq({ assigned_to: "22222222-2222-2222-2222-222222222222" }));

    expect(res.status).toBe(200);
    // Only the client-requested filter appears — no self-restriction was ever applied.
    const assignedToCalls = calls.filter(([method, args]) => method === "eq" && args[0] === "assigned_to");
    expect(assignedToCalls).toEqual([["eq", ["assigned_to", "22222222-2222-2222-2222-222222222222"]]]);
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
        role: "staff",
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
      authFixture({ userId: "user-1", role: "staff", permissions: permissions({ leadScope: "own" }) }),
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

// --- pipeline-column-pagination Phase 1: ?stage= filter ---

describe("GET /api/v1/leads — ?stage= filter (pipeline-column-pagination Phase 1)", () => {
  const VALID_STAGE_ID = "11111111-2222-4333-8444-555555555555";

  beforeEach(() => {
    authenticateRequestMock.mockReset();
    createServiceClientMock.mockReset();
    createClientMock.mockReset();
    getFeatureAccessMock.mockReset();
    branchMemberIdsMock.mockReset();
    getFeatureAccessMock.mockReturnValue(false);
    branchMemberIdsMock.mockResolvedValue([]);
    createClientMock.mockResolvedValue(fakeUserClient([]));
    authenticateRequestMock.mockResolvedValue(
      authFixture({ userId: "admin-1", role: "owner", permissions: permissions({ leadScope: "all" }) }),
    );
  });

  it("applies a well-formed ?stage= as .eq('stage_id', <value>) — exact match, no widening", async () => {
    const calls: Call[] = [];
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: calls }));

    const { GET } = await import("./route");
    const res = await GET(fakeReq({ stage: VALID_STAGE_ID }));

    expect(res.status).toBe(200);
    expect(calls).toContainEqual(["eq", ["stage_id", VALID_STAGE_ID]]);
  });

  it("drops a malformed ?stage= value instead of interpolating it — no stage_id filter is applied", async () => {
    const calls: Call[] = [];
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: calls }));

    const { GET } = await import("./route");
    const res = await GET(fakeReq({ stage: "'; DROP TABLE leads; --" }));

    expect(res.status).toBe(200);
    expect(calls.some(([m, a]) => m === "eq" && a[0] === "stage_id")).toBe(false);
  });

  it("composes ?stage= with ?funnel= — both filters are applied together, neither silently drops the other", async () => {
    const calls: Call[] = [];
    getFeatureAccessMock.mockReturnValue(true);
    createServiceClientMock.mockResolvedValue(
      fakeDbWithLists({
        leadsCalls: calls,
        lists: [
          { id: "l1", slug: "new", funnel_key: "lead_processing" },
          { id: "l2", slug: "contacted", funnel_key: "lead_processing" },
        ],
      }),
    );

    const { GET } = await import("./route");
    const res = await GET(fakeReq({ funnel: "lead_processing", stage: VALID_STAGE_ID }));

    expect(res.status).toBe(200);
    expect(calls).toContainEqual(["in", ["list_id", ["l1", "l2"]]]);
    expect(calls).toContainEqual(["eq", ["stage_id", VALID_STAGE_ID]]);
  });

  it("composes ?stage= with ?search= — both filters are applied together", async () => {
    const calls: Call[] = [];
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: calls }));

    const { GET } = await import("./route");
    const res = await GET(fakeReq({ stage: VALID_STAGE_ID, search: "acme" }));

    expect(res.status).toBe(200);
    expect(calls).toContainEqual(["eq", ["stage_id", VALID_STAGE_ID]]);
    expect(calls.some(([m, a]) => m === "or" && String(a[0]).includes("acme"))).toBe(true);
  });
});

// --- ADVANCED-FILTERS-BRIEF Phase 2: ?f= vs legacy toolbar-param equivalence ---

function encodedTreeFor(legacyParams: Record<string, string>): string {
  return encodeFilterTree(legacyLeadsParamsToTree(new URLSearchParams(legacyParams)));
}

describe("GET /api/v1/leads — ?f= compiles through the SAME compileFilter() as legacy params (ADVANCED-FILTERS-BRIEF Phase 2)", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    createServiceClientMock.mockReset();
    createClientMock.mockReset();
    getFeatureAccessMock.mockReset();
    branchMemberIdsMock.mockReset();
    getFeatureAccessMock.mockReturnValue(false);
    branchMemberIdsMock.mockResolvedValue([]);
    createClientMock.mockResolvedValue(fakeUserClient([]));
    authenticateRequestMock.mockResolvedValue(
      authFixture({ userId: "admin-1", role: "owner", permissions: permissions({ leadScope: "all" }) }),
    );
  });

  it("?status=contacted and its equivalent ?f= tree produce byte-identical query calls", async () => {
    const legacyCalls: Call[] = [];
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: legacyCalls }));
    const { GET } = await import("./route");
    const legacyRes = await GET(fakeReq({ status: "contacted" }));
    expect(legacyRes.status).toBe(200);

    const fCalls: Call[] = [];
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: fCalls }));
    const fRes = await GET(fakeReq({ [FILTER_PARAM]: encodedTreeFor({ status: "contacted" }) }));
    expect(fRes.status).toBe(200);

    expect(fCalls).toEqual(legacyCalls);
  });

  it("?tag=vip and its equivalent ?f= tree produce byte-identical query calls (native .contains() path)", async () => {
    const legacyCalls: Call[] = [];
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: legacyCalls }));
    const { GET } = await import("./route");
    await GET(fakeReq({ tag: "vip" }));

    const fCalls: Call[] = [];
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: fCalls }));
    await GET(fakeReq({ [FILTER_PARAM]: encodedTreeFor({ tag: "vip" }) }));

    expect(fCalls).toEqual(legacyCalls);
    expect(legacyCalls).toContainEqual(["contains", ["tags", ["vip"]]]);
  });

  it("?industry=__none__ and its equivalent ?f= tree produce byte-identical query calls (native .is(null) path)", async () => {
    const legacyCalls: Call[] = [];
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: legacyCalls }));
    const { GET } = await import("./route");
    await GET(fakeReq({ industry: "__none__" }));

    const fCalls: Call[] = [];
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: fCalls }));
    await GET(fakeReq({ [FILTER_PARAM]: encodedTreeFor({ industry: "__none__" }) }));

    expect(fCalls).toEqual(legacyCalls);
    expect(legacyCalls).toContainEqual(["is", ["prospect_industry", null]]);
  });

  it("?assignees=unassigned,<uuid> and its equivalent ?f= tree produce byte-identical query calls", async () => {
    const uuid = "11111111-2222-4333-8444-555555555555";
    const legacyCalls: Call[] = [];
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: legacyCalls }));
    const { GET } = await import("./route");
    await GET(fakeReq({ assignees: `unassigned,${uuid}` }));

    const fCalls: Call[] = [];
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: fCalls }));
    await GET(fakeReq({ [FILTER_PARAM]: encodedTreeFor({ assignees: `unassigned,${uuid}` }) }));

    expect(fCalls).toEqual(legacyCalls);
  });

  it("?collaborators=<id> and its equivalent ?f= tree both add the lead_collaborators!inner(user_id) embed and strip it from the response", async () => {
    // A real uuid-shaped id — "u1" is now correctly dropped by the UUID guard
    // (widened to cover Collaborators; see compile.ts's needsUuidGuard).
    const legacyCalls: Call[] = [];
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: legacyCalls }));
    const { GET } = await import("./route");
    await GET(fakeReq({ collaborators: "11111111-1111-1111-1111-111111111111" }));

    const fCalls: Call[] = [];
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: fCalls }));
    const fRes = await GET(fakeReq({ [FILTER_PARAM]: encodedTreeFor({ collaborators: "11111111-1111-1111-1111-111111111111" }) }));

    expect(fRes.status).toBe(200);
    expect(fCalls).toEqual(legacyCalls);
    expect(legacyCalls.some(([m, a]) => m === "select" && String(a[0]).includes("lead_collaborators!inner(user_id)"))).toBe(true);
  });

  // §COUNT-SPLIT regression (prod incident 2026-08-25): a branch/own-scope caller
  // (routed through leads_visible_to_user()) combining the Collaborators embed with an
  // exact count used to send ONE combined data+count request — PostgREST resolves that
  // combination's referencedTable filter against the RPC's own `pgrst_call` alias
  // instead of the joined table (42703 "column pgrst_call.user_id does not exist"),
  // 503ing the whole list for the exact scope+filter combo a real branch manager hit
  // live. This proves the fix: the count is split into its own head:true request built
  // from the SAME filter chain, so the total is still correct and no combined call with
  // this shape is ever sent.
  it("branch-scope + ?collaborators= splits the exact count into its own head:true RPC call instead of combining it with the data fetch", async () => {
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
      rpc: (name: string, params: unknown, opts: { head?: boolean; count?: string }) => {
        rpcCalls.push([name, params, opts]);
        const isHeadCount = !!opts?.head;
        const chain: Record<string, unknown> = {
          select: () => chain,
          is: () => chain,
          not: () => chain,
          eq: () => chain,
          in: () => chain,
          or: () => chain,
          order: () => chain,
          range: () => Promise.resolve({ data: [], error: null, count: 0 }),
          // Real postgrest-js builders are thenable — route.ts awaits the head-only
          // call directly, with no .range() tail (a head request has no rows to page).
          then: (resolve: (v: { data: null; error: null; count: number | null }) => void) =>
            resolve({ data: null, error: null, count: isHeadCount ? 761 : null }),
        };
        return chain;
      },
    });
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: [] }));

    const { GET } = await import("./route");
    const res = await GET(fakeReq({ collaborators: "11111111-1111-1111-1111-111111111111" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    // Two RPC calls, not one: the split-out exact count, then the data page.
    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls[0][2]).toEqual({ head: true, count: "exact" });
    expect(rpcCalls[1][2]).toEqual({}); // data call requests no inline count
    // Both calls carry the identical scope + embed — the count can never drift from
    // what the data query is actually filtering.
    expect(rpcCalls[0][1]).toEqual(rpcCalls[1][1]);
    expect(rpcCalls[0][0]).toBe("leads_visible_to_user");
    // The total in the response comes from the split head:true call's count, not a
    // (missing/undefined) count on the data call.
    expect(body.meta.total).toBe(761);
  });

  // Facet counts come from the list's own query (buildScopedQuery), so under branch scope
  // they go through leads_visible_to_user() — and, because that's the RPC-based shape the
  // §COUNT-SPLIT incident is about, EVERY one of those calls must be a head-only count:
  // never a combined data+count call, never a data page, never lead_aggregates().
  it("branch-scope ?facets=collaborator&collaborators=<id> counts each candidate with a head:true leads_visible_to_user() call — never a combined data+count call (§COUNT-SPLIT), never lead_aggregates()", async () => {
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
      rpc: (name: string, params: unknown, opts: unknown) => {
        rpcCalls.push([name, params, opts]);
        if (name !== "leads_visible_to_user") throw new Error(`unexpected rpc ${name}`);
        const chain: Record<string, unknown> = {
          select: () => chain,
          is: () => chain,
          not: () => chain,
          eq: () => chain,
          in: () => chain,
          or: () => chain,
          then: (resolve: (v: { data: null; error: null; count: number }) => void) =>
            resolve({ data: null, error: null, count: 4 }),
        };
        return chain;
      },
    });
    createServiceClientMock.mockResolvedValue(facetDb({ memberIds: ["u1", "u2"], countFor: () => 0 }));

    const { GET } = await import("./route");
    const res = await GET(
      fakeReq({ facets: "collaborator", collaborators: "11111111-1111-1111-1111-111111111111" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(rpcCalls).toHaveLength(2); // one per candidate (u1, u2)
    for (const [name, , opts] of rpcCalls) {
      expect(name).toBe("leads_visible_to_user");
      expect(opts).toEqual({ head: true, count: "exact" });
    }
    expect(body.data.facets.collaborator.options).toEqual([
      { name: "u1", count: 4 },
      { name: "u2", count: 4 },
    ]);
  });

  it("a malformed ?f= (not valid base64url JSON) is a 422, never an unhandled throw", async () => {
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: [] }));
    const { GET } = await import("./route");
    const res = await GET(fakeReq({ [FILTER_PARAM]: "not-valid-base64url-json!!" }));
    expect(res.status).toBe(422);
  });

  it("an ?f= tree referencing an unknown field is a single 422 with all errors, not a throw mid-compile", async () => {
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: [] }));
    const { GET } = await import("./route");
    const tree = { conjunction: "and" as const, conditions: [{ id: "c1", field: "not_a_real_field", op: "is" as const, value: "x" }] };
    const res = await GET(fakeReq({ [FILTER_PARAM]: encodeFilterTree(tree) }));
    expect(res.status).toBe(422);
  });

  // ADVANCED-FILTERS-BRIEF Phase 3 addendum §E: treeToAggregateParams() pulled the
  // Phase 5 downgrade forward — a pure-AND, fully-expressible ?f= tree now DOES drive
  // real facet counts (superseding Phase 2's blanket counts:null-whenever-?f=-present
  // behavior below, which is now only a fallback for the non-expressible case).
  it("?facets=source with an EXPRESSIBLE ?f= tree computes real counts via treeToAggregateParams — not counts:null", async () => {
    createClientMock.mockResolvedValue({ rpc: () => Promise.resolve({ data: [], error: null }) });
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: [] }));
    const { GET } = await import("./route");
    const res = await GET(fakeReq({ facets: "source", [FILTER_PARAM]: encodedTreeFor({ status: "contacted" }) }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ facet: "source", options: [] });
  });

  it("?facets=source with a NON-expressible ?f= tree (OR group) skips getSourceFacet entirely and returns counts:null, never partial/wrong counts", async () => {
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: [] }));
    const { GET } = await import("./route");
    const orTree = {
      conjunction: "and" as const,
      conditions: [],
      groups: [
        {
          conjunction: "or" as const,
          conditions: [
            { id: "c1", field: "status", op: "is" as const, value: "contacted" },
            { id: "c2", field: "status", op: "is" as const, value: "new" },
          ],
        },
      ],
    };
    const res = await GET(fakeReq({ facets: "source", [FILTER_PARAM]: encodeFilterTree(orTree) }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ facet: "source", options: [], counts: null });
  });

  it("?facets=source,assignee with a NON-expressible ?f= tree: source is null (no number) but assignee is STILL counted exactly — it no longer depends on lead_aggregates() translation", async () => {
    createClientMock.mockResolvedValue({ rpc: () => Promise.reject(new Error("lead_aggregates must not be called")) });
    createServiceClientMock.mockResolvedValue(
      facetDb({ memberIds: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"], countFor: (calls) => (callsMention(calls, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1") ? 6 : 0) }),
    );
    const { GET } = await import("./route");
    const containsTree = {
      conjunction: "and" as const,
      conditions: [{ id: "c1", field: "search", op: "contains" as const, value: "jane" }],
    };
    const res = await GET(fakeReq({ facets: "source,assignee", [FILTER_PARAM]: encodeFilterTree(containsTree) }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({
      facets: { source: null, assignee: { options: [{ name: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", count: 6 }] } },
    });
  });

  it("?facets=assignee with a top-level OR tree returns assignee:null — no faithful per-person count exists, so no number rather than a wrong one", async () => {
    createServiceClientMock.mockResolvedValue(facetDb({ memberIds: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"], countFor: () => 9 }));
    const { GET } = await import("./route");
    const orTree = {
      conjunction: "or" as const,
      conditions: [
        { id: "c1", field: "status", op: "is" as const, value: "contacted" },
        { id: "c2", field: "status", op: "is" as const, value: "new" },
      ],
    };
    const res = await GET(fakeReq({ facets: "assignee", [FILTER_PARAM]: encodeFilterTree(orTree) }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ facets: { assignee: null } });
  });

  it("?facets=source,assignee: source from lead_aggregates(), assignee counted per person from the list's own query (unassigned included, zero counts dropped, sorted by count)", async () => {
    const rpcCalls: unknown[] = [];
    createClientMock.mockResolvedValue({
      rpc: (name: string, params: unknown) => {
        rpcCalls.push([name, params]);
        return Promise.resolve({
          data: [{ dimension: "intake_source", key: "Facebook", bucket: "all", cnt: 3 }],
          error: null,
        });
      },
    });
    const db = facetDb({
      memberIds: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2"],
      countFor: (calls) => (callsMention(calls, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1") ? 5 : callsMention(calls, "assigned_to.is.null") ? 2 : 0),
    });
    createServiceClientMock.mockResolvedValue(db);
    const { GET } = await import("./route");
    const res = await GET(fakeReq({ facets: "source,assignee" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({
      facets: {
        source: { options: [{ name: "Facebook", count: 3 }] },
        assignee: {
          options: [
            { name: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", count: 5 },
            { name: "unassigned", count: 2 },
          ],
        },
      },
    });
    expect(rpcCalls.length).toBe(1); // source only — assignee never touches lead_aggregates()
    expect(db.countChains).toHaveLength(3); // user-1, user-2, unassigned
  });

  it("?facets=source,assignee,collaborator,destination: source+destination via lead_aggregates(), assignee+collaborator via the list's own query", async () => {
    const rpcCalls: unknown[] = [];
    createClientMock.mockResolvedValue({
      rpc: (name: string, params: unknown) => {
        rpcCalls.push([name, params]);
        return Promise.resolve({
          data: [
            { dimension: "intake_source", key: "Facebook", bucket: "all", cnt: 3 },
            { dimension: "destination", key: "UK", bucket: "all", cnt: 9 },
          ],
          error: null,
        });
      },
    });
    createServiceClientMock.mockResolvedValue(facetDb({ memberIds: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2"], countFor: () => 7 }));
    const { GET } = await import("./route");
    const res = await GET(fakeReq({ facets: "source,assignee,collaborator,destination" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.facets.source).toEqual({ options: [{ name: "Facebook", count: 3 }] });
    expect(body.data.facets.destination).toEqual({ options: [{ name: "UK", count: 9 }] });
    expect(body.data.facets.collaborator).toEqual({ options: [{ name: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2", count: 7 }] });
    expect(body.data.facets.assignee).toEqual({
      options: [
        { name: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2", count: 7 },
        { name: "unassigned", count: 7 },
      ],
    });
    expect(rpcCalls.length).toBe(2); // source + destination only
  });

  it("?facets=collaborator counts each person with the list's own filter, replacing the URL's ?collaborators= axis with that one person — the axis being faceted must not filter itself", async () => {
    const other = "22222222-2222-2222-2222-222222222222";
    const candidate = "33333333-3333-3333-3333-333333333333";
    const db = facetDb({ memberIds: [candidate], countFor: () => 1 });
    createServiceClientMock.mockResolvedValue(db);
    const { GET } = await import("./route");
    const res = await GET(fakeReq({ facets: "collaborator", collaborators: other, status: "contacted" }));
    expect(res.status).toBe(200);
    expect(db.countChains).toHaveLength(1);
    const calls = db.countChains[0];
    expect(callsMention(calls, other)).toBe(false); // own axis replaced, not AND-ed
    expect(callsMention(calls, candidate)).toBe(true);
    expect(callsMention(calls, "contacted")).toBe(true); // every OTHER filter still applies
  });

  // The client-reported bug: the Stage filter narrowed the list but not the counts.
  it("?facets=collaborator&stage=<id> applies the stage (and pipeline) scope to every count — the count and the list can't disagree on Stage", async () => {
    const stage = "44444444-4444-4444-4444-444444444444";
    const pipeline = "55555555-5555-5555-5555-555555555555";
    const db = facetDb({ memberIds: ["66666666-6666-6666-6666-666666666666"], countFor: () => 2 });
    createServiceClientMock.mockResolvedValue(db);
    const { GET } = await import("./route");
    const res = await GET(fakeReq({ facets: "collaborator", stage, pipeline }));
    expect(res.status).toBe(200);
    const calls = db.countChains[0];
    expect(calls).toContainEqual(["eq", ["stage_id", stage]]);
    expect(calls).toContainEqual(["eq", ["pipeline_id", pipeline]]);
  });

  it("?facets=source,destination&stage=<id> returns null for both — lead_aggregates() has no stage param, so no number rather than a count that ignores the stage", async () => {
    createClientMock.mockResolvedValue({ rpc: () => Promise.reject(new Error("lead_aggregates must not be called")) });
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: [] }));
    const { GET } = await import("./route");
    const res = await GET(fakeReq({ facets: "source,destination", stage: "44444444-4444-4444-4444-444444444444" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ facets: { source: null, destination: null } });
  });

  it("?facets=source&stage=<id> (legacy single-source shape) returns counts:null instead of stage-blind counts", async () => {
    createClientMock.mockResolvedValue({ rpc: () => Promise.reject(new Error("lead_aggregates must not be called")) });
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: [] }));
    const { GET } = await import("./route");
    const res = await GET(fakeReq({ facets: "source", stage: "44444444-4444-4444-4444-444444444444" }));
    const body = await res.json();
    expect(body.data).toEqual({ facet: "source", options: [], counts: null });
  });

  // THE consistency guard. A facet count is only trustworthy if it is the list's own filter
  // plus one person. For a battery of filter combinations, run the list (no collaborator
  // axis) and a collaborator-facet count for one person, then require the two recorded query
  // chains to be IDENTICAL once the candidate's own clause and the parts that legitimately
  // differ (select projection, ordering) are removed. If someone adds a filter/scope to the
  // list path but not the facet path (or vice versa) — the drift that caused the reported
  // count-vs-rows mismatch — this fails the build.
  const PARITY_CASES: Array<[string, Record<string, string>]> = [
    ["status", { status: "contacted" }],
    ["stage scope", { stage: "44444444-4444-4444-4444-444444444444" }],
    ["pipeline scope", { pipeline: "55555555-5555-5555-5555-555555555555" }],
    ["tag", { tag: "vip" }],
    ["search (contains)", { search: "jane" }],
    ["source", { source: "Facebook,Google" }],
    ["created window", { created: "week" }],
    ["industry none", { industry: "__none__" }],
    ["include_converted", { include_converted: "1" }],
    ["assignees", { assignees: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9" }],
    ["stage + status + search", { stage: "44444444-4444-4444-4444-444444444444", status: "new", search: "x" }],
  ];

  it.each(PARITY_CASES)("facet count chain == list chain (+ the person): %s", async (_name, params) => {
    const candidate = "77777777-7777-7777-7777-777777777777";
    const strip = (calls: Call[]) =>
      calls.filter(([m, args]) => m !== "select" && m !== "order" && !JSON.stringify(args).includes(candidate));

    const listCalls: Call[] = [];
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: listCalls }));
    const { GET } = await import("./route");
    expect((await GET(fakeReq(params))).status).toBe(200);

    const db = facetDb({ memberIds: [candidate], countFor: () => 1 });
    createServiceClientMock.mockResolvedValue(db);
    expect((await GET(fakeReq({ ...params, facets: "collaborator" }))).status).toBe(200);

    expect(db.countChains).toHaveLength(1);
    expect(strip(db.countChains[0])).toEqual(strip(listCalls));
    // ...and the person really was added (the count isn't the unfiltered list).
    expect(callsMention(db.countChains[0], candidate)).toBe(true);
  });

  it("a failing per-person count surfaces as 503 — a half-answered facet is never returned as if complete", async () => {
    createServiceClientMock.mockResolvedValue({
      from: (table: string) => {
        if (table === "tenant_users") {
          return { select: () => ({ eq: () => Promise.resolve({ data: [{ user_id: "u1" }], error: null }) }) };
        }
        const calls: Call[] = [];
        const chain = makeLeadsChain(calls) as Record<string, unknown>;
        chain.then = (resolve: (v: { data: null; error: { message: string }; count: null }) => void) =>
          resolve({ data: null, error: { message: "boom" }, count: null });
        return chain;
      },
    });
    const { GET } = await import("./route");
    const res = await GET(fakeReq({ facets: "assignee" }));
    expect(res.status).toBe(503);
  });

  it("?facets=source WITHOUT ?f= is completely unaffected — still returns the legacy {facet,options} shape", async () => {
    createClientMock.mockResolvedValue({ rpc: () => Promise.resolve({ data: [], error: null }) });
    createServiceClientMock.mockResolvedValue(fakeDb({ leadsCalls: [] }));
    const { GET } = await import("./route");
    const res = await GET(fakeReq({ facets: "source" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ facet: "source", options: [] });
  });
});
