import { describe, it, expect } from "vitest";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AgentAuthContext } from "@/lib/ai/agent-auth";
import type { ResolvedPermissions } from "@/lib/api/permissions";
import { canViewLead, resolveLeadVisibilityPlan, applyLeadVisibilityPlan } from "./lead-visibility";
import { NIL_UUID } from "./sanitize";

// Generic fake db: every table/select/eq/order/limit/is/in/or/maybeSingle
// chains through and resolves to an empty result unless a table override is
// given. Enough for the "own scope, no userId -> fail closed before any real
// row matters" paths this suite exercises; unassignedCrossBranchLeadIds and
// friends never get reached because industryId is non-education or the
// short-circuit fires first.
function makeChain(result: { data?: unknown } = { data: [] }) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    is: () => chain,
    in: () => chain,
    or: () => chain,
    not: () => chain,
    gte: () => chain,
    lte: () => chain,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: { data?: unknown }) => unknown) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

function fakeDb(overrides: Record<string, { data?: unknown }> = {}): ScopedClient {
  return {
    from: (table: string) => makeChain(overrides[table]),
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
