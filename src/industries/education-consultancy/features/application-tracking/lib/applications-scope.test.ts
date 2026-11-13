import { describe, expect, it, vi, beforeEach } from "vitest";
import { createFakeSupabase, type FakeSupabase } from "./__test__/fake-postgrest";

// B1: the ONE scoping rule, own / branch / all. The visibility RPC is stood in by a table of the
// leads the caller can see; the fake caps responses at 1000 like the real server.
const rpc = vi.hoisted(() => ({ calls: [] as unknown[], fail: false }));
vi.mock("@/lib/leads/visibility-query", () => ({
  visibleLeadsBase: (clients: { user: FakeSupabase }, tenantId: string, scope: unknown) => {
    rpc.calls.push({ tenantId, scope });
    if (rpc.fail) {
      const failing = { select: () => failing, is: () => failing, order: () => failing, range: () => Promise.resolve({ data: null, error: { message: "boom" } }) };
      return failing;
    }
    return clients.user.from("visible_leads").select();
  },
}));

import { resolveApplicationsScope, type ApplicationsScopeAuth } from "./applications-scope";

const perms = (leadScope: "own" | "team" | "all", baseTier: "owner" | "admin" | "member" = "member") =>
  ({ baseTier, leadScope, pipelineAccess: "all", canManageApplications: true }) as unknown as ApplicationsScopeAuth["permissions"];
const auth = (o: Partial<ApplicationsScopeAuth>): ApplicationsScopeAuth => ({
  tenantId: "t", userId: "me", industryId: "education_consultancy", permissions: perms("all", "admin"), branchId: null, positionSlug: null, ...o,
});

let user: FakeSupabase;
let service: FakeSupabase;
beforeEach(() => {
  rpc.calls = [];
  rpc.fail = false;
  user = createFakeSupabase({ visible_leads: Array.from({ length: 2300 }, (_, i) => ({ id: `lead-${String(i).padStart(4, "0")}`, deleted_at: null })) });
  service = createFakeSupabase({
    tenant_users: [
      { tenant_id: "t", branch_id: "b1", user_id: "u1" },
      { tenant_id: "t", branch_id: "b1", user_id: "u2" },
      { tenant_id: "t", branch_id: "b2", user_id: "u3" },
    ],
  });
});
const run = (a: ApplicationsScopeAuth) => resolveApplicationsScope({ user: user as never, service: service as never }, a);

describe("resolveApplicationsScope", () => {
  it("own scope: the collaborator-aware visible leads, paged past PostgREST's 1000 cap", async () => {
    const r = await run(auth({ permissions: perms("own") }));
    expect(r.kind).toBe("own");
    expect(r.scope.teamMemberIds).toBeNull();
    expect(r.scope.leadIds).toHaveLength(2300);
    expect(new Set(r.scope.leadIds).size).toBe(2300);
    expect(rpc.calls[0]).toMatchObject({ tenantId: "t", scope: { restrictToSelf: true, userId: "me" } });
  });

  it("own scope fails CLOSED when the visibility read fails (no leads, error reported)", async () => {
    rpc.fail = true;
    const r = await run(auth({ permissions: perms("own") }));
    expect(r.scope).toEqual({ leadIds: [], teamMemberIds: null });
    expect(r.error).toBe("boom");
  });

  it("branch scope: the branch's member ids, no lead-id list", async () => {
    const r = await run(auth({ permissions: perms("team"), branchId: "b1" }));
    expect(r.kind).toBe("branch");
    expect(r.scope).toEqual({ leadIds: null, teamMemberIds: ["u1", "u2"] });
    expect(rpc.calls).toHaveLength(0);
  });

  it("team scope with no branch falls back to own, never all (§4.1)", async () => {
    const r = await run(auth({ permissions: perms("team"), branchId: null }));
    expect(r.kind).toBe("own");
    expect(r.scope.leadIds).toHaveLength(2300);
  });

  it("all scope (owner/admin): no restriction", async () => {
    const r = await run(auth({}));
    expect(r).toEqual({ scope: { leadIds: null, teamMemberIds: null }, error: null, kind: "all" });
  });

  it("an education counsellor in a branch carries the cross-branch pool slug into the own-scope read", async () => {
    await run(auth({ permissions: perms("own"), branchId: "b1", positionSlug: "counselor" }));
    expect(rpc.calls[0]).toMatchObject({ scope: { restrictToSelf: true, userBranchId: "b1", crossBranchPoolListSlug: "prospects" } });
  });
});
