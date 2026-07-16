import { describe, it, expect } from "vitest";
import { searchLeadsTool } from "./search-leads";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
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
