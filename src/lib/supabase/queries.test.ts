import { describe, it, expect, vi, beforeEach } from "vitest";

// getLeadsPage's branch-scope predicate — verifies BRANCH-SCOPE-TRUNCATION-503-BRIEF
// §4.2: branch scope must route through visibleLeadsBase() -> leads_visible_to_user() RPC,
// the same base /api/v1/leads uses, not a hand-rolled
// `.or(assigned_to.in.(…),and(assigned_to.is.null,branch_id.eq.…))` built from a separate
// branchMemberIds() lookup. (Originally proved against getLeadsForPipeline, the classic
// pipeline board's now-removed capped-at-500 loader — pipeline-column-pagination Phase 2
// moved the board onto getLeadsPage's own per-column pagination, which shares the same
// visibleLeadsBase() plumbing, so the coverage moves with it rather than being dropped.)

type RpcCall = [name: string, params: unknown];
type Call = [method: string, args: unknown[]];

// .order()-terminal chain builder — for queries (getLeadNotes/getLeadChecklists/
// getFormConfigsForTenant/getBranches) whose chain ends at .order().
function makeChain(calls: Call[], terminal: { data: unknown[]; error: unknown }) {
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
    limit: record("limit"),
    order: () => Promise.resolve(terminal),
  };
  return chain;
}

// getLeadsPage's chain ends in .range(), and .order() is chainable (not terminal).
function makeRangeChain(calls: Call[], terminal: { data: unknown[]; error: unknown; count: number | null }) {
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
    range: (...args: unknown[]) => {
      calls.push(["range", args]);
      return Promise.resolve(terminal);
    },
  };
  return chain;
}

// A range-terminal RPC double for the branch/own-scope RPC-routing proof — getLeadsPage's
// chain ends in .range(), not .order().
function fakeRangeClient(rpcCalls: RpcCall[], leadsCalls: Call[]) {
  return {
    rpc: (name: string, params: unknown) => {
      rpcCalls.push([name, params]);
      return makeRangeChain(leadsCalls, { data: [], error: null, count: 0 });
    },
    from: (table: string) => {
      if (table !== "leads") throw new Error(`unexpected table ${table}`);
      return makeRangeChain(leadsCalls, { data: [], error: null, count: 0 });
    },
  };
}

const createClientMock = vi.fn();
const createServiceClientMock = vi.fn();
const branchMemberIdsMock = vi.fn();

vi.mock("./server", () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
  getCachedUser: vi.fn(),
}));

vi.mock("@/lib/leads/branch-membership", () => ({
  branchMemberIds: branchMemberIdsMock,
  getLeadMembership: vi.fn(),
}));

vi.mock("@/lib/leads/collaborators", () => ({ isLeadCollaborator: vi.fn() }));
vi.mock("./scoped", () => ({ scopedClientForTenant: vi.fn() }));

describe("getLeadsPage — branch scope (BRANCH-SCOPE-TRUNCATION-503-BRIEF §4.2)", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
    branchMemberIdsMock.mockReset();
  });

  it("branch scope routes through the leads_visible_to_user RPC, not a hand-rolled .or() built from branchMemberIds", async () => {
    const rpcCalls: RpcCall[] = [];
    const leadsCalls: Call[] = [];
    createClientMock.mockResolvedValue(fakeRangeClient(rpcCalls, leadsCalls));
    createServiceClientMock.mockResolvedValue(fakeRangeClient(rpcCalls, leadsCalls));

    const { getLeadsPage } = await import("./queries");
    const result = await getLeadsPage("tenant-1", { branchId: "branch-1" }, 1, 20, { skipCount: true });

    expect(result.leads).toEqual([]);
    expect(rpcCalls).toEqual([
      ["leads_visible_to_user", { p_tenant: "tenant-1", p_scope: "branch", p_branch_id: "branch-1" }],
    ]);
    // Branch scope must not resolve branch members via branchMemberIds() and build
    // .or(...) itself — that predicate lives inside the RPC now.
    expect(branchMemberIdsMock).not.toHaveBeenCalled();
    expect(leadsCalls.some(([m]) => m === "or")).toBe(false);
  });

  it("own scope (restrictToSelf) still routes through the RPC as scope 'own', unaffected by the branch-scope fix", async () => {
    const rpcCalls: RpcCall[] = [];
    const leadsCalls: Call[] = [];
    createClientMock.mockResolvedValue(fakeRangeClient(rpcCalls, leadsCalls));
    createServiceClientMock.mockResolvedValue(fakeRangeClient(rpcCalls, leadsCalls));

    const { getLeadsPage } = await import("./queries");
    await getLeadsPage("tenant-1", { restrictToSelf: true, userId: "user-1" }, 1, 20, { skipCount: true });

    expect(rpcCalls).toEqual([
      ["leads_visible_to_user", { p_tenant: "tenant-1", p_user: "user-1", p_scope: "own" }],
    ]);
  });

  it("no scope (owner/admin, unrestricted) stays on the plain unrestricted select — no RPC call", async () => {
    const rpcCalls: RpcCall[] = [];
    const leadsCalls: Call[] = [];
    createClientMock.mockResolvedValue(fakeRangeClient(rpcCalls, leadsCalls));
    createServiceClientMock.mockResolvedValue(fakeRangeClient(rpcCalls, leadsCalls));

    const { getLeadsPage } = await import("./queries");
    await getLeadsPage("tenant-1", {}, 1, 20, { skipCount: true });

    expect(rpcCalls).toEqual([]);
    expect(leadsCalls.some(([m, a]) => m === "eq" && a[0] === "tenant_id")).toBe(true);
  });

  it("scope.stageId applies .eq('stage_id', …) — the classic pipeline board's column identity (pipeline-column-pagination Phase 2)", async () => {
    const rpcCalls: RpcCall[] = [];
    const leadsCalls: Call[] = [];
    createClientMock.mockResolvedValue(fakeRangeClient(rpcCalls, leadsCalls));
    createServiceClientMock.mockResolvedValue(fakeRangeClient(rpcCalls, leadsCalls));

    const { getLeadsPage } = await import("./queries");
    await getLeadsPage("tenant-1", { stageId: "stage-1" }, 1, 20, { skipCount: true });

    expect(leadsCalls.some(([m, a]) => m === "eq" && a[0] === "stage_id" && a[1] === "stage-1")).toBe(true);
  });
});

