import { describe, it, expect } from "vitest";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
import type { AgentAuthContext } from "@/lib/ai/agent-auth";
import type { ResolvedPermissions } from "@/lib/api/permissions";
import {
  canViewLead,
  resolveLeadVisibilityPlan,
  applyLeadVisibilityPlan,
  actorUserId,
  actorBranchId,
  isRestrictedToSelf,
} from "./lead-visibility";
import { NIL_UUID } from "./sanitize";

// Generic fake db: every table/select/eq/order/limit/is/in/or/maybeSingle
// chains through and resolves to an empty result unless a table override is
// given. Enough for the "own scope, no userId -> fail closed before any real
// row matters" paths this suite exercises; unassignedCrossBranchLeadIds and
// friends never get reached because industryId is non-education or the
// short-circuit fires first.
//
// Filter-capture (5.Gb): eq/is/in calls are ALSO recorded into a per-table
// `calls` array as [method, args] so tests can assert the exact scoping
// filters a function applies. Deliberately NOT capturing tenant_id here —
// ScopedClient (which this fakes) auto-injects the tenant filter itself, so
// tenant scoping is the wrapper's job, not something these callers apply
// explicitly. That's the asymmetry vs. branch-membership.test.ts /
// collaborators.test.ts, which fake a raw SupabaseClient + explicit tenantId
// and DO assert eq("tenant_id", ...) on every query.
type Call = [method: string, args: unknown[]];

function makeChain(result: { data?: unknown } = { data: [] }, calls: Call[] = []) {
  const record = (method: string) => (...args: unknown[]) => {
    calls.push([method, args]);
    return chain;
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: record("eq"),
    order: () => chain,
    limit: () => chain,
    is: record("is"),
    in: record("in"),
    or: () => chain,
    not: () => chain,
    gte: () => chain,
    lte: () => chain,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: { data?: unknown }) => unknown) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

function fakeDb(
  overrides: Record<string, { data?: unknown }> = {},
  calls: Record<string, Call[]> = {},
): ScopedClient {
  return {
    from: (table: string) => {
      calls[table] ??= [];
      return makeChain(overrides[table], calls[table]);
    },
    fromGlobal: () => {
      throw new Error("fakeDb: fromGlobal not used in this suite");
    },
    raw: () => {
      throw new Error("fakeDb: raw not used in this suite");
    },
  } as unknown as ScopedClient;
}

function permissions(overrides: Partial<ResolvedPermissions> = {}): ResolvedPermissions {
  return {
    baseTier: "member",
    allowedNavKeys: null,
    pipelineAccess: "all",
    listAccess: "all",
    leadScope: "own",
    sharedPoolListIds: new Set(),
    canAssignLeads: false,
    canEditLeads: false,
    canManageApplications: false,
    canManageClasses: false,
    canManageHR: false,
    canExport: false,
    dashboardWidgets: null,
    ...overrides,
  };
}

function agentAuth(overrides: Partial<AgentAuthContext> = {}): AgentAuthContext {
  return {
    actorType: "agent",
    agentId: "agent-1",
    tenantId: "tenant-1",
    industryId: "it_agency",
    positionId: "pos-1",
    permissions: permissions(),
    role: "agent",
    ...overrides,
  };
}

// Mirrors fixtureAuth in src/lib/ai/tools/adapter.test.ts — the human-path
// AuthContext fixture. Unlike AgentAuthContext, userId/branchId/branchMemberIds
// are always real values (never absent), which is exactly the property the
// "human/agent lockstep" tests below lean on.
function humanAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "user-1",
    email: "human@example.com",
    tenantId: "tenant-1",
    role: "counselor",
    industryId: "it_agency",
    positionId: null,
    positionSlug: null,
    branchId: null,
    branchMemberIds: [],
    permissions: permissions(),
    plan: "free",
    entitlements: {} as AuthContext["entitlements"],
    ...overrides,
  };
}

const LEAD_A = { id: "lead-1", assigned_to: null, branch_id: null, pipeline_id: "pipe-a", list_id: null };
const LEAD_B = { id: "lead-2", assigned_to: null, branch_id: null, pipeline_id: "pipe-b", list_id: null };

