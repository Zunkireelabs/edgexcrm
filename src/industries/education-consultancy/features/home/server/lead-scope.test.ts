import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/api/auth";

const rpcMock = vi.hoisted(() => vi.fn());
const memberIds = vi.hoisted(() => vi.fn(async () => ["u1", "u2"]));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: (...a: unknown[]) => { rpcMock(...a); return { select: (c: string) => ({ via: "rpc", c }) }; } }) }));
vi.mock("@/lib/leads/branch-membership", () => ({ branchMemberIds: memberIds }));

const auth = { userId: "m", tenantId: "t" } as AuthContext;
const fakeDb = () => {
  const calls: Array<[string, unknown[]]> = [];
  const q: Record<string, unknown> = {};
  q.select = (...a: unknown[]) => (calls.push(["select", a]), q);
  q.in = (...a: unknown[]) => (calls.push(["in", a]), q);
  return { db: { from: (t: string) => (calls.push(["from", [t]]), q), raw: () => ({}) } as never, calls };
};

beforeEach(() => { rpcMock.mockClear(); memberIds.mockClear(); });

describe("makeLeadScope uses the leads list's own branch definitions", () => {
  it("owner on 'Overall': the whole tenant, no branch filter", async () => {
    const { makeLeadScope } = await import("./lead-scope");
    const f = fakeDb();
    const s = await makeLeadScope(f.db, auth, { mode: "manager", branchId: null, pinned: false });
    s.select("id");
    expect(s.definition).toBe("tenant");
    expect(f.calls.some(([fn]) => fn === "in")).toBe(false);
    expect(memberIds).not.toHaveBeenCalled();
  });
  it("owner with the picker on a branch: assigned to a member of that branch (the list's ?branch_id= filter), not leads.branch_id", async () => {
    const { makeLeadScope } = await import("./lead-scope");
    const f = fakeDb();
    const s = await makeLeadScope(f.db, auth, { mode: "manager", branchId: "b1", pinned: false });
    s.select("id");
    expect(s.definition).toBe("branch-members");
    expect(memberIds).toHaveBeenCalledWith(expect.anything(), "t", "b1");
    expect(f.calls).toContainEqual(["in", ["assigned_to", ["u1", "u2"]]]);
  });
  it("branch-pinned manager: the visibility RPC (members OR unassigned in branch OR lead_branches), like the list", async () => {
    const { makeLeadScope } = await import("./lead-scope");
    const s = await makeLeadScope(fakeDb().db, auth, { mode: "manager", branchId: "b1", pinned: true });
    s.select("id");
    expect(s.definition).toBe("branch-visibility");
    expect(rpcMock).toHaveBeenCalledWith("leads_visible_to_user", { p_tenant: "t", p_scope: "branch", p_branch_id: "b1" }, undefined);
  });
});
