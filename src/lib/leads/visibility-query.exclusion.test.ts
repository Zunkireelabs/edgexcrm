import { describe, it, expect } from "vitest";
import { visibleLeadsBase } from "./visibility-query";

// Collaborators "is none of" (migration 282): the exclusion runs over a SQL function for EVERY role. The tenant-isolation
// invariant from visibility-query.test.ts still holds — the SECURITY DEFINER visibility RPC is only ever called on the
// USER client (it needs a real auth.uid()); the only service-client RPC is the tenant-scoped, service-role-only function.

type RpcCall = [name: string, params: Record<string, unknown>, opts: unknown];

function fakeClients() {
  const userRpc: RpcCall[] = [];
  const serviceRpc: RpcCall[] = [];
  const serviceFrom: string[] = [];
  const user = {
    rpc: (name: string, params: Record<string, unknown>, opts: unknown) => { userRpc.push([name, params, opts]); return { __client: "user" }; },
    from: () => { throw new Error("user client must never call .from()"); },
  };
  const service = {
    rpc: (name: string, params: Record<string, unknown>, opts: unknown) => { serviceRpc.push([name, params, opts]); return { __client: "service" }; },
    from: (t: string) => { serviceFrom.push(t); return { select: () => ({ eq: () => ({ __client: "service-from" }) }) }; },
  };
  return { user, service, userRpc, serviceRpc, serviceFrom };
}

const A = "11111111-2222-4333-8444-555555555555";
const B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clients = (c: ReturnType<typeof fakeClients>) => ({ user: c.user as any, service: c.service as any });

describe("visibleLeadsBase — collaborator exclusion", () => {
  it("own scope: the filtered visibility RPC on the USER client, exclude list passed, unused args omitted", () => {
    const c = fakeClients();
    visibleLeadsBase(clients(c), "t1", { restrictToSelf: true, userId: "u1" }, undefined, { collaboratorExclusion: { excludeIds: [A] } });
    expect(c.userRpc).toEqual([
      ["leads_visible_to_user_with_collaborator_filter", { p_tenant: "t1", p_user: "u1", p_scope: "own", p_exclude_ids: [A] }, undefined],
    ]);
    expect(c.serviceRpc).toHaveLength(0);
    expect(Object.keys(c.userRpc[0][1])).not.toContain("p_include_ids");
  });

  it("own scope keeps the branch + cross-pool args, and passes an include list when given", () => {
    const c = fakeClients();
    visibleLeadsBase(clients(c), "t1", { restrictToSelf: true, userId: "u1", userBranchId: "b1", crossBranchPoolListSlug: "pool" }, undefined,
      { collaboratorExclusion: { excludeIds: [A], includeIds: [B] } });
    expect(c.userRpc[0][1]).toEqual({
      p_tenant: "t1", p_user: "u1", p_scope: "own", p_user_branch_id: "b1", p_cross_pool_slug: "pool", p_exclude_ids: [A], p_include_ids: [B],
    });
  });

  it("branch scope: the filtered visibility RPC with the branch args", () => {
    const c = fakeClients();
    visibleLeadsBase(clients(c), "t1", { branchId: "b9" }, { count: "exact", head: true }, { collaboratorExclusion: { excludeIds: [A, B] } });
    expect(c.userRpc).toEqual([
      ["leads_visible_to_user_with_collaborator_filter", { p_tenant: "t1", p_scope: "branch", p_branch_id: "b9", p_exclude_ids: [A, B] }, { count: "exact", head: true }],
    ]);
  });

  it("owner/admin: the tenant function on the SERVICE client, scoped by p_tenant, never the visibility RPC", () => {
    const c = fakeClients();
    visibleLeadsBase(clients(c), "t1", undefined, undefined, { collaboratorExclusion: { excludeIds: [A] } });
    expect(c.serviceRpc).toEqual([["leads_for_tenant_with_collaborator_filter", { p_tenant: "t1", p_exclude_ids: [A] }, undefined]]);
    expect(c.userRpc).toHaveLength(0);
  });

  it("restrictToSelf without a userId still fails closed (never falls through to the unrestricted function)", () => {
    const c = fakeClients();
    expect(() => visibleLeadsBase(clients(c), "t1", { restrictToSelf: true }, undefined, { collaboratorExclusion: { excludeIds: [A] } })).toThrow();
    expect(c.serviceRpc).toHaveLength(0);
  });

  it("an empty exclude list is ignored: the request takes the existing path unchanged", () => {
    const c = fakeClients();
    visibleLeadsBase(clients(c), "t1", undefined, undefined, { collaboratorExclusion: { excludeIds: [] } });
    expect(c.serviceRpc).toHaveLength(0);
    expect(c.serviceFrom).toEqual(["leads"]);
  });
});