describe("canViewLead — background agent (AgentAuthContext)", () => {
  it("an agent with leadScope:'own' (no session, no userId) sees NOTHING — fail-safe, not a crash", async () => {
    const db = fakeDb();
    const auth = agentAuth({ permissions: permissions({ leadScope: "own" }) });
    await expect(canViewLead(db, auth, LEAD_A)).resolves.toBe(false);
  });

  it("an agent with leadScope:'team' and no branch concept also sees NOTHING — same fail-safe path", async () => {
    const db = fakeDb();
    const auth = agentAuth({ permissions: permissions({ leadScope: "team" }) });
    await expect(canViewLead(db, auth, LEAD_A)).resolves.toBe(false);
  });

  it("Lead Triage's position (leadScope:'all', pipelineAccess:'all') reads tenant-wide", async () => {
    const db = fakeDb();
    const auth = agentAuth({ permissions: permissions({ leadScope: "all", pipelineAccess: "all" }) });
    await expect(canViewLead(db, auth, LEAD_A)).resolves.toBe(true);
    await expect(canViewLead(db, auth, LEAD_B)).resolves.toBe(true);
  });

  it("a pipeline-restricted agent position (leadScope:'all') cannot read outside its allowed pipeline", async () => {
    const db = fakeDb();
    const auth = agentAuth({
      permissions: permissions({ leadScope: "all", pipelineAccess: { ids: new Set(["pipe-a"]) } }),
    });
    await expect(canViewLead(db, auth, LEAD_A)).resolves.toBe(true);
    await expect(canViewLead(db, auth, LEAD_B)).resolves.toBe(false);
  });
});

describe("resolveLeadVisibilityPlan / applyLeadVisibilityPlan — background agent", () => {
  it("leadScope:'own' with no userId resolves to the 'none' plan (sees nothing)", async () => {
    const db = fakeDb();
    const auth = agentAuth({ permissions: permissions({ leadScope: "own" }) });
    const plan = await resolveLeadVisibilityPlan(db, auth, null);
    expect(plan).toEqual({ kind: "none" });
  });

  it("applyLeadVisibilityPlan's 'none' plan filters the query to an impossible id", () => {
    const calls: Array<[string, unknown]> = [];
    const query = {
      eq: (col: string, val: unknown) => {
        calls.push([col, val]);
        return query;
      },
    };
    applyLeadVisibilityPlan(query, { kind: "none" }, agentAuth());
    expect(calls).toContainEqual(["id", NIL_UUID]);
  });

  it("leadScope:'all' resolves to 'all-scope' and applies only the pipeline filter", async () => {
    const db = fakeDb();
    const auth = agentAuth({ permissions: permissions({ leadScope: "all", pipelineAccess: { ids: new Set(["pipe-a"]) } }) });
    const plan = await resolveLeadVisibilityPlan(db, auth, null);
    expect(plan).toEqual({ kind: "all-scope" });

    const calls: Array<[string, unknown[]]> = [];
    const query = {
      in: (col: string, vals: unknown[]) => {
        calls.push([col, vals]);
        return query;
      },
    };
    applyLeadVisibilityPlan(query, plan, auth);
    expect(calls).toEqual([["pipeline_id", ["pipe-a"]]]);
  });
});

// ---------------------------------------------------------------------------
// 5.Gb — human-path (AuthContext) coverage.
//
// lead-visibility.ts's file-header note documents that it runs for BOTH a
// background agent's AgentAuthContext AND a human's AuthContext — the AI
// assistant runs as the logged-in user (D2 mode), so get_lead/search_leads
// flow a real counselor/branch-manager/admin AuthContext through the exact
// same resolveLeadVisibilityPlan/applyLeadVisibilityPlan/canViewLead this
// file already exercises via the agent path above. Only the agent path had
// coverage before this slice; a human asking the assistant "show me my
// leads" was untested.
// ---------------------------------------------------------------------------

describe("actor accessors & isRestrictedToSelf — human vs agent", () => {
  // actorBranchMemberIds/actorPositionSlug are module-private (not exported)
  // — their effect on a human actor is verified indirectly below, through
  // the team-branch and shared-pool plans that consume them.
  it("actorUserId reads the real userId for a human and is undefined for an agent (no session)", () => {
    expect(actorUserId(humanAuth({ userId: "user-42" }))).toBe("user-42");
    expect(actorUserId(agentAuth())).toBeUndefined();
  });

  it("actorBranchId reads the real branchId for a human (including null) and is always null for an agent", () => {
    expect(actorBranchId(humanAuth({ branchId: "branch-1" }))).toBe("branch-1");
    expect(actorBranchId(humanAuth({ branchId: null }))).toBeNull();
    expect(actorBranchId(agentAuth())).toBeNull();
  });

  it("isRestrictedToSelf: own scope is always restricted; team scope is restricted only without a branch", () => {
    expect(isRestrictedToSelf(permissions({ leadScope: "own" }), "branch-1")).toBe(true);
    expect(isRestrictedToSelf(permissions({ leadScope: "own" }), null)).toBe(true);
    expect(isRestrictedToSelf(permissions({ leadScope: "team" }), "branch-1")).toBe(false);
    expect(isRestrictedToSelf(permissions({ leadScope: "team" }), null)).toBe(true);
    expect(isRestrictedToSelf(permissions({ leadScope: "all" }), null)).toBe(false);
  });
});

