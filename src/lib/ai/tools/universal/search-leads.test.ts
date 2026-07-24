import { describe, it, expect } from "vitest";
import { searchLeadsTool } from "./search-leads";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
import type { AgentAuthContext } from "@/lib/ai/agent-auth";
import type { ToolContext } from "../types";

type Row = Record<string, unknown>;

function makeLeadsChain(rows: Row[], orCalls: string[]) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    not: () => chain,
    in: () => chain,
    gte: () => chain,
    lte: () => chain,
    or: (expr: string) => {
      orCalls.push(expr);
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    then: (resolve: (v: { data: Row[]; error: null; count: number }) => unknown) =>
      Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve),
  };
  return chain;
}

function fakeDb(rows: Row[], orCalls: string[]): ScopedClient {
  return {
    from: () => makeLeadsChain(rows, orCalls),
    fromGlobal: () => {
      throw new Error("not used in this test");
    },
    raw: () => {
      throw new Error("not used in this test");
    },
  } as unknown as ScopedClient;
}

function fixtureAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "user-1",
    email: "test@example.com",
    tenantId: "tenant-1",
    role: "owner",
    industryId: "real_estate",
    positionId: null,
    positionSlug: null,
    branchId: null,
    branchMemberIds: [],
    permissions: { baseTier: "owner", leadScope: "all", pipelineAccess: "all" } as AuthContext["permissions"],
    plan: "free",
    entitlements: {} as AuthContext["entitlements"],
    ...overrides,
  };
}

function fixtureCtx(db: ScopedClient): ToolContext {
  return { db, auth: fixtureAuth(), logger: { child: () => ({}) } as unknown as ToolContext["logger"], runId: "run-1" };
}

const SARAH_ROW = { id: "lead-1", first_name: "Sarah", last_name: "Chen" };

describe("search_leads full-name query tokenization", () => {
  it("builds a single .or() group for a single-token query (unchanged behavior)", async () => {
    const orCalls: string[] = [];
    const db = fakeDb([SARAH_ROW], orCalls);
    await searchLeadsTool.execute(fixtureCtx(db), { query: "Sarah", limit: 20 });
    expect(orCalls).toEqual(["first_name.ilike.%Sarah%,last_name.ilike.%Sarah%,email.ilike.%Sarah%,phone.ilike.%Sarah%"]);
  });

  it("builds one .or() group per token for a full-name query", async () => {
    const orCalls: string[] = [];
    const db = fakeDb([SARAH_ROW], orCalls);
    await searchLeadsTool.execute(fixtureCtx(db), { query: "Sarah Chen", limit: 20 });
    expect(orCalls).toEqual([
      "first_name.ilike.%Sarah%,last_name.ilike.%Sarah%,email.ilike.%Sarah%,phone.ilike.%Sarah%",
      "first_name.ilike.%Chen%,last_name.ilike.%Chen%,email.ilike.%Chen%,phone.ilike.%Chen%",
    ]);
  });

  it("caps tokenization at the first 4 tokens", async () => {
    const orCalls: string[] = [];
    const db = fakeDb([], orCalls);
    await searchLeadsTool.execute(fixtureCtx(db), { query: "a b c d e", limit: 20 });
    expect(orCalls).toHaveLength(4);
  });

  it("skips query filtering entirely when query is omitted", async () => {
    const orCalls: string[] = [];
    const db = fakeDb([SARAH_ROW], orCalls);
    await searchLeadsTool.execute(fixtureCtx(db), { limit: 20 });
    expect(orCalls).toEqual([]);
  });
});