// getLeadsPage's per-column Kanban extension (KANBAN-PAGINATION-BRIEF §3.1): a `status`
// scope filter (a stage's slug, one column's identity) and a `skipCount` opt that avoids
// an exact-count query per column when the caller already has the true total from
// lead_aggregates (§2b) — "header count always comes from the aggregate, never from
// cards.length" only holds if this path never silently re-derives its own count.
describe("getLeadsPage — Kanban column extension (status filter + skipCount)", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
  });

  it("applies scope.status as an .eq('status', …) filter", async () => {
    const calls: Call[] = [];
    const client = {
      from: (table: string) => {
        if (table !== "leads") throw new Error(`unexpected table ${table}`);
        return makeRangeChain(calls, { data: [], error: null, count: 0 });
      },
    };
    createClientMock.mockResolvedValue(client);
    createServiceClientMock.mockResolvedValue(client);

    const { getLeadsPage } = await import("./queries");
    await getLeadsPage("tenant-1", { listId: "list-1", status: "qualified" }, 1, 20);

    expect(calls.some(([m, a]) => m === "eq" && a[0] === "status" && a[1] === "qualified")).toBe(true);
    expect(calls.some(([m, a]) => m === "eq" && a[0] === "list_id" && a[1] === "list-1")).toBe(true);
    // First page, 20 per column
    expect(calls.some(([m, a]) => m === "range" && a[0] === 0 && a[1] === 19)).toBe(true);
  });

  it("omits scope.status entirely when not provided — existing (non-Kanban) callers untouched", async () => {
    const calls: Call[] = [];
    const client = { from: () => makeRangeChain(calls, { data: [], error: null, count: 0 }) };
    createClientMock.mockResolvedValue(client);
    createServiceClientMock.mockResolvedValue(client);

    const { getLeadsPage } = await import("./queries");
    await getLeadsPage("tenant-1", { listId: "list-1" }, 1, 25);

    expect(calls.some(([m, a]) => m === "eq" && a[0] === "status")).toBe(false);
  });

  it("skipCount:true skips the exact count (no {count:'exact'} on select) and returns total -1", async () => {
    const calls: Call[] = [];
    const client = { from: () => makeRangeChain(calls, { data: [{ id: "lead-1" }], error: null, count: null }) };
    createClientMock.mockResolvedValue(client);
    createServiceClientMock.mockResolvedValue(client);

    const { getLeadsPage } = await import("./queries");
    const result = await getLeadsPage("tenant-1", { listId: "list-1", status: "new" }, 1, 20, { skipCount: true });

    const selectCall = calls.find(([m]) => m === "select");
    expect(selectCall?.[1][1]).toEqual({});
    expect(result.total).toBe(-1);
    expect(result.leads).toEqual([{ id: "lead-1" }]);
  });

  it("without skipCount, still requests an exact count (unaffected by the Kanban extension)", async () => {
    const calls: Call[] = [];
    const client = { from: () => makeRangeChain(calls, { data: [], error: null, count: 42 }) };
    createClientMock.mockResolvedValue(client);
    createServiceClientMock.mockResolvedValue(client);

    const { getLeadsPage } = await import("./queries");
    const result = await getLeadsPage("tenant-1", { listId: "list-1" }, 1, 20);

    const selectCall = calls.find(([m]) => m === "select");
    expect(selectCall?.[1][1]).toEqual({ count: "exact" });
    expect(result.total).toBe(42);
  });
});