describe("resolveLeadVisibilityPlan / applyLeadVisibilityPlan — human (AuthContext)", () => {
  it("owner/admin (leadScope:'all') resolves to the tenant-wide plan — no self/branch restriction", async () => {
    const db = fakeDb();
    const auth = humanAuth({ role: "owner", permissions: permissions({ leadScope: "all" }) });
    const plan = await resolveLeadVisibilityPlan(db, auth, null);
    expect(plan).toEqual({ kind: "all-scope" });
  });

  it("counselor (leadScope:'own') resolves to an own-scope plan, filtering lead_branches by assigned_to and lead_collaborators by user_id", async () => {
    const calls: Record<string, Call[]> = {};
    const db = fakeDb(
      { lead_branches: { data: [{ lead_id: "l1" }] }, lead_collaborators: { data: [{ lead_id: "l2" }] } },
      calls,
    );
    const auth = humanAuth({ userId: "user-1", permissions: permissions({ leadScope: "own" }) });
    const plan = await resolveLeadVisibilityPlan(db, auth, null);
    expect(plan).toEqual({ kind: "own-scope", userId: "user-1", extraIds: ["l1", "l2"] });
    expect(calls.lead_branches).toEqual([["eq", ["assigned_to", "user-1"]]]);
    expect(calls.lead_collaborators).toEqual([["eq", ["user_id", "user-1"]]]);
  });

  it("own-scope + a shared-pool list resolves to the shared-pool plan, filtering tenant_users by branch_id", async () => {
    const calls: Record<string, Call[]> = {};
    const db = fakeDb({ tenant_users: { data: [{ user_id: "u1" }, { user_id: "u2" }] } }, calls);
    const auth = humanAuth({
      userId: "user-1",
      branchId: "branch-1",
      permissions: permissions({ leadScope: "own", sharedPoolListIds: new Set(["list-1"]) }),
    });
    const plan = await resolveLeadVisibilityPlan(db, auth, "list-1");
    expect(plan).toEqual({ kind: "shared-pool", memberIds: ["u1", "u2"] });
    expect(calls.tenant_users).toEqual([["eq", ["branch_id", "branch-1"]]]);
  });

  it("branch-manager (leadScope:'team' + branchId) resolves to the team-branch plan, filtering lead_branches by branch_id", async () => {
    const calls: Record<string, Call[]> = {};
    const db = fakeDb({ lead_branches: { data: [{ lead_id: "l3" }] } }, calls);
    const auth = humanAuth({
      userId: "user-1",
      branchId: "branch-1",
      branchMemberIds: ["u1", "u2"],
      permissions: permissions({ leadScope: "team" }),
    });
    const plan = await resolveLeadVisibilityPlan(db, auth, null);
    expect(plan).toEqual({ kind: "team-branch", branchMemberIds: ["u1", "u2"], sharedLeadIds: ["l3"] });
    expect(calls.lead_branches).toEqual([["eq", ["branch_id", "branch-1"]]]);
  });

  it("team scope with NO branch falls back to own-only (the human mirror of requireLeadAccess's §4.1 NULL-branch fallback) — NOT the agent's 'none' fail-safe, because a human always has a real userId to scope by", async () => {
    const db = fakeDb({ lead_branches: { data: [] }, lead_collaborators: { data: [] } });
    const auth = humanAuth({ userId: "user-1", branchId: null, permissions: permissions({ leadScope: "team" }) });
    const plan = await resolveLeadVisibilityPlan(db, auth, null);
    expect(plan).toEqual({ kind: "own-scope", userId: "user-1", extraIds: [] });
  });

  it("applyLeadVisibilityPlan's own-scope plan (with extraIds) ORs the assignee against the extra id set", () => {
    const calls: string[] = [];
    const query = {
      or: (expr: string) => {
        calls.push(expr);
        return query;
      },
    };
    applyLeadVisibilityPlan(query, { kind: "own-scope", userId: "user-1", extraIds: ["l1", "l2"] }, humanAuth());
    expect(calls).toEqual(["assigned_to.eq.user-1,id.in.(l1,l2)"]);
  });

  it("applyLeadVisibilityPlan's own-scope plan (no extraIds) filters straight to the assignee", () => {
    const calls: Array<[string, unknown]> = [];
    const query = {
      eq: (col: string, val: unknown) => {
        calls.push([col, val]);
        return query;
      },
    };
    applyLeadVisibilityPlan(query, { kind: "own-scope", userId: "user-1", extraIds: [] }, humanAuth());
    expect(calls).toEqual([["assigned_to", "user-1"]]);
  });

  it("applyLeadVisibilityPlan's team-branch plan ORs branch-member assignees against the shared-lead id set when both are non-empty", () => {
    const calls: string[] = [];
    const query = {
      or: (expr: string) => {
        calls.push(expr);
        return query;
      },
    };
    applyLeadVisibilityPlan(
      query,
      { kind: "team-branch", branchMemberIds: ["u1", "u2"], sharedLeadIds: ["l1"] },
      humanAuth(),
    );
    expect(calls).toEqual(["assigned_to.in.(u1,u2),id.in.(l1)"]);
  });

  it("applyLeadVisibilityPlan's team-branch plan falls back to id.in(...) when there are no branch members", () => {
    const calls: Array<[string, unknown[]]> = [];
    const query = {
      in: (col: string, vals: unknown[]) => {
        calls.push([col, vals]);
        return query;
      },
    };
    applyLeadVisibilityPlan(query, { kind: "team-branch", branchMemberIds: [], sharedLeadIds: ["l1"] }, humanAuth());
    expect(calls).toEqual([["id", ["l1"]]]);
  });

  it("applyLeadVisibilityPlan's team-branch plan falls back to assigned_to.in(...) when there are no shared leads", () => {
    const calls: Array<[string, unknown[]]> = [];
    const query = {
      in: (col: string, vals: unknown[]) => {
        calls.push([col, vals]);
        return query;
      },
    };
    applyLeadVisibilityPlan(query, { kind: "team-branch", branchMemberIds: ["u1"], sharedLeadIds: [] }, humanAuth());
    expect(calls).toEqual([["assigned_to", ["u1"]]]);
  });
});

