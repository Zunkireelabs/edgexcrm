import { describe, it, expect } from "vitest";
import { classEnrollmentSummaryTool } from "./class-enrollment-summary";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
import type { ToolContext } from "@/lib/ai/tools/types";

type Row = Record<string, unknown>;

function makeChain(rows: Row[], singleRow: Row | null = null, count?: number) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: singleRow, error: null }),
    then: (resolve: (v: { data: Row[]; error: null; count?: number }) => unknown) =>
      Promise.resolve({ data: rows, error: null, count: count ?? rows.length }).then(resolve),
  };
  return chain;
}

function fakeDb(opts: {
  classes: Row[];
  existsRow?: Row | null;
  enrollmentsAll: Row[];
  enrollmentDetail?: Row[];
  enrollmentDetailCount?: number;
}): ScopedClient {
  let enrollCall = 0;
  return {
    from: (table: string) => {
      if (table === "classes") return makeChain(opts.classes, opts.existsRow ?? null);
      if (table === "class_enrollments") {
        enrollCall += 1;
        if (enrollCall === 1) return makeChain(opts.enrollmentsAll);
        return makeChain(opts.enrollmentDetail ?? [], null, opts.enrollmentDetailCount);
      }
      return makeChain([]);
    },
    fromGlobal: () => {
      throw new Error("not used in this test");
    },
    raw: () => {
      throw new Error("not used in this test");
    },
  } as unknown as ScopedClient;
}

const OWNER_PERMISSIONS = { baseTier: "owner", leadScope: "all", pipelineAccess: "all" } as AuthContext["permissions"];

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

function fixtureCtx(db: ScopedClient): ToolContext {
  return { db, auth: fixtureAuth(), logger: { child: () => ({}) } as unknown as ToolContext["logger"], runId: "run-1" };
}

const CLASSES = [
  { id: "class-a", name: "IELTS Prep", default_fee: 200, is_active: true },
  { id: "class-b", name: "SAT Prep", default_fee: 300, is_active: true },
];

const ENROLLMENTS_ALL = [
  { class_id: "class-a", fee_amount: 200, fee_paid: true },
  { class_id: "class-a", fee_amount: 200, fee_paid: false },
  { class_id: "class-b", fee_amount: 300, fee_paid: true },
];

describe("class_enrollment_summary", () => {
  it("all-classes mode: aggregates enrolledCount/feesCollected/feesOutstanding per class + totals", async () => {
    const db = fakeDb({ classes: CLASSES, enrollmentsAll: ENROLLMENTS_ALL });
    const result = (await classEnrollmentSummaryTool.execute(fixtureCtx(db), {})) as {
      classes: Array<{ id: string; enrolledCount: number; feesCollected: number; feesOutstanding: number }>;
      totals: { enrolledCount: number; feesCollected: number; feesOutstanding: number };
      enrollments?: unknown[];
    };

    const a = result.classes.find((c) => c.id === "class-a")!;
    expect(a.enrolledCount).toBe(2);
    expect(a.feesCollected).toBe(200);
    expect(a.feesOutstanding).toBe(200);

    const b = result.classes.find((c) => c.id === "class-b")!;
    expect(b.enrolledCount).toBe(1);
    expect(b.feesCollected).toBe(300);
    expect(b.feesOutstanding).toBe(0);

    expect(result.totals).toEqual({ enrolledCount: 3, feesCollected: 500, feesOutstanding: 200 });
    expect(result.enrollments).toBeUndefined();
  });

  it("falls through to all-classes mode for an unknown/foreign classId (probing dead)", async () => {
    const db = fakeDb({ classes: CLASSES, existsRow: null, enrollmentsAll: ENROLLMENTS_ALL });
    const result = (await classEnrollmentSummaryTool.execute(fixtureCtx(db), { classId: "class-nonexistent" })) as {
      classes: unknown[];
      enrollments?: unknown[];
    };
    expect(result.classes).toHaveLength(2);
    expect(result.enrollments).toBeUndefined();
  });

  it("single-class mode: known classId adds the enrollment list + truncation flag", async () => {
    const detail = Array.from({ length: 25 }, (_, i) => ({
      lead_id: `lead-${i}`,
      fee_amount: 200,
      fee_paid: i % 2 === 0,
      created_at: "2026-01-01",
    }));
    const db = fakeDb({
      classes: CLASSES,
      existsRow: { id: "class-a" },
      enrollmentsAll: ENROLLMENTS_ALL,
      enrollmentDetail: detail,
      enrollmentDetailCount: 30,
    });
    const result = (await classEnrollmentSummaryTool.execute(fixtureCtx(db), { classId: "class-a" })) as {
      enrollments: Array<{ leadHref: string; feeAmount: number; feePaid: boolean }>;
      enrollmentsTruncated: boolean;
    };
    expect(result.enrollments).toHaveLength(25);
    expect(result.enrollments[0].leadHref).toBe("/leads/lead-0");
    expect(result.enrollmentsTruncated).toBe(true);
  });
});
