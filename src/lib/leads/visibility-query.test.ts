import { describe, it, expect } from "vitest";
import { visibleLeadsBase } from "./visibility-query";

// TENANT-ISOLATION-TESTS-BRIEF.md §2c — visibleLeadsBase() is the Phase A landmine: it's
// the one place that decides whether a query goes to the user-context client (RLS-scoped,
// required for the SECURITY DEFINER leads_visible_to_user() RPC to see a real auth.uid())
// or the service client (bypasses RLS, needs its own explicit tenant_id filter). Getting
// the client wrong in either direction is either a silent zero-rows bug (RPC on a service
// client — SECURITY DEFINER fails closed without auth.uid()) or a cross-tenant leak
// (unrestricted branch on a client with no tenant filter).

type RpcCall = [name: string, params: unknown, opts: unknown];

function fakeClients() {
  const userRpcCalls: RpcCall[] = [];
  const serviceFromCalls: string[] = [];
  const eqCalls: [string, unknown][] = [];

  const user = {
    rpc: (name: string, params: unknown, opts: unknown) => {
      userRpcCalls.push([name, params, opts]);
      return { __client: "user", __rpc: name };
    },
    from: () => {
      throw new Error("unrestricted/user client must never call .from() directly — that's the service client's job");
    },
  };

  const service = {
    from: (table: string) => {
      serviceFromCalls.push(table);
      return {
        select: () => ({
          eq: (col: string, val: unknown) => {
            eqCalls.push([col, val]);
            return { __client: "service", __table: table, __eq: [col, val] };
          },
        }),
      };
    },
    rpc: () => {
      throw new Error("service client must never take the RPC branch — leads_visible_to_user() is fail-closed without a real auth.uid()");
    },
  };

  return { user, service, userRpcCalls, serviceFromCalls, eqCalls };
}

describe("visibleLeadsBase — client routing (TENANT-ISOLATION-TESTS-BRIEF §2c)", () => {
  it("restrictToSelf routes to the leads_visible_to_user RPC on the USER client, scope 'own'", () => {
    const { user, service, userRpcCalls } = fakeClients();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = visibleLeadsBase({ user: user as any, service: service as any }, "tenant-1", {
      restrictToSelf: true,
      userId: "user-1",
    });

    expect(userRpcCalls).toEqual([
      ["leads_visible_to_user", { p_tenant: "tenant-1", p_user: "user-1", p_scope: "own" }, undefined],
    ]);
    // @ts-expect-error — test-only marker set by the fake client
    expect(result.__client).toBe("user");
  });

  it("restrictToSelf with no userId throws (fail-closed guard — never falls through to the unrestricted tenant-wide query)", () => {
    const { user, service } = fakeClients();
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      visibleLeadsBase({ user: user as any, service: service as any }, "tenant-1", { restrictToSelf: true }),
    ).toThrow(/restrictToSelf requires scope.userId/);
  });

  it("branchId (no restrictToSelf) routes to the same RPC on the USER client, scope 'branch'", () => {
    const { user, service, userRpcCalls } = fakeClients();
    const result = visibleLeadsBase(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { user: user as any, service: service as any },
      "tenant-1",
      { branchId: "branch-1" },
    );

    expect(userRpcCalls).toEqual([
      ["leads_visible_to_user", { p_tenant: "tenant-1", p_scope: "branch", p_branch_id: "branch-1" }, undefined],
    ]);
    // @ts-expect-error — test-only marker set by the fake client
    expect(result.__client).toBe("user");
  });

  it("unrestricted (owner/admin, no scope flags) routes to the SERVICE client, plain .from('leads').eq('tenant_id', …) — no RPC", () => {
    const { user, service, userRpcCalls, serviceFromCalls, eqCalls } = fakeClients();
    const result = visibleLeadsBase(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { user: user as any, service: service as any },
      "tenant-1",
      undefined,
    );

    expect(userRpcCalls).toEqual([]);
    expect(serviceFromCalls).toEqual(["leads"]);
    expect(eqCalls).toEqual([["tenant_id", "tenant-1"]]);
    // @ts-expect-error — test-only marker set by the fake client
    expect(result.__client).toBe("service");
  });
});

// Migration 255: scoped callers apply the Collaborators "is any of" filter IN SQL, because a PostgREST
// filter on an embedded table cannot run over an RPC base (42703 "column pgrst_call.user_id does not
// exist"). visibleLeadsBase() only swaps WHICH function it calls and adds p_collaborator_ids — the scope
// arguments (and therefore every visibility rule) are identical either way.
describe("visibleLeadsBase — collaborator filter in SQL (migration 255)", () => {
  const A = "11111111-1111-1111-1111-111111111111";
  const B = "22222222-2222-2222-2222-222222222222";
  const base = (scope: Parameters<typeof visibleLeadsBase>[2], extra?: Parameters<typeof visibleLeadsBase>[4]) => {
    const { user, service, userRpcCalls } = fakeClients();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    visibleLeadsBase({ user: user as any, service: service as any }, "tenant-1", scope, undefined, extra);
    return userRpcCalls;
  };

  it("own scope + collaborators: calls leads_visible_to_user_with_collaborators with the SAME scope args plus p_collaborator_ids", () => {
    expect(base({ restrictToSelf: true, userId: "user-1", userBranchId: "b1" }, { collaboratorIds: [A, B] })).toEqual([
      [
        "leads_visible_to_user_with_collaborators",
        { p_tenant: "tenant-1", p_user: "user-1", p_scope: "own", p_user_branch_id: "b1", p_collaborator_ids: [A, B] },
        undefined,
      ],
    ]);
  });

  it("branch scope + collaborators: same scope args plus p_collaborator_ids", () => {
    expect(base({ branchId: "branch-1" }, { collaboratorIds: [A] })).toEqual([
      [
        "leads_visible_to_user_with_collaborators",
        { p_tenant: "tenant-1", p_scope: "branch", p_branch_id: "branch-1", p_collaborator_ids: [A] },
        undefined,
      ],
    ]);
  });

  it.each([[undefined], [null], [[]]])("no usable collaborator ids (%j): the plain leads_visible_to_user, no p_collaborator_ids key", (ids) => {
    const calls = base({ branchId: "branch-1" }, { collaboratorIds: ids as never });
    expect(calls[0][0]).toBe("leads_visible_to_user");
    expect(calls[0][1]).not.toHaveProperty("p_collaborator_ids");
  });

  it("never passes an explicit null (PostgREST serialises it as the string 'null' → 22P02)", () => {
    for (const extra of [undefined, { collaboratorIds: [A] }]) {
      for (const scope of [{ restrictToSelf: true, userId: "u" }, { branchId: "b" }]) {
        const params = base(scope, extra)[0][1] as Record<string, unknown>;
        expect(Object.values(params).includes(null)).toBe(false);
      }
    }
  });

  it("owner/admin (plain table) ignores collaborator ids — they keep the embed filter, and never touch the RPC", () => {
    const { user, service, userRpcCalls, serviceFromCalls } = fakeClients();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    visibleLeadsBase({ user: user as any, service: service as any }, "tenant-1", undefined, undefined, { collaboratorIds: [A] });
    expect(userRpcCalls).toEqual([]);
    expect(serviceFromCalls).toEqual(["leads"]);
  });

  it("does not mutate the caller's id array", () => {
    const ids = Object.freeze([A, B]);
    expect(() => base({ branchId: "b" }, { collaboratorIds: ids })).not.toThrow();
  });
});
