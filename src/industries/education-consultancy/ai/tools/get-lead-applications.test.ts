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
    in: () => chain,
    order: () => chain,
    maybeSingle: async () => ({ data: row, error: null }),
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  return chain;
}

function fakeDb(leadRow: Row | null, applicationRows: Row[], noteRows: Row[] = []): ScopedClient {
  return {
    from: (table: string) => {
      if (table === "leads") return makeChain(leadRow);
      if (table === "application_notes") return makeChain(null, noteRows);
      return makeChain(null, applicationRows);
    },
    fromGlobal: () => {
      throw new Error("not used in this test");
    },
    raw: () => {
      throw new Error("not used in this test");
    },
  } as unknown as ScopedClient;
}

const COUNSELOR_PERMISSIONS = { baseTier: "member", leadScope: "own", pipelineAccess: "all" } as AuthContext["permissions"];

function fixtureAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "user-1",
    email: "test@example.com",
    tenantId: "tenant-1",
    role: "counselor",
    industryId: "education_consultancy",
    positionId: null,
    positionSlug: null,
    branchId: null,
    branchMemberIds: [],
    permissions: COUNSELOR_PERMISSIONS,
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
  first_name: "Aisha",
  last_name: "Khan",
};

const APPLICATION_ROW = {
  id: "app-1",
  university_name: "Oxford",
  program_name: "MSc CS",
  countries: ["UK"],
  intake_term: "Fall 2026",
  status: "applied",
  offer_type: null,
  application_deadline: null,
  tuition_fee: 25_000,
  application_fee_paid: true,
  deposit_paid: false,
  application_stages: { id: "stage-applied", name: "Applied", slug: "applied" },
};

describe("get_lead_applications lead-visibility gate", () => {
  beforeEach(() => {
    canViewLeadMock.mockReset();
  });

  it("refuses a lead the caller can't view", async () => {
    canViewLeadMock.mockResolvedValue(false);
    const { getLeadApplicationsTool } = await import("./get-lead-applications");
    const db = fakeDb(LEAD_ROW, [APPLICATION_ROW]);
    const result = await getLeadApplicationsTool.execute(fixtureCtx(db), { leadId: "lead-1" });
    expect(result).toEqual({ error: "Lead not found." });
  });

  it("returns applications when the caller can view the lead", async () => {
    canViewLeadMock.mockResolvedValue(true);
    const { getLeadApplicationsTool } = await import("./get-lead-applications");
    const db = fakeDb(LEAD_ROW, [APPLICATION_ROW], [{ application_id: "app-1" }, { application_id: "app-1" }]);
    const result = (await getLeadApplicationsTool.execute(fixtureCtx(db), { leadId: "lead-1" })) as {
      name: string;
      href: string;
      applications: Array<{ universityName: string; notesCount: number; stage: { slug: string } | null }>;
    };
    expect(result.name).toBe("Aisha Khan");
    expect(result.href).toBe("/leads/lead-1");
    expect(result.applications).toHaveLength(1);
    expect(result.applications[0].universityName).toBe("Oxford");
    expect(result.applications[0].notesCount).toBe(2);
    expect(result.applications[0].stage).toEqual({ slug: "applied", name: "Applied" });
  });

  it("returns 'Lead not found.' when the lead doesn't exist in this tenant, without calling canViewLead", async () => {
    const { getLeadApplicationsTool } = await import("./get-lead-applications");
    const db = fakeDb(null, []);
    const result = await getLeadApplicationsTool.execute(fixtureCtx(db), { leadId: "lead-missing" });
    expect(result).toEqual({ error: "Lead not found." });
    expect(canViewLeadMock).not.toHaveBeenCalled();
  });
});