// TENANT-ISOLATION-TESTS-BRIEF.md §2b — the new cross-tenant filters Phase A (#354)
// introduced on a service client, which bypasses RLS entirely. These are the only
// thing separating tenants on these paths now.
describe("getLeadNotes — leads!inner(tenant_id) embed filter (TENANT-ISOLATION-TESTS-BRIEF §2b)", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
  });

  it("applies both .eq('lead_id', …) and .eq('leads.tenant_id', …) via the leads!inner embed, and strips the embed from the returned rows", async () => {
    const calls: Call[] = [];
    const selectArgs: unknown[] = [];
    const client = {
      from: (table: string) => {
        if (table !== "lead_notes") throw new Error(`unexpected table ${table}`);
        return {
          select: (...args: unknown[]) => {
            selectArgs.push(...args);
            return makeChain(calls, {
              data: [{ id: "note-1", content: "hi", leads: { tenant_id: "tenant-1" } }],
              error: null,
            });
          },
        };
      },
    };
    createClientMock.mockResolvedValue(client);
    createServiceClientMock.mockResolvedValue(client);

    const { getLeadNotes } = await import("./queries");
    const result = await getLeadNotes("lead-1", "tenant-1");

    expect(selectArgs[0]).toBe("*, leads!inner(tenant_id)");
    expect(calls).toEqual([
      ["eq", ["lead_id", "lead-1"]],
      ["eq", ["leads.tenant_id", "tenant-1"]],
    ]);
    // The embed used only to enforce the tenant filter must not leak into the returned shape.
    expect(result).toEqual([{ id: "note-1", content: "hi" }]);
  });

  it("wrong tenant -> the query returns [] (the embed filter, not app-layer post-filtering, is what protects this)", async () => {
    const calls: Call[] = [];
    const client = {
      from: () => ({
        select: () => makeChain(calls, { data: [], error: null }),
      }),
    };
    createClientMock.mockResolvedValue(client);
    createServiceClientMock.mockResolvedValue(client);

    const { getLeadNotes } = await import("./queries");
    const result = await getLeadNotes("lead-1", "tenant-does-not-own-this-lead");

    expect(calls.some(([m, a]) => m === "eq" && a[0] === "leads.tenant_id" && a[1] === "tenant-does-not-own-this-lead")).toBe(true);
    expect(result).toEqual([]);
  });
});

describe("getLeadChecklists — .eq('tenant_id', …) (TENANT-ISOLATION-TESTS-BRIEF §2b)", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
  });

  it("applies both .eq('lead_id', …) and .eq('tenant_id', …)", async () => {
    const calls: Call[] = [];
    const client = {
      from: (table: string) => {
        if (table !== "lead_checklists") throw new Error(`unexpected table ${table}`);
        return { select: () => makeChain(calls, { data: [], error: null }) };
      },
    };
    createClientMock.mockResolvedValue(client);
    createServiceClientMock.mockResolvedValue(client);

    const { getLeadChecklists } = await import("./queries");
    await getLeadChecklists("lead-1", "tenant-1");

    expect(calls).toEqual([
      ["eq", ["lead_id", "lead-1"]],
      ["eq", ["tenant_id", "tenant-1"]],
    ]);
  });
});

describe("getFormConfigsForTenant — .eq('tenant_id', …) (TENANT-ISOLATION-TESTS-BRIEF §2b)", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
  });

  it("scopes form_configs by tenant_id", async () => {
    const calls: Call[] = [];
    const client = {
      from: (table: string) => {
        if (table !== "form_configs") throw new Error(`unexpected table ${table}`);
        return { select: () => makeChain(calls, { data: [], error: null }) };
      },
    };
    createServiceClientMock.mockResolvedValue(client);

    const { getFormConfigsForTenant } = await import("./queries");
    await getFormConfigsForTenant("tenant-1");

    expect(calls.some(([m, a]) => m === "eq" && a[0] === "tenant_id" && a[1] === "tenant-1")).toBe(true);
  });
});

describe("getBranches — .eq('tenant_id', …) (TENANT-ISOLATION-TESTS-BRIEF §2b)", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
  });

  it("scopes branches by tenant_id", async () => {
    const calls: Call[] = [];
    const client = {
      from: (table: string) => {
        if (table !== "branches") throw new Error(`unexpected table ${table}`);
        return { select: () => makeChain(calls, { data: [], error: null }) };
      },
    };
    createServiceClientMock.mockResolvedValue(client);

    const { getBranches } = await import("./queries");
    await getBranches("tenant-1");

    expect(calls.some(([m, a]) => m === "eq" && a[0] === "tenant_id" && a[1] === "tenant-1")).toBe(true);
  });
});
