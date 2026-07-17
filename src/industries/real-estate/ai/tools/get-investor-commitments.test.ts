import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
import type { ToolContext } from "@/lib/ai/tools/types";

const canViewLeadMock = vi.fn();
vi.mock("@/lib/ai/tools/universal/lib/lead-visibility", () => ({ canViewLead: canViewLeadMock }));

type Row = Record<string, unknown>;

function makeChain(row: Row | null, rows: Row[] = []) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    maybeSingle: async () => ({ data: row, error: null }),
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  return chain;
}

function fakeDb(leadRow: Row | null, commitmentRows: Row[]): ScopedClient {
  return {
    from: (table: string) => (table === "leads" ? makeChain(leadRow) : makeChain(null, commitmentRows)),
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
    role: "counselor",
    industryId: "real_estate",
    positionId: null,
    positionSlug: null,
    branchId: null,
    branchMemberIds: [],
    permissions: { baseTier: "counselor" } as unknown as AuthContext["permissions"],
    plan: "free",
    entitlements: {} as AuthContext["entitlements"],
    ...overrides,
  };
}

function fixtureCtx(db: ScopedClient, auth: AuthContext = fixtureAuth()): ToolContext {
  return { db, auth, logger: { child: () => ({}) } as unknown as ToolContext["logger"], runId: "run-1" };
}

const LEAD_ROW = {
  id: "lead-1",
  assigned_to: "other-user",
  branch_id: "branch-1",
  pipeline_id: "pipeline-1",
  list_id: "list-1",
  first_name: "Sarah",
  last_name: "Chen",
};

describe("get_investor_commitments lead-visibility gate", () => {
  beforeEach(() => {
    canViewLeadMock.mockReset();
  });

  it("refuses a lead the caller can't view", async () => {
    canViewLeadMock.mockResolvedValue(false);
    const { getInvestorCommitmentsTool } = await import("./get-investor-commitments");
    const db = fakeDb(LEAD_ROW, [{ offering_id: "off-a", status: "funded", amount: 100, committed_at: null, funded_at: null, offerings: { id: "off-a", name: "Fund I" } }]);
    const result = await getInvestorCommitmentsTool.execute(fixtureCtx(db), { leadId: "lead-1" });
    expect(result).toEqual({ error: "Investor not found." });
  });

  it("returns commitments when the caller can view the lead", async () => {
    canViewLeadMock.mockResolvedValue(true);
    const { getInvestorCommitmentsTool } = await import("./get-investor-commitments");
    const db = fakeDb(LEAD_ROW, [
      { offering_id: "off-a", status: "funded", amount: 100, committed_at: "2026-01-01", funded_at: "2026-02-01", offerings: { id: "off-a", name: "Fund I" } },
    ]);
    const result = (await getInvestorCommitmentsTool.execute(fixtureCtx(db), { leadId: "lead-1" })) as {
      investorName: string;
      lifecycle: string;
      commitments: Array<{ offeringName: string }>;
    };
    expect(result.investorName).toBe("Sarah Chen");
    expect(result.lifecycle).toBe("Investor");
    expect(result.commitments).toHaveLength(1);
    expect(result.commitments[0].offeringName).toBe("Fund I");
  });

  it("returns an error when the lead doesn't exist in this tenant", async () => {
    const { getInvestorCommitmentsTool } = await import("./get-investor-commitments");
    const db = fakeDb(null, []);
    const result = await getInvestorCommitmentsTool.execute(fixtureCtx(db), { leadId: "lead-missing" });
    expect(result).toEqual({ error: "Investor not found." });
    expect(canViewLeadMock).not.toHaveBeenCalled();
  });
});
