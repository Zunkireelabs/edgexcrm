import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";
import type { ResolvedPermissions } from "@/lib/api/permissions";

// --- mocks -----------------------------------------------------------
//
// @/lib/api/permissions and @/lib/leads/visibility-query are deliberately NOT
// mocked — leadQueryScope + visibleLeadsBase are the real scoping logic this
// suite proves is wired into the ?counts=1 path (LEAD-LIST-COUNTS-BRIEF), not
// just correct in isolation.

const authenticateRequestMock = vi.fn();
const createServiceClientMock = vi.fn();
const createClientMock = vi.fn();
const getFeatureAccessMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: authenticateRequestMock,
  requireAdmin: vi.fn(() => true),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: createServiceClientMock,
  createClient: createClientMock,
}));

vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: vi.fn() }));

vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));

vi.mock("@/lib/logger", () => ({
  createRequestLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn() })),
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

const LISTS = [
  { id: "list-1", name: "Stage A", slug: "stage-a", sort_order: 1, access: { mode: "all" } },
  { id: "list-2", name: "Stage B", slug: "stage-b", sort_order: 2, access: { mode: "all" } },
];

function fakeListsServiceClient() {
  return {
    from: (table: string) => {
      if (table !== "lead_lists") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: LISTS, error: null }),
          }),
        }),
      };
    },
  };
}

type RpcCall = [name: string, params: unknown, opts: unknown];
type FromCall = [selectOpts: unknown];

// Service client for the unrestricted (owner/admin) scope test: the RLS-scoping fix
// (Phase A §2b) moved visibleLeadsBase()'s unrestricted branch onto the service
// client, so this fixture must answer both "lead_lists" (the initial list fetch)
// and "leads" (the per-list count-only query) — unlike fakeListsServiceClient(),
// which only stubs "lead_lists" and throws on "leads".
function fakeUnrestrictedServiceClient(fromCalls: FromCall[]) {
  function chain() {
    let listId: string | undefined;
    const c: Record<string, unknown> = {
      eq: (col: string, val: string) => {
        if (col === "list_id") listId = val;
        return c;
      },
      is: () => c,
      then: (resolve: (v: { count: number; error: null }) => void) =>
        resolve({ count: listId ? ({ "list-1": 40, "list-2": 12 }[listId] ?? 0) : 0, error: null }),
    };
    return c;
  }
  return {
    from: (table: string) => {
      if (table === "lead_lists") {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: LISTS, error: null }),
            }),
          }),
        };
      }
      if (table === "leads") {
        return {
          select: (_cols: string, selOpts: unknown) => {
            fromCalls.push([selOpts]);
            return chain();
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

// Records every rpc(name, params, opts) call and every from("leads").select(cols, opts)
// call, and terminates each chain's .eq(...).is(...) tail as a thenable resolving to a
// count keyed by whichever list_id was filtered on — mirrors the real
// PostgrestFilterBuilder being awaitable without an explicit terminal method.
function fakeCountClient(opts: {
  countsByListId: Record<string, number>;
  rpcCalls: RpcCall[];
  fromCalls: FromCall[];
}) {
  function chain() {
    let listId: string | undefined;
    const c: Record<string, unknown> = {
      eq: (col: string, val: string) => {
        if (col === "list_id") listId = val;
        return c;
      },
      is: () => c,
      then: (resolve: (v: { count: number; error: null }) => void) =>
        resolve({ count: listId ? (opts.countsByListId[listId] ?? 0) : 0, error: null }),
    };
    return c;
  }
  return {
    rpc: (name: string, params: unknown, rpcOpts: unknown) => {
      opts.rpcCalls.push([name, params, rpcOpts]);
      return chain();
    },
    from: (table: string) => {
      if (table !== "leads") throw new Error(`unexpected table ${table}`);
      return {
        select: (_cols: string, selOpts: unknown) => {
          opts.fromCalls.push([selOpts]);
          return chain();
        },
      };
    },
  };
}

describe("GET /api/v1/lead-lists — ?counts=1 opt-in + visibility scoping (LEAD-LIST-COUNTS-BRIEF)", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    createServiceClientMock.mockReset();
    createClientMock.mockReset();
    getFeatureAccessMock.mockReset();
    getFeatureAccessMock.mockReturnValue(true);
    createServiceClientMock.mockResolvedValue(fakeListsServiceClient());
  });

  it("default (no ?counts=1) returns lists with no count field and never touches the count client", async () => {
    authenticateRequestMock.mockResolvedValue(authFixture({ permissions: permissions({ leadScope: "all" }) }));

    const { GET } = await import("./route");
    const res = await GET(fakeReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.data.every((l: { count?: number }) => l.count === undefined)).toBe(true);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("?counts=1 for a counselor (leadScope:'own') routes every per-list count through the uncapped leads_visible_to_user() RPC, scope 'own', as a count-only (head:true) call — not the tenant-wide total", async () => {
    const rpcCalls: RpcCall[] = [];
    const fromCalls: FromCall[] = [];
    authenticateRequestMock.mockResolvedValue(
      authFixture({ userId: "user-1", permissions: permissions({ leadScope: "own" }) }),
    );
    createClientMock.mockResolvedValue(
      fakeCountClient({ countsByListId: { "list-1": 3, "list-2": 7 }, rpcCalls, fromCalls }),
    );

    const { GET } = await import("./route");
    const res = await GET(fakeReq({ counts: "1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(fromCalls).toEqual([]); // never falls through to the unrestricted plain-select path
    expect(rpcCalls).toHaveLength(2);
    for (const [name, params, callOpts] of rpcCalls) {
      expect(name).toBe("leads_visible_to_user");
      expect(params).toEqual({ p_tenant: "tenant-1", p_user: "user-1", p_scope: "own" });
      // Count-only: no rows requested over the wire.
      expect(callOpts).toEqual({ count: "exact", head: true });
    }
    const byId = Object.fromEntries(body.data.map((l: { id: string; count: number }) => [l.id, l.count]));
    expect(byId).toEqual({ "list-1": 3, "list-2": 7 });
  });

  it("?counts=1 for an owner (leadScope:'all') uses the plain tenant-wide count-only select, not the RPC", async () => {
    const rpcCalls: RpcCall[] = [];
    const fromCalls: FromCall[] = [];
    authenticateRequestMock.mockResolvedValue(
      authFixture({ userId: "admin-1", role: "owner", permissions: permissions({ leadScope: "all" }) }),
    );
    // Unrestricted scope never calls the RPC, so countClient (createClient()) is unused
    // here — the unrestricted branch reads via the service client instead (Phase A §2b).
    createClientMock.mockResolvedValue(fakeCountClient({ countsByListId: {}, rpcCalls, fromCalls: [] }));
    createServiceClientMock.mockResolvedValue(fakeUnrestrictedServiceClient(fromCalls));

    const { GET } = await import("./route");
    const res = await GET(fakeReq({ counts: "1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(rpcCalls).toEqual([]); // unrestricted scope never goes through the RPC
    expect(fromCalls).toHaveLength(2);
    for (const [selOpts] of fromCalls) {
      expect(selOpts).toEqual({ count: "exact", head: true });
    }
    const byId = Object.fromEntries(body.data.map((l: { id: string; count: number }) => [l.id, l.count]));
    expect(byId).toEqual({ "list-1": 40, "list-2": 12 });
  });
});
