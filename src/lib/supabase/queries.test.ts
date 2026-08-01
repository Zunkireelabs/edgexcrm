import { describe, it, expect, vi, beforeEach } from "vitest";

// getLeadsForPipeline's branch-scope predicate — verifies BRANCH-SCOPE-TRUNCATION-503-BRIEF
// §4.2: branch scope must route through visibleLeadsBase() -> leads_visible_to_user() RPC,
// the same base /api/v1/leads uses, not the old hand-rolled
// `.or(assigned_to.in.(…),and(assigned_to.is.null,branch_id.eq.…))` built from a separate
// branchMemberIds() lookup.

type RpcCall = [name: string, params: unknown];
type Call = [method: string, args: unknown[]];

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

// getLeadsPage's chain ends in .range(), and .order() is chainable (not terminal) —
// a separate builder from makeChain() above, whose terminal is .order().
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

function fakeClient(rpcCalls: RpcCall[], leadsCalls: Call[]) {
  return {
    rpc: (name: string, params: unknown) => {
      rpcCalls.push([name, params]);
      return makeChain(leadsCalls, { data: [], error: null });
    },
    from: (table: string) => {
      if (table === "leads") return makeChain(leadsCalls, { data: [], error: null });
      if (table === "lead_checklists") {
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
      }
      throw new Error(`unexpected table ${table}`);
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

describe("getLeadsForPipeline — branch scope (BRANCH-SCOPE-TRUNCATION-503-BRIEF §4.2)", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
    branchMemberIdsMock.mockReset();
  });

  it("branch scope routes through the leads_visible_to_user RPC, not a hand-rolled .or() built from branchMemberIds", async () => {
    const rpcCalls: RpcCall[] = [];
    const leadsCalls: Call[] = [];
    createClientMock.mockResolvedValue(fakeClient(rpcCalls, leadsCalls));

    const { getLeadsForPipeline } = await import("./queries");
    const result = await getLeadsForPipeline("tenant-1", { branchId: "branch-1" });

    expect(result).toEqual([]);
    expect(rpcCalls).toEqual([
      ["leads_visible_to_user", { p_tenant: "tenant-1", p_scope: "branch", p_branch_id: "branch-1" }],
    ]);
    // The old path resolved branch members via branchMemberIds() and built .or(...) —
    // neither should happen anymore for branch scope.
    expect(branchMemberIdsMock).not.toHaveBeenCalled();
    expect(leadsCalls.some(([m]) => m === "or")).toBe(false);
  });

  it("own scope (restrictToSelf) still routes through the RPC as scope 'own', unaffected by the branch-scope fix", async () => {
    const rpcCalls: RpcCall[] = [];
    const leadsCalls: Call[] = [];
    createClientMock.mockResolvedValue(fakeClient(rpcCalls, leadsCalls));

    const { getLeadsForPipeline } = await import("./queries");
    await getLeadsForPipeline("tenant-1", { restrictToSelf: true, userId: "user-1" });

    expect(rpcCalls).toEqual([
      ["leads_visible_to_user", { p_tenant: "tenant-1", p_user: "user-1", p_scope: "own" }],
    ]);
  });

  it("no scope (owner/admin, unrestricted) stays on the plain unrestricted select — no RPC call", async () => {
    const rpcCalls: RpcCall[] = [];
    const leadsCalls: Call[] = [];
    createClientMock.mockResolvedValue(fakeClient(rpcCalls, leadsCalls));

    const { getLeadsForPipeline } = await import("./queries");
    await getLeadsForPipeline("tenant-1", {});

    expect(rpcCalls).toEqual([]);
    expect(leadsCalls.some(([m, a]) => m === "eq" && a[0] === "tenant_id")).toBe(true);
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
  });

  it("applies scope.status as an .eq('status', …) filter", async () => {
    const calls: Call[] = [];
    createClientMock.mockResolvedValue({
      from: (table: string) => {
        if (table !== "leads") throw new Error(`unexpected table ${table}`);
        return makeRangeChain(calls, { data: [], error: null, count: 0 });
      },
    });

    const { getLeadsPage } = await import("./queries");
    await getLeadsPage("tenant-1", { listId: "list-1", status: "qualified" }, 1, 20);

    expect(calls.some(([m, a]) => m === "eq" && a[0] === "status" && a[1] === "qualified")).toBe(true);
    expect(calls.some(([m, a]) => m === "eq" && a[0] === "list_id" && a[1] === "list-1")).toBe(true);
    // First page, 20 per column
    expect(calls.some(([m, a]) => m === "range" && a[0] === 0 && a[1] === 19)).toBe(true);
  });

  it("omits scope.status entirely when not provided — existing (non-Kanban) callers untouched", async () => {
    const calls: Call[] = [];
    createClientMock.mockResolvedValue({
      from: () => makeRangeChain(calls, { data: [], error: null, count: 0 }),
    });

    const { getLeadsPage } = await import("./queries");
    await getLeadsPage("tenant-1", { listId: "list-1" }, 1, 25);

    expect(calls.some(([m, a]) => m === "eq" && a[0] === "status")).toBe(false);
  });

  it("skipCount:true skips the exact count (no {count:'exact'} on select) and returns total -1", async () => {
    const calls: Call[] = [];
    createClientMock.mockResolvedValue({
      from: () => makeRangeChain(calls, { data: [{ id: "lead-1" }], error: null, count: null }),
    });

    const { getLeadsPage } = await import("./queries");
    const result = await getLeadsPage("tenant-1", { listId: "list-1", status: "new" }, 1, 20, { skipCount: true });

    const selectCall = calls.find(([m]) => m === "select");
    expect(selectCall?.[1][1]).toEqual({});
    expect(result.total).toBe(-1);
    expect(result.leads).toEqual([{ id: "lead-1" }]);
  });

  it("without skipCount, still requests an exact count (unaffected by the Kanban extension)", async () => {
    const calls: Call[] = [];
    createClientMock.mockResolvedValue({
      from: () => makeRangeChain(calls, { data: [], error: null, count: 42 }),
    });

    const { getLeadsPage } = await import("./queries");
    const result = await getLeadsPage("tenant-1", { listId: "list-1" }, 1, 20);

    const selectCall = calls.find(([m]) => m === "select");
    expect(selectCall?.[1][1]).toEqual({ count: "exact" });
    expect(result.total).toBe(42);
  });
});
