import { describe, it, expect } from "vitest";
import { pipelineSummaryTool } from "./pipeline-summary";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
import type { ToolContext } from "../types";

type Row = Record<string, unknown>;

function makeChain(rows: Row[]) {
  // A Postgrest query builder is a thenable — `await query` runs it without
  // a terminal call. Support both that and an explicit .maybeSingle().
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    not: () => chain,
    in: () => chain,
    or: () => chain,
    order: () => chain,
    limit: () => chain,
    gte: () => chain,
    lte: () => chain,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  return chain;
}

/**
 * Each table maps to a sequence of row-sets — one per successive `.from(table)`
 * call, holding the last set for any calls beyond the sequence length. Needed
 * because pipeline_summary queries the "pipelines" table twice in the no-default
 * fallback path (the is_default lookup, then the full list) and each call must
 * see different data.
 */
function fakeDb(tables: Record<string, Row[][]>): ScopedClient {
  const counters: Record<string, number> = {};
  return {
    from: (table: string) => {
      const sequence = tables[table] ?? [[]];
      const idx = counters[table] ?? 0;
      counters[table] = idx + 1;
      const rows = sequence[Math.min(idx, sequence.length - 1)];
      return makeChain(rows);
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
    industryId: "education_consultancy",
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

function fixtureCtx(db: ScopedClient, auth: AuthContext = fixtureAuth()): ToolContext {
  return { db, auth, logger: { child: () => ({}) } as unknown as ToolContext["logger"], runId: "run-1" };
}

describe("pipeline_summary default-pipeline resolution", () => {
  it("resolves the tenant's default pipeline when pipelineId is omitted", async () => {
    const db = fakeDb({
      pipelines: [[{ id: "pipeline-default" }]],
      leads: [[{ id: "lead-1", status: "new", list_id: null, created_at: "2026-01-01" }]],
      pipeline_stages: [[{ id: "stage-1", name: "New", slug: "new", position: 0 }]],
      lead_lists: [[]],
    });
    const result = await pipelineSummaryTool.execute(fixtureCtx(db), {});
    expect(result).toMatchObject({ pipelineId: "pipeline-default", total: 1 });
  });

  it("falls back to the tenant's only pipeline when none is flagged default", async () => {
    const db = fakeDb({
      pipelines: [[], [{ id: "pipeline-only", name: "Only Pipeline" }]],
      leads: [[]],
      pipeline_stages: [[]],
      lead_lists: [[]],
    });
    const result = await pipelineSummaryTool.execute(fixtureCtx(db), {});
    expect(result).toMatchObject({ pipelineId: "pipeline-only", total: 0 });
  });

  it("falls back to the default pipeline when the supplied pipelineId doesn't exist (invented, not just NIL)", async () => {
    // Reproduces a live-observed case: the model invented a syntactically
    // valid but never-seen uuid instead of the NIL placeholder. The first
    // "pipelines" call is the existence check for that invented id (misses),
    // the second is the is_default lookup (hits).
    const db = fakeDb({
      pipelines: [[], [{ id: "pipeline-default" }]],
      leads: [[{ id: "lead-1", status: "new", list_id: null, created_at: "2026-01-01" }]],
      pipeline_stages: [[{ id: "stage-1", name: "New", slug: "new", position: 0 }]],
      lead_lists: [[]],
    });
    const result = await pipelineSummaryTool.execute(fixtureCtx(db), { pipelineId: "11111111-1111-4111-8111-111111111111" });
    expect(result).toMatchObject({ pipelineId: "pipeline-default", total: 1 });
  });

  it("returns a pipeline list with a note when multiple pipelines exist and none is default", async () => {
    const db = fakeDb({
      pipelines: [
        [],
        [
          { id: "pipeline-a", name: "Sales" },
          { id: "pipeline-b", name: "Admissions" },
        ],
      ],
    });
    const result = await pipelineSummaryTool.execute(fixtureCtx(db), {});
    expect(result).toMatchObject({
      pipelines: [
        { pipelineId: "pipeline-a", name: "Sales" },
        { pipelineId: "pipeline-b", name: "Admissions" },
      ],
    });
    expect((result as { note?: string }).note).toMatch(/multiple pipelines/i);
  });

  it("errors when the tenant has no pipelines at all", async () => {
    const db = fakeDb({ pipelines: [[], []] });
    const result = await pipelineSummaryTool.execute(fixtureCtx(db), {});
    expect(result).toEqual({ error: "No pipeline found for this tenant." });
  });
});
