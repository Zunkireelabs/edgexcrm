import { describe, it, expect } from "vitest";
import { searchApplicationsTool } from "./search-applications";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
import type { ToolContext } from "@/lib/ai/tools/types";

type Row = Record<string, unknown>;

function makeChain(rows: Row[], count?: number) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    in: () => chain,
    or: () => chain,
    order: () => chain,
    limit: () => chain,
    then: (resolve: (v: { data: Row[]; error: null; count?: number }) => unknown) =>
      Promise.resolve({ data: rows, error: null, count: count ?? rows.length }).then(resolve),
  };
  return chain;
}

function fakeDb(tables: Record<string, Row[]>, appCount?: number): ScopedClient {
  return {
    from: (table: string) => makeChain(tables[table] ?? [], table === "applications" ? appCount : undefined),
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

const STAGES = [
  { id: "stage-applied", name: "Applied", slug: "applied" },
  { id: "stage-shortlisted", name: "Shortlisted", slug: "shortlisted" },
];

const APPLICATIONS = [
  {
    id: "app-1",
    lead_id: "lead-1",
    university_name: "Oxford",
    program_name: "MSc CS",
    country: "UK",
    intake_term: "Fall 2026",
    status: "applied",
    offer_type: null,
    application_deadline: null,
    application_fee_paid: true,
    application_stages: { id: "stage-applied", name: "Applied", slug: "applied" },
  },
];

describe("search_applications", () => {
  it("returns an unknown-stage error listing valid slugs", async () => {
    const db = fakeDb({ application_stages: STAGES });
    const result = await searchApplicationsTool.execute(
      fixtureCtx(db, fixtureAuth({ role: "owner", permissions: OWNER_PERMISSIONS })),
      { stage: "nonexistent_stage", limit: 20 },
    );
    expect(result).toEqual({ error: 'Unknown stage "nonexistent_stage".', validStages: ["applied", "shortlisted"] });
  });

  it("counselor scoping: returns zero results when the counselor has no assigned leads", async () => {
    const db = fakeDb({ leads: [], application_stages: STAGES, applications: APPLICATIONS });
    const result = await searchApplicationsTool.execute(fixtureCtx(db), { limit: 20 });
    expect(result).toEqual({ total: 0, applications: [] });
  });

  it("counselor scoping: returns applications when the counselor has assigned leads", async () => {
    const db = fakeDb(
      { leads: [{ id: "lead-1" }], application_stages: STAGES, applications: APPLICATIONS },
      1,
    );
    const result = (await searchApplicationsTool.execute(fixtureCtx(db), { limit: 20 })) as {
      total: number;
      applications: Array<{ universityName: string; stage: { slug: string } | null }>;
    };
    expect(result.total).toBe(1);
    expect(result.applications).toHaveLength(1);
    expect(result.applications[0].universityName).toBe("Oxford");
    expect(result.applications[0].stage).toEqual({ slug: "applied", name: "Applied" });
  });

  it("owner (non-restricted) sees applications without a leads lookup", async () => {
    const db = fakeDb({ application_stages: STAGES, applications: APPLICATIONS }, 1);
    const result = (await searchApplicationsTool.execute(
      fixtureCtx(db, fixtureAuth({ role: "owner", permissions: OWNER_PERMISSIONS })),
      { limit: 20 },
    )) as { total: number; applications: unknown[] };
    expect(result.total).toBe(1);
    expect(result.applications).toHaveLength(1);
  });
});
