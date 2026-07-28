import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";
import type { ResolvedPermissions } from "@/lib/api/permissions";

// @/lib/api/permissions is deliberately NOT mocked — shouldRestrictToSelf is the
// real scoping logic this suite proves is actually wired into GET /threads.

const authenticateRequestMock = vi.fn();
const scopedClientMock = vi.fn();
const getFeatureAccessMock = vi.fn(() => true);

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));

function permissions(overrides: Partial<ResolvedPermissions> = {}): ResolvedPermissions {
  return {
    baseTier: "member",
    allowedNavKeys: null,
    pipelineAccess: "all",
    listAccess: "all",
    leadScope: "all",
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
    role: "owner",
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

function fakeReq(query: Record<string, string> = {}): Request {
  const url = new URL("https://example.com/api/v1/email/threads");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return { url: url.toString() } as unknown as Request;
}

type Call = [method: string, args: unknown[]];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeThreadsChain(calls: Call[], resolved: { data: unknown[]; error: unknown }): any {
  const methods = ["eq", "or", "is", "in", "order", "limit"];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  for (const m of methods) {
    chain[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(resolved).then(resolve, reject);
  return chain;
}

interface FakeDbOptions {
  ownAccountIds?: string[];
  threadsResult?: { data: unknown[]; error: unknown };
  /** Whether shouldLeadBeVisibleToAssignee returns true. Defaults to true. */
  leadVisible?: boolean;
}

function fakeDb(opts: FakeDbOptions, threadsCalls: Call[]) {
  const leadVisible = opts.leadVisible ?? true;
  return {
    raw() {
      // Provides the raw SupabaseClient used by shouldLeadBeVisibleToAssignee.
      // It queries both `leads` (direct assignment) and `lead_branches`
      // (shared-in membership). We return the appropriate row or null.
      return {
        from(table: string) {
          if (table === "leads") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      is: () => ({
                        maybeSingle: async () => ({
                          data: leadVisible ? { id: "lead-1" } : null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "lead_branches") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: async () => ({ data: null }),
                    }),
                  }),
                }),
              }),
            };
          }
          throw new Error(`fakeDb.raw: unexpected table ${table}`);
        },
      };
    },
    from(table: string) {
      if (table === "connected_email_accounts") {
        return {
          select: () => ({
            eq: async () => ({ data: (opts.ownAccountIds ?? []).map((id) => ({ id })) }),
          }),
        };
      }
      if (table === "email_threads") {
        return {
          select: (...args: unknown[]) => {
            threadsCalls.push(["select", args]);
            return makeThreadsChain(threadsCalls, opts.threadsResult ?? { data: [], error: null });
          },
        };
      }
      throw new Error(`fakeDb: unexpected table ${table}`);
    },
  };
}

beforeEach(() => {
  authenticateRequestMock.mockReset();
  scopedClientMock.mockReset();
  getFeatureAccessMock.mockReset().mockReturnValue(true);
});

describe("GET /api/v1/email/threads — lead_id/contact_id required", () => {
  it("no-params request: returns 422 validation error", async () => {
    authenticateRequestMock.mockResolvedValue(authFixture({ permissions: permissions({ leadScope: "all" }) }));
    const calls: Call[] = [];
    scopedClientMock.mockResolvedValue(fakeDb({}, calls));

    const { GET } = await import("./route");
    const res = await GET(fakeReq({}));

    expect(res.status).toBe(422);
    // Must not have queried email_threads at all
    expect(calls.some((c) => c[0] === "select")).toBe(false);
  });

  it("lead_id given (unrestricted): filters by it, no validation error", async () => {
    authenticateRequestMock.mockResolvedValue(authFixture({ permissions: permissions({ leadScope: "all" }) }));
    const calls: Call[] = [];
    scopedClientMock.mockResolvedValue(fakeDb({}, calls));

    const { GET } = await import("./route");
    const res = await GET(fakeReq({ lead_id: "lead-1" }));

    expect(res.status).toBe(200);
    expect(calls).toContainEqual(["eq", ["lead_id", "lead-1"]]);
    expect(calls.some((c) => c[0] === "limit")).toBe(false);
  });
});

