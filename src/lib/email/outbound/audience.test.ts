import { describe, it, expect } from "vitest";
import { resolveAudience } from "./audience";
import type { AuthContext } from "@/lib/api/auth";
import type { ResolvedPermissions } from "@/lib/api/permissions";
import { EMPTY_TREE } from "@/lib/filters/types";
import type { ScopedClient } from "@/lib/supabase/scoped";

// Mirrors src/lib/sms/audience.test.ts — unit-level (no DB), pins
// resolveAudience's CONTRACT with visibleLeadsBase and the suppression batch
// lookup via fake clients. The "own-scope" test is the non-negotiable one
// (OUTREACH-PHASE1-BRIEF.md §8 item 6): it proves a counselor's audience is
// built only from what visibleLeadsBase returns for THEM, never a hand-rolled
// tenant-wide query — the "blast the wrong people" failure class.

interface FakeLead {
  id: string;
  email: string | null;
  created_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeVisibilityClients(leads: FakeLead[]): { user: any; service: any; userRpcCalls: unknown[][] } {
  const userRpcCalls: unknown[][] = [];
  const chain = () => {
    const node = {
      select: () => node,
      eq: () => node,
      is: () => Promise.resolve({ data: leads, error: null }),
    };
    return node;
  };
  return {
    user: {
      rpc: (name: string, params: unknown, opts: unknown) => {
        userRpcCalls.push([name, params, opts]);
        return chain();
      },
    },
    service: {
      from: () => chain(),
    },
    userRpcCalls,
  };
}

function fakeDb(suppressedEmails: string[]): ScopedClient {
  return {
    from: () => ({
      select: () => ({
        in: (_col: string, values: string[]) =>
          Promise.resolve({
            data: values.filter((v) => suppressedEmails.includes(v)).map((email) => ({ email })),
            error: null,
          }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function baseAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  const permissions: ResolvedPermissions = {
    baseTier: "owner",
    allowedNavKeys: null,
    pipelineAccess: "all",
    listAccess: "all",
    leadScope: "all",
    sharedPoolListIds: new Set(),
    canAssignLeads: true,
    canEditLeads: true,
    canManageApplications: true,
    canManageClasses: true,
    canManageHR: true,
    canExport: true,
    canSendSms: true,
    dashboardWidgets: null,
  };
  return {
    userId: "user-1",
    email: "owner@example.com",
    tenantId: "tenant-1",
    role: "owner",
    industryId: "education_consultancy",
    positionId: null,
    positionSlug: null,
    branchId: null,
    branchMemberIds: [],
    permissions,
    plan: "starter",
    entitlements: {} as AuthContext["entitlements"],
    ...overrides,
  };
}

describe("resolveAudience (email) — classification + duplicate collapse + suppression", () => {
  it("buckets missing/malformed emails, collapses duplicates (case-insensitive), and drops suppressed addresses", async () => {
    const leads: FakeLead[] = [
      { id: "1", email: "Student@Example.com", created_at: "2026-01-01T00:00:00Z" }, // sendable
      { id: "2", email: "student@example.com", created_at: "2026-01-02T00:00:00Z" }, // dup of #1 (case-insensitive, later created_at)
      { id: "3", email: null, created_at: "2026-01-01T00:00:00Z" }, // noEmail
      { id: "4", email: "  ", created_at: "2026-01-01T00:00:00Z" }, // noEmail (blank)
      { id: "5", email: "not-an-email", created_at: "2026-01-01T00:00:00Z" }, // malformed
      { id: "6", email: "optedout@example.com", created_at: "2026-01-01T00:00:00Z" }, // suppressed
    ];
    const { user, service } = fakeVisibilityClients(leads);
    const db = fakeDb(["optedout@example.com"]);

    const result = await resolveAudience(baseAuth(), EMPTY_TREE, { user, service, db });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.audience.matched).toBe(6);
    expect(result.audience.excluded).toEqual({
      noEmail: 2,
      malformed: 1,
      suppressed: 1,
      duplicateEmail: 1,
    });
    expect(result.audience.sendable).toHaveLength(1);
    expect(result.audience.sendable[0]).toMatchObject({ leadId: "1", email: "student@example.com" });
  });

  it("keeps the FIRST duplicate by (created_at, id), not array order", async () => {
    const leads: FakeLead[] = [
      { id: "later", email: "dup@example.com", created_at: "2026-01-05T00:00:00Z" },
      { id: "earlier", email: "dup@example.com", created_at: "2026-01-01T00:00:00Z" },
    ];
    const { user, service } = fakeVisibilityClients(leads);
    const db = fakeDb([]);

    const result = await resolveAudience(baseAuth(), EMPTY_TREE, { user, service, db });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.audience.sendable).toHaveLength(1);
    expect(result.audience.sendable[0].leadId).toBe("earlier");
    expect(result.audience.excluded.duplicateEmail).toBe(1);
  });
});

describe("resolveAudience (email) — permission scoping (the whole reason this goes through visibleLeadsBase)", () => {
  it("an own-scoped (counselor) caller's audience is built from the own-scope RPC result only, never a tenant-wide query", async () => {
    const ownScopeVisibleLeads: FakeLead[] = [{ id: "own-1", email: "own@example.com", created_at: "2026-01-01T00:00:00Z" }];
    const { user, service, userRpcCalls } = fakeVisibilityClients(ownScopeVisibleLeads);
    let serviceFromCalled = false;
    const instrumentedService: typeof service = {
      from: (...args: unknown[]) => {
        serviceFromCalled = true;
        return service.from(...args);
      },
    };
    const db = fakeDb([]);

    const counselorPermissions: ResolvedPermissions = {
      baseTier: "member",
      allowedNavKeys: null,
      pipelineAccess: "all",
      listAccess: "all",
      leadScope: "own",
      sharedPoolListIds: new Set(),
      canAssignLeads: false,
      canEditLeads: true,
      canManageApplications: true,
      canManageClasses: true,
      canManageHR: false,
      canExport: false,
      canSendSms: false,
      dashboardWidgets: null,
    };
    const auth = baseAuth({ role: "counselor", permissions: counselorPermissions });

    const result = await resolveAudience(auth, EMPTY_TREE, { user, service: instrumentedService, db });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The own-scope RPC was called with THIS user's id — proving the caller's
    // own visibility, not some other user's or the whole tenant's.
    expect(userRpcCalls).toEqual([["leads_visible_to_user", { p_tenant: "tenant-1", p_user: "user-1", p_scope: "own" }, undefined]]);
    expect(serviceFromCalled).toBe(false);
    expect(result.audience.matched).toBe(1);
    expect(result.audience.sendable.map((r) => r.leadId)).toEqual(["own-1"]);
  });

  it("propagates planFilter validation errors instead of silently widening the audience", async () => {
    const { user, service } = fakeVisibilityClients([]);
    const db = fakeDb([]);
    const badTree = { conjunction: "and" as const, conditions: [{ id: "c1", field: "not_a_real_field", op: "is" as const, value: "x" }] };

    const result = await resolveAudience(baseAuth(), badTree, { user, service, db });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.not_a_real_field).toBeDefined();
  });
});

describe("resolveAudience (email) — pagination past PostgREST's 1000-row default (OUTREACH-PHASE1-BRIEF.md §4)", () => {
  it("collects every page instead of silently truncating at the first 1000 rows", async () => {
    // A minimal fake standing in for the unrestricted (owner) branch's
    // `service.from("leads").select(...).eq(...).is(...)` chain, extended
    // with .range() — the real bug this guards against: the first
    // (unranged) request alone would report exactly 1000 matched/sendable
    // out of a real ~1,300-lead tenant and never surface the other 300.
    const ALL_COUNT = 1300;
    const allLeads: FakeLead[] = Array.from({ length: ALL_COUNT }, (_, i) => ({
      id: `lead-${i}`,
      email: `lead${i}@example.com`,
      created_at: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
    }));

    // An unranged request mimics PostgREST's real default max-rows behavior
    // (confirmed empirically against local Supabase — see the comment in
    // src/lib/outbound/audience.ts): it silently truncates to the first
    // 1000 rows. Only an explicit .range(from, to) call returns a specific
    // slice. Chainable + thenable, like a real PostgrestFilterBuilder — .is()
    // must stay chainable (not resolve immediately) so a later .range() call
    // on the same builder still has something to attach to.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function pagingChain(slice: FakeLead[]): any {
      const node = {
        select: () => node,
        eq: () => node,
        is: () => node,
        range: (from: number, to: number) => pagingChain(allLeads.slice(from, to + 1)),
        then: (resolve: (v: { data: FakeLead[]; error: null }) => void) => resolve({ data: slice, error: null }),
      };
      return node;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service: any = { from: () => pagingChain(allLeads.slice(0, 1000)) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user: any = { rpc: () => ({ select: () => ({ eq: () => ({ is: () => Promise.resolve({ data: [], error: null }) }) }) }) };
    const db = fakeDb([]);

    const result = await resolveAudience(baseAuth(), EMPTY_TREE, { user, service, db });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.audience.matched).toBe(ALL_COUNT);
    expect(result.audience.sendable).toHaveLength(ALL_COUNT);
  });
});
