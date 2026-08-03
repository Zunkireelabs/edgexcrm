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
