import { describe, it, expect } from "vitest";
import { applicationFunnelSummaryTool } from "./application-funnel-summary";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
import type { ToolContext } from "@/lib/ai/tools/types";

type Row = Record<string, unknown>;

function makeChain(rows: Row[]) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    in: () => chain,
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

const OWNER_PERMISSIONS = { baseTier: "owner", leadScope: "all", pipelineAccess: "all" } as AuthContext["permissions"];
const COUNSELOR_PERMISSIONS = { baseTier: "member", leadScope: "own", pipelineAccess: "all" } as AuthContext["permissions"];

function fixtureAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "user-1",
    email: "test@example.com",
    tenantId: "tenant-1",
    role: "owner",
    industryId: "education_consultancy",
    positionId: null,
    positionSlug: null,
    branchId: null,
    branchMemberIds: [],
    permissions: OWNER_PERMISSIONS,
    plan: "free",
    entitlements: {} as AuthContext["entitlements"],
    ...overrides,
  };
}

function fixtureCtx(db: ScopedClient, auth: AuthContext = fixtureAuth()): ToolContext {
  return { db, auth, logger: { child: () => ({}) } as unknown as ToolContext["logger"], runId: "run-1" };
}

const STAGES = [
  { id: "stage-shortlisted", name: "Shortlisted", slug: "shortlisted", position: 0, terminal_type: null },
  { id: "stage-applied", name: "Applied", slug: "applied", position: 1, terminal_type: null },
  { id: "stage-enrolled", name: "Enrolled", slug: "enrolled", position: 2, terminal_type: "won" },
];

const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const farAway = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const APPLICATIONS = [
  { id: "app-1", lead_id: "lead-1", stage_id: "stage-shortlisted", status: "shortlisted", university_name: "Oxford", program_name: "MSc CS", application_deadline: soon },
  { id: "app-2", lead_id: "lead-2", stage_id: "stage-applied", status: "applied", university_name: "Cambridge", program_name: "MEng", application_deadline: farAway },
  { id: "app-3", lead_id: "lead-1", stage_id: "stage-applied", status: "applied", university_name: "Imperial", program_name: "MSc Data Science", application_deadline: null },
];

describe("application_funnel_summary aggregation", () => {
  it("says application tracking isn't set up when there are zero stages", async () => {
    const db = fakeDb({ application_stages: [], applications: APPLICATIONS });
    const result = await applicationFunnelSummaryTool.execute(fixtureCtx(db));
    expect(result).toEqual({ note: "Application tracking is not set up yet — no application stages are configured for this tenant." });
  });

  it("computes counts per stage, per status, and deadlines within 14 days", async () => {
    const db = fakeDb({ application_stages: STAGES, applications: APPLICATIONS });
    const result = (await applicationFunnelSummaryTool.execute(fixtureCtx(db))) as {
      byStage: Array<{ slug: string; count: number }>;
      byStatus: Array<{ status: string; count: number }>;
      deadlinesNext14Days: { count: number; soonest: Array<{ universityName: string }> };
    };

    expect(result.byStage.find((s) => s.slug === "shortlisted")!.count).toBe(1);
    expect(result.byStage.find((s) => s.slug === "applied")!.count).toBe(2);
    expect(result.byStage.find((s) => s.slug === "enrolled")!.count).toBe(0);

    expect(result.byStatus).toEqual(
      expect.arrayContaining([
        { status: "shortlisted", count: 1 },
        { status: "applied", count: 2 },
      ]),
    );

    expect(result.deadlinesNext14Days.count).toBe(1);
    expect(result.deadlinesNext14Days.soonest[0].universityName).toBe("Oxford");
  });

  it("counselor scoping: returns zero counts when the counselor has no assigned leads", async () => {
    const db = fakeDb({ application_stages: STAGES, applications: APPLICATIONS, leads: [] });
    const result = (await applicationFunnelSummaryTool.execute(
      fixtureCtx(db, fixtureAuth({ role: "counselor", permissions: COUNSELOR_PERMISSIONS })),
    )) as { byStage: Array<{ count: number }>; byStatus: unknown[]; deadlinesNext14Days: { count: number } };
    expect(result.byStage.every((s) => s.count === 0)).toBe(true);
    expect(result.byStatus).toEqual([]);
    expect(result.deadlinesNext14Days.count).toBe(0);
  });
});