describe("GET /api/v1/email/threads — counselor lead-visibility gate (§8/§9 invariant)", () => {
  it("own-scope user requesting a lead they CANNOT see: returns empty array, no thread bodies exposed", async () => {
    authenticateRequestMock.mockResolvedValue(
      authFixture({ permissions: permissions({ leadScope: "own" }) }),
    );
    const calls: Call[] = [];
    scopedClientMock.mockResolvedValue(fakeDb({ leadVisible: false, ownAccountIds: ["acct-1"] }, calls));

    const { GET } = await import("./route");
    const res = await GET(fakeReq({ lead_id: "lead-1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
    // Must not have reached email_threads at all
    expect(calls.some((c) => c[0] === "select")).toBe(false);
  });

  it("own-scope user requesting a lead they CAN see: NULL-account inbound thread IS returned", async () => {
    authenticateRequestMock.mockResolvedValue(
      authFixture({ permissions: permissions({ leadScope: "own" }) }),
    );
    const calls: Call[] = [];
    const nullAccountThread = {
      id: "thread-inbound",
      connected_email_account_id: null,
      lead_id: "lead-1",
      emails: [{ body_html: "<p>hello</p>" }],
    };
    scopedClientMock.mockResolvedValue(
      fakeDb(
        { leadVisible: true, ownAccountIds: ["acct-1"], threadsResult: { data: [nullAccountThread], error: null } },
        calls,
      ),
    );

    const { GET } = await import("./route");
    const res = await GET(fakeReq({ lead_id: "lead-1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].connected_email_account_id).toBeNull();
    // OR filter must include null arm so inbound-only threads are not dropped
    const orCall = calls.find((c) => c[0] === "or");
    expect(orCall?.[1][0]).toContain("connected_email_account_id.is.null");
  });
});

describe("GET /api/v1/email/threads — counselor scoping never excludes NULL-account threads (§9 step 5)", () => {
  it("counselor with own accounts: uses OR(in-list, is-null) instead of a bare .in() that would hide inbound-only threads", async () => {
    authenticateRequestMock.mockResolvedValue(authFixture({ permissions: permissions({ leadScope: "own" }) }));
    const calls: Call[] = [];
    scopedClientMock.mockResolvedValue(fakeDb({ ownAccountIds: ["acct-1", "acct-2"] }, calls));

    const { GET } = await import("./route");
    const res = await GET(fakeReq({ lead_id: "lead-1" }));

    expect(res.status).toBe(200);
    expect(calls.some((c) => c[0] === "in")).toBe(false);
    const orCall = calls.find((c) => c[0] === "or");
    expect(orCall?.[1][0]).toBe(
      "connected_email_account_id.in.(acct-1,acct-2),connected_email_account_id.is.null",
    );
  });

  it("counselor with ZERO connected accounts: does not short-circuit to an empty list — falls back to NULL-only", async () => {
    authenticateRequestMock.mockResolvedValue(authFixture({ permissions: permissions({ leadScope: "own" }) }));
    const calls: Call[] = [];
    scopedClientMock.mockResolvedValue(fakeDb({ ownAccountIds: [] }, calls));

    const { GET } = await import("./route");
    const res = await GET(fakeReq({ lead_id: "lead-1" }));

    expect(res.status).toBe(200);
    expect(calls.some((c) => c[0] === "in")).toBe(false);
    expect(calls).toContainEqual(["is", ["connected_email_account_id", null]]);
  });

  it("unrestricted (owner/all-scope): no account-id filter is applied at all", async () => {
    authenticateRequestMock.mockResolvedValue(authFixture({ permissions: permissions({ leadScope: "all" }) }));
    const calls: Call[] = [];
    scopedClientMock.mockResolvedValue(fakeDb({}, calls));

    const { GET } = await import("./route");
    await GET(fakeReq({ lead_id: "lead-1" }));

    expect(calls.some((c) => c[0] === "or" || c[0] === "is" || c[0] === "in")).toBe(false);
  });
});
