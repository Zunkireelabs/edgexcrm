import { describe, it, expect } from "vitest";
import { resolveAudience } from "./audience";
import type { AuthContext } from "@/lib/api/auth";
import type { ResolvedPermissions } from "@/lib/api/permissions";
import { EMPTY_TREE } from "@/lib/filters/types";
import type { ScopedClient } from "@/lib/supabase/scoped";

// Unit-level (no DB) — pins resolveAudience's CONTRACT with visibleLeadsBase
// and the suppression batch lookup via fake clients, same style as
// visibility-query.test.ts. visibleLeadsBase's own client-routing correctness
// is covered there; the point of this file's "own-scope" test is proving
// resolveAudience feeds it the caller's real scope, never a hand-rolled
// tenant-wide query — see docs/SMS-PHASE3A-BRIEF.md §3/§9.

interface FakeLead {
  id: string;
  phone: string | null;
  created_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeVisibilityClients(leads: FakeLead[]): { user: any; service: any; userRpcCalls: unknown[][] } {
  const userRpcCalls: unknown[][] = [];
  // Chainable stub matching both codepaths resolveAudience can take:
  //   RPC (own/branch scope):   .rpc(...).select(...).is(...)
  //   unrestricted (owner/admin): .from(...).select(...).eq(...).is(...)
  // Every method but `is` returns the same chainable node; `is` is always the
  // last call before awaiting (compileFilter is a no-op on an empty tree).
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

function fakeDb(suppressedPhones: string[]): ScopedClient {
  return {
    from: () => ({
      select: () => ({
        in: (_col: string, values: string[]) =>
          Promise.resolve({
            data: values.filter((v) => suppressedPhones.includes(v)).map((phone_e164) => ({ phone_e164 })),
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

describe("resolveAudience — phone classification + duplicate collapse + suppression", () => {
  it("buckets missing/foreign/malformed phones, collapses duplicates, and drops suppressed numbers", async () => {
    const leads: FakeLead[] = [
      { id: "1", phone: "+977-9803023768", created_at: "2026-01-01T00:00:00Z" }, // sendable
      { id: "2", phone: "+977-9803023768", created_at: "2026-01-02T00:00:00Z" }, // duplicate of #1 (later created_at)
      { id: "3", phone: null, created_at: "2026-01-01T00:00:00Z" }, // noPhone
      { id: "4", phone: "+91-9876543210", created_at: "2026-01-01T00:00:00Z" }, // foreignNumber
      { id: "5", phone: "+977-12345", created_at: "2026-01-01T00:00:00Z" }, // malformed
      { id: "6", phone: "+977-9811111111", created_at: "2026-01-01T00:00:00Z" }, // suppressed
    ];
    const { user, service } = fakeVisibilityClients(leads);
    const db = fakeDb(["+9779811111111"]);

    const result = await resolveAudience(baseAuth(), EMPTY_TREE, { user, service, db });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.audience.matched).toBe(6);
    expect(result.audience.excluded).toEqual({
      noPhone: 1,
      foreignNumber: 1,
      malformed: 1,
      suppressed: 1,
      duplicatePhone: 1,
    });
    expect(result.audience.sendable).toHaveLength(1);
    expect(result.audience.sendable[0]).toMatchObject({ leadId: "1", phone: "9803023768", phoneE164: "+9779803023768" });
  });

  it("keeps the FIRST duplicate by (created_at, id), not array order", async () => {
    const leads: FakeLead[] = [
      { id: "later", phone: "+977-9803023768", created_at: "2026-01-05T00:00:00Z" },
      { id: "earlier", phone: "+977-9803023768", created_at: "2026-01-01T00:00:00Z" },
    ];
    const { user, service } = fakeVisibilityClients(leads);
    const db = fakeDb([]);

    const result = await resolveAudience(baseAuth(), EMPTY_TREE, { user, service, db });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.audience.sendable).toHaveLength(1);
    expect(result.audience.sendable[0].leadId).toBe("earlier");
    expect(result.audience.excluded.duplicatePhone).toBe(1);
  });
});

describe("resolveAudience — permission scoping (the whole reason this goes through visibleLeadsBase)", () => {
  it("an own-scoped (counselor) caller's audience is built from the own-scope RPC result only, never a tenant-wide query", async () => {
    // The RPC (leads_visible_to_user, scope 'own') is the ONLY source of truth for
    // which leads a counselor sees — its own correctness is covered by
    // visibility-query.test.ts and the SQL migration. This test proves
    // resolveAudience actually routes through it for an own-scope caller instead
    // of falling back to service.from("leads") (which would leak the whole tenant).
    const ownScopeVisibleLeads: FakeLead[] = [{ id: "own-1", phone: "+977-9803023768", created_at: "2026-01-01T00:00:00Z" }];
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
    // The own-scope RPC was called with THIS user's id — proving the caller's own
    // visibility, not some other user's or the whole tenant's.
    expect(userRpcCalls).toEqual([
      ["leads_visible_to_user", { p_tenant: "tenant-1", p_user: "user-1", p_scope: "own" }, undefined],
    ]);
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
