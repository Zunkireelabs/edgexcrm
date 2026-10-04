import { describe, it, expect } from "vitest";
import { resolveAudienceForLeadIds } from "./audience";
import type { AuthContext } from "@/lib/api/auth";
import type { ResolvedPermissions } from "@/lib/api/permissions";
import type { ScopedClient } from "@/lib/supabase/scoped";

// resolveAudienceForLeadIds — the audience for a HAND-PICKED set of lead ids (bulk enroll's "selected rows").
// Pins the safety property that matters: ids are resolved through the caller's OWN visibility (an own-scope
// counselor can never pull in a lead they cannot see by sending its id), and the contactability rules are the
// same ones resolveAudience uses (it shares classifyLeads) — plus chunking so a 10,000-id selection never
// becomes one giant query.

interface FakeLead {
  id: string;
  email: string | null;
  created_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeClients(visible: FakeLead[]): { user: any; service: any; inCalls: string[][]; userRpcCalls: unknown[][]; serviceFromCalls: number } {
  const inCalls: string[][] = [];
  const userRpcCalls: unknown[][] = [];
  const state = { serviceFromCalls: 0 };
  const chain = () => {
    const node = {
      select: () => node,
      eq: () => node,
      is: () => node,
      in: (_col: string, ids: string[]) => {
        inCalls.push(ids);
        return Promise.resolve({ data: visible.filter((l) => ids.includes(l.id)), error: null });
      },
    };
    return node;
  };
  const clients = {
    user: {
      rpc: (name: string, params: unknown, opts: unknown) => {
        userRpcCalls.push([name, params, opts]);
        return chain();
      },
    },
    service: {
      from: () => {
        state.serviceFromCalls++;
        return chain();
      },
    },
    inCalls,
    userRpcCalls,
    get serviceFromCalls() {
      return state.serviceFromCalls;
    },
  };
  return clients;
}

function fakeDb(suppressedEmails: string[]): ScopedClient {
  return {
    from: () => ({
      select: () => ({
        in: (_col: string, values: string[]) =>
          Promise.resolve({ data: values.filter((v) => suppressedEmails.includes(v)).map((email) => ({ email })), error: null }),
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
    canManageProjects: true,
    canApproveTime: true,
    canManageBilling: true,
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


const lead = (id: string, email: string | null, created = "2026-01-01T00:00:00Z"): FakeLead => ({ id, email, created_at: created });

describe("resolveAudienceForLeadIds", () => {
  it("classifies the picked leads with the same rules as a filter audience, and reports ids it could not see", async () => {
    const clients = fakeClients([
      lead("1", "a@example.com"),
      lead("2", "A@example.com", "2026-01-02T00:00:00Z"), // same address, later -> duplicate
      lead("3", null),
      lead("4", "bad"),
      lead("5", "stopped@example.com"),
    ]);

    const result = await resolveAudienceForLeadIds(baseAuth(), ["1", "2", "3", "4", "5", "ghost"], { ...clients, db: fakeDb(["stopped@example.com"]) });

    expect(result.requested).toBe(6);
    expect(result.audience.matched).toBe(5); // "ghost" is not a lead this caller can see
    expect(result.audience.sendable.map((r) => r.leadId)).toEqual(["1"]);
    expect(result.audience.suppressed.map((r) => r.leadId)).toEqual(["5"]);
    expect(result.audience.excluded).toEqual({ noEmail: 1, malformed: 1, suppressed: 1, duplicate: 1 });
    expect(result.audience.excludedRows).toEqual(
      expect.arrayContaining([
        { leadId: "3", reason: "noEmail" },
        { leadId: "4", reason: "malformed" },
        { leadId: "2", reason: "duplicate" },
      ]),
    );
  });

  it("distinct ids only: the same id twice is requested once", async () => {
    const clients = fakeClients([lead("1", "a@example.com")]);
    const result = await resolveAudienceForLeadIds(baseAuth(), ["1", "1", "1"], { ...clients, db: fakeDb([]) });
    expect(result.requested).toBe(1);
    expect(result.audience.sendable).toHaveLength(1);
  });

  it("an own-scoped counselor resolves ids through the own-scope RPC only — never a tenant-wide query", async () => {
    // the RPC (the caller's visibility) returns ONE lead; the counselor also sent an id they cannot see
    const clients = fakeClients([lead("mine", "mine@example.com")]);
    const counselor = baseAuth({
      role: "viewer",
      permissions: { ...baseAuth().permissions, baseTier: "member", leadScope: "own", canAssignLeads: false } as ResolvedPermissions,
    });

    const result = await resolveAudienceForLeadIds(counselor, ["mine", "someone-elses"], { ...clients, db: fakeDb([]) });

    expect(clients.userRpcCalls).toHaveLength(1);
    expect(clients.userRpcCalls[0][0]).toBe("leads_visible_to_user");
    expect(clients.userRpcCalls[0][1]).toMatchObject({ p_scope: "own", p_user: "user-1", p_tenant: "tenant-1" });
    expect(clients.serviceFromCalls).toBe(0);
    expect(result.audience.sendable.map((r) => r.leadId)).toEqual(["mine"]);
    expect(result.requested - result.audience.matched).toBe(1);
  });

  it("chunks a large selection: 250 ids become 3 queries of at most 100", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const clients = fakeClients(ids.map((id) => lead(id, `${id}@example.com`)));

    const result = await resolveAudienceForLeadIds(baseAuth(), ids, { ...clients, db: fakeDb([]) });

    expect(clients.inCalls.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(result.audience.sendable).toHaveLength(250);
  });
});
