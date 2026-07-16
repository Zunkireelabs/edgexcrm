import { describe, it, expect } from "vitest";
import { capitalRaiseSummaryTool } from "./capital-raise-summary";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
import type { ToolContext } from "@/lib/ai/tools/types";

type Row = Record<string, unknown>;

function makeChain(rows: Row[]) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  return chain;
}

function fakeDb(tables: Record<string, Row[]>): ScopedClient {
  return {
    from: (table: string) => makeChain(tables[table] ?? []),
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

// Mirrors the known seed shape: 2 offerings, 7 investor commitment rows,
// funded totals of $1.2M (Industrial Value-Add Fund II) and $850k (Southeast
// Flex Portfolio I).
const OFFERINGS = [
  { id: "off-a", name: "Industrial Value-Add Fund II", status: "raising", target_raise: 25_000_000, currency: "USD" },
  { id: "off-b", name: "Southeast Flex Portfolio I", status: "raising", target_raise: 10_000_000, currency: "USD" },
];

const COMMITMENTS = [
  { offering_id: "off-a", lead_id: "lead-1", status: "funded", amount: 700_000 },
  { offering_id: "off-a", lead_id: "lead-2", status: "funded", amount: 500_000 },
  { offering_id: "off-a", lead_id: "lead-3", status: "subscribed", amount: 300_000 },
  { offering_id: "off-a", lead_id: "lead-4", status: "prospect", amount: null },
  { offering_id: "off-b", lead_id: "lead-5", status: "funded", amount: 850_000 },
  { offering_id: "off-b", lead_id: "lead-6", status: "soft_commit", amount: 100_000 },
  { offering_id: "off-b", lead_id: "lead-7", status: "declined", amount: 250_000 },
];

describe("capital_raise_summary aggregation", () => {
  it("computes per-offering funded/committed/equityRaised/investor-count and tenant totals", async () => {
    const db = fakeDb({ offerings: OFFERINGS, investor_commitments: COMMITMENTS });
    const result = (await capitalRaiseSummaryTool.execute(fixtureCtx(db))) as {
      offerings: Array<{ id: string; funded: number; committedNotYetFunded: number; equityRaised: number; investorCount: number }>;
      totals: { funded: number; committedNotYetFunded: number; equityRaised: number; investorCount: number };
    };

    const a = result.offerings.find((o) => o.id === "off-a")!;
    const b = result.offerings.find((o) => o.id === "off-b")!;
    expect(a.funded).toBe(1_200_000);
    expect(a.committedNotYetFunded).toBe(300_000);
    expect(a.equityRaised).toBe(1_500_000);
    expect(a.investorCount).toBe(4);
    expect(b.funded).toBe(850_000);
    expect(b.committedNotYetFunded).toBe(0);
    expect(b.equityRaised).toBe(850_000);
    expect(b.investorCount).toBe(2);

    expect(result.totals.funded).toBe(2_050_000);
    expect(result.totals.committedNotYetFunded).toBe(300_000);
    expect(result.totals.equityRaised).toBe(2_350_000);
    expect(result.totals.investorCount).toBe(6); // lead-7 excluded (declined)
  });

  it("ranks offerings by equityRaised (funded+committed) descending", async () => {
    const db = fakeDb({ offerings: OFFERINGS, investor_commitments: COMMITMENTS });
    const result = (await capitalRaiseSummaryTool.execute(fixtureCtx(db))) as {
      offerings: Array<{ id: string }>;
    };
    expect(result.offerings.map((o) => o.id)).toEqual(["off-a", "off-b"]);
  });

  it("returns an empty summary when the tenant has no offerings", async () => {
    const db = fakeDb({ offerings: [], investor_commitments: [] });
    const result = await capitalRaiseSummaryTool.execute(fixtureCtx(db));
    expect(result).toEqual({
      offerings: [],
      totals: { funded: 0, committedNotYetFunded: 0, equityRaised: 0, targetRaise: 0, investorCount: 0 },
    });
  });
});
