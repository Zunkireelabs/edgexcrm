import { describe, it, expect } from "vitest";
import { getOfferingTool } from "./get-offering";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
import type { ToolContext } from "@/lib/ai/tools/types";

type Row = Record<string, unknown>;

const OFFERING = {
  id: "off-a",
  name: "Industrial Value-Add Fund II",
  status: "raising",
  structure: "fund",
  exemption: "506c",
  asset_class: "industrial",
  target_raise: 25_000_000,
  min_investment: 50_000,
  pref_return: 8,
  currency: "USD",
  close_date: null,
  description: null,
};

function offeringChain() {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    maybeSingle: async () => ({ data: OFFERING, error: null }),
  };
  return chain;
}

function aggregateChain(allRows: Row[]) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
      Promise.resolve({ data: allRows, error: null }).then(resolve),
  };
  return chain;
}

function listChain(listRows: Row[], totalCount: number) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    then: (resolve: (v: { data: Row[]; error: null; count: number }) => unknown) =>
      Promise.resolve({ data: listRows, error: null, count: totalCount }).then(resolve),
  };
  return chain;
}

function fakeDb(allRows: Row[], listRows: Row[], totalCount: number): ScopedClient {
  let cmtCall = 0;
  return {
    from: (table: string) => {
      if (table === "offerings") return offeringChain();
      cmtCall += 1;
      return cmtCall === 1 ? aggregateChain(allRows) : listChain(listRows, totalCount);
    },
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
    permissions: { baseTier: "owner" } as AuthContext["permissions"],
    plan: "free",
    entitlements: {} as AuthContext["entitlements"],
    ...overrides,
  };
}

function fixtureCtx(db: ScopedClient): ToolContext {
  return { db, auth: fixtureAuth(), logger: { child: () => ({}) } as unknown as ToolContext["logger"], runId: "run-1" };
}

describe("get_offering aggregates beyond the 25-row commitments list", () => {
  it("computes funnel + raisedToDate from ALL commitments, not just the displayed 25", async () => {
    // 30 funded commitments of $10k each: funnel/raisedToDate must reflect all 30,
    // even though the displayed commitments list is capped at 25.
    const allRows: Row[] = Array.from({ length: 30 }, () => ({ status: "funded", amount: 10_000 }));
    const listRows: Row[] = Array.from({ length: 25 }, (_, i) => ({
      status: "funded",
      amount: 10_000,
      lead_id: `lead-${i}`,
      created_at: "2026-01-01",
      leads: { id: `lead-${i}`, first_name: "Investor", last_name: `${i}` },
    }));
    const db = fakeDb(allRows, listRows, 30);

    const result = (await getOfferingTool.execute(fixtureCtx(db), { offeringId: OFFERING.id })) as {
      raisedToDate: number;
      funnel: Array<{ status: string; count: number; amount: number }>;
      commitments: unknown[];
      commitmentsTruncated: boolean;
    };

    expect(result.raisedToDate).toBe(300_000);
    const funded = result.funnel.find((f) => f.status === "funded")!;
    expect(funded.count).toBe(30);
    expect(funded.amount).toBe(300_000);
    expect(result.funnel.reduce((sum, f) => sum + f.count, 0)).toBe(30);
    expect(result.commitments).toHaveLength(25);
    expect(result.commitmentsTruncated).toBe(true);
  });

  it("does not flag truncation when the offering has 25 or fewer commitments", async () => {
    const allRows: Row[] = Array.from({ length: 3 }, () => ({ status: "funded", amount: 10_000 }));
    const listRows: Row[] = allRows.map((r, i) => ({
      ...r,
      lead_id: `lead-${i}`,
      created_at: "2026-01-01",
      leads: { id: `lead-${i}`, first_name: "Investor", last_name: `${i}` },
    }));
    const db = fakeDb(allRows, listRows, 3);

    const result = (await getOfferingTool.execute(fixtureCtx(db), { offeringId: OFFERING.id })) as {
      commitments: unknown[];
      commitmentsTruncated: boolean;
    };
    expect(result.commitments).toHaveLength(3);
    expect(result.commitmentsTruncated).toBe(false);
  });
});
