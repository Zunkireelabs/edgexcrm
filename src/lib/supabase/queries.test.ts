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