describe("canViewLead — human (AuthContext)", () => {
  it("true when the lead is directly assigned to the user", async () => {
    const db = fakeDb();
    const auth = humanAuth({ userId: "user-1", permissions: permissions({ leadScope: "own" }) });
    await expect(canViewLead(db, auth, { ...LEAD_A, assigned_to: "user-1" })).resolves.toBe(true);
  });

  it("true when the user is a lead_collaborator, even without a direct assignment — filters lead_collaborators by lead_id AND user_id", async () => {
    const calls: Record<string, Call[]> = {};
    const db = fakeDb({ lead_collaborators: { data: { lead_id: "lead-1" } } }, calls);
    const auth = humanAuth({ userId: "user-1", permissions: permissions({ leadScope: "own" }) });
    await expect(canViewLead(db, auth, LEAD_A)).resolves.toBe(true);
    expect(calls.lead_collaborators).toEqual([
      ["eq", ["lead_id", "lead-1"]],
      ["eq", ["user_id", "user-1"]],
    ]);
  });

  it("true for a branch-manager when the lead's branch_id matches, via direct branch_id match", async () => {
    const db = fakeDb();
    const auth = humanAuth({
      userId: "user-1",
      branchId: "branch-1",
      branchMemberIds: [],
      permissions: permissions({ leadScope: "team" }),
    });
    await expect(canViewLead(db, auth, { ...LEAD_A, branch_id: "branch-1" })).resolves.toBe(true);
  });

  it("false when the user is neither assignee, collaborator, nor branch-visible", async () => {
    const db = fakeDb({ lead_collaborators: { data: null } });
    const auth = humanAuth({ userId: "user-1", permissions: permissions({ leadScope: "own" }) });
    await expect(canViewLead(db, auth, LEAD_A)).resolves.toBe(false);
  });

  it("false for an admin (leadScope:'all') reading outside their allowed pipeline", async () => {
    const db = fakeDb();
    const auth = humanAuth({
      role: "admin",
      permissions: permissions({ leadScope: "all", pipelineAccess: { ids: new Set(["pipe-a"]) } }),
    });
    await expect(canViewLead(db, auth, LEAD_B)).resolves.toBe(false);
  });
});

describe("human/agent lockstep — resolveLeadVisibilityPlan must not diverge by actor type", () => {
  it("given equivalent permissions (leadScope:'all' + a pipeline restriction), a human AuthContext and an AgentAuthContext resolve to the identical plan", async () => {
    const sharedPermissions = permissions({ leadScope: "all", pipelineAccess: { ids: new Set(["pipe-a"]) } });
    const humanPlan = await resolveLeadVisibilityPlan(fakeDb(), humanAuth({ permissions: sharedPermissions }), null);
    const agentPlan = await resolveLeadVisibilityPlan(fakeDb(), agentAuth({ permissions: sharedPermissions }), null);
    expect(humanPlan).toEqual(agentPlan);
    expect(humanPlan).toEqual({ kind: "all-scope" });
  });
});