describe("search_leads display id matching", () => {
  it("matches a display-id-shaped token exactly against display_id, not the fuzzy name/email/phone columns", async () => {
    const orCalls: string[] = [];
    const row = { id: "lead-1", display_id: "ADM-009", first_name: "Riya", last_name: "Sharma" };
    const db = fakeDb([row], orCalls);
    const result = await searchLeadsTool.execute(fixtureCtx(db), { query: "ADM-009", limit: 20 });
    expect(orCalls).toEqual(["display_id.ilike.ADM-009"]);
    expect(result).toMatchObject({ leads: [{ id: "lead-1", displayId: "ADM-009" }] });
  });

  it("matches a lowercase display-id-shaped token case-insensitively", async () => {
    const orCalls: string[] = [];
    const db = fakeDb([], orCalls);
    await searchLeadsTool.execute(fixtureCtx(db), { query: "adm-009", limit: 20 });
    expect(orCalls).toEqual(["display_id.ilike.adm-009"]);
  });

  it("does not treat a plain name token as a display id", async () => {
    const orCalls: string[] = [];
    const db = fakeDb([], orCalls);
    await searchLeadsTool.execute(fixtureCtx(db), { query: "Manisha", limit: 20 });
    expect(orCalls).toEqual(["first_name.ilike.%Manisha%,last_name.ilike.%Manisha%,email.ilike.%Manisha%,phone.ilike.%Manisha%"]);
  });

  it("mixes an exact display-id match with fuzzy name matching across a multi-token query", async () => {
    const orCalls: string[] = [];
    const db = fakeDb([], orCalls);
    await searchLeadsTool.execute(fixtureCtx(db), { query: "ADM-009 Sharma", limit: 20 });
    expect(orCalls).toEqual([
      "display_id.ilike.ADM-009",
      "first_name.ilike.%Sharma%,last_name.ilike.%Sharma%,email.ilike.%Sharma%,phone.ilike.%Sharma%",
    ]);
  });
});

function fixtureAgentAuth(overrides: Partial<AgentAuthContext> = {}): AgentAuthContext {
  return {
    actorType: "agent",
    agentId: "agent-1",
    tenantId: "tenant-1",
    industryId: "it_agency",
    positionId: "pos-1",
    permissions: {
      baseTier: "member",
      allowedNavKeys: null,
      pipelineAccess: "all",
      listAccess: "all",
      leadScope: "all",
      sharedPoolListIds: new Set(),
      canAssignLeads: false,
      canEditLeads: false,
      canManageApplications: false,
      canManageClasses: false,
      canManageHR: false,
      canExport: false,
      dashboardWidgets: null,
    },
    role: "agent",
    ...overrides,
  };
}

function makeTrackedLeadsChain(rows: Row[], inCalls: Array<[string, unknown[]]>) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    not: () => chain,
    in: (col: string, vals: unknown[]) => {
      inCalls.push([col, vals]);
      return chain;
    },
    gte: () => chain,
    lte: () => chain,
    or: () => chain,
    order: () => chain,
    limit: () => chain,
    then: (resolve: (v: { data: Row[]; error: null; count: number }) => unknown) =>
      Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve),
  };
  return chain;
}

describe("search_leads — background agent (AgentAuthContext) scoping (doc 03 §6)", () => {
  it("Lead Triage's position (leadScope:'all', pipelineAccess:'all') reads tenant-wide — no pipeline filter applied", async () => {
    const inCalls: Array<[string, unknown[]]> = [];
    const db: ScopedClient = {
      from: () => makeTrackedLeadsChain([SARAH_ROW], inCalls),
      fromGlobal: () => {
        throw new Error("not used in this test");
      },
      raw: () => {
        throw new Error("not used in this test");
      },
    } as unknown as ScopedClient;

    const ctx: ToolContext = { db, auth: fixtureAgentAuth(), logger: { child: () => ({}) } as unknown as ToolContext["logger"], runId: "run-1" };
    const result = (await searchLeadsTool.execute(ctx, { limit: 20 })) as { leads: unknown[] };

    expect(result.leads).toHaveLength(1);
    expect(inCalls.some(([col]) => col === "pipeline_id")).toBe(false);
  });

  it("a pipeline-restricted agent position cannot read outside its allowed pipeline", async () => {
    const inCalls: Array<[string, unknown[]]> = [];
    const db: ScopedClient = {
      from: () => makeTrackedLeadsChain([], inCalls),
      fromGlobal: () => {
        throw new Error("not used in this test");
      },
      raw: () => {
        throw new Error("not used in this test");
      },
    } as unknown as ScopedClient;

    const restrictedAuth = fixtureAgentAuth({
      permissions: {
        ...fixtureAgentAuth().permissions,
        pipelineAccess: { ids: new Set(["pipe-a"]) },
      },
    });
    const ctx: ToolContext = { db, auth: restrictedAuth, logger: { child: () => ({}) } as unknown as ToolContext["logger"], runId: "run-1" };
    await searchLeadsTool.execute(ctx, { limit: 20 });

    expect(inCalls).toContainEqual(["pipeline_id", ["pipe-a"]]);
  });
});
