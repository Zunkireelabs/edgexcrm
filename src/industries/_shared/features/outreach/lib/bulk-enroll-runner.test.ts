import { describe, it, expect, vi, beforeEach } from "vitest";

// Bulk-enroll worker (OUTREACH-BULK-ENROLL-BRIEF.md §7). Pins: pending items get enrolled through the ONE
// existing enrollLead; a conflict is a skip, any other error a recorded failure that doesn't stop the run;
// a restart / second pass only touches what is still pending (nobody enrolled twice); cancel is honoured
// between chunks and skips what's left; deleted leads / an archived sequence / a creator with no access are
// handled without enrolling anyone; counts always match the saved item outcomes.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

let tables: Record<string, Row[]>;
let enrollCalls: Array<{ leadId: string; assignedTo: string | null; enrolledBy: string }>;
let enrollBehavior: (leadId: string) => Promise<unknown>;
let authResult: { userId: string; tenantId: string } | null;
let onChunk: (() => void) | null;

// vi.mock factories are hoisted above every other top-level statement, so anything they touch at factory time
// must come from vi.hoisted.
const { FakeConflict } = vi.hoisted(() => ({ FakeConflict: class FakeConflict extends Error {} }));

vi.mock("./engine", () => ({
  EnrollmentConflictError: FakeConflict,
  enrollLead: async (_db: unknown, _auth: unknown, params: { leadId: string; assignedTo: string | null; enrolledBy: string }) => {
    enrollCalls.push({ leadId: params.leadId, assignedTo: params.assignedTo, enrolledBy: params.enrolledBy });
    return enrollBehavior(params.leadId);
  },
}));
vi.mock("@/lib/api/auth", () => ({ buildUserAuthContext: async () => authResult }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

function makeDb() {
  function from(table: string) {
    const rows = tables[table] ?? (tables[table] = []);
    const make = (mode: "select" | "update", patch?: Row, selectOpts?: { count?: string; head?: boolean }) => {
      const eqs: Array<[string, unknown]> = [];
      const ins: Array<[string, unknown[]]> = [];
      let limitN: number | null = null;
      const matches = (r: Row) => eqs.every(([k, v]) => r[k] === v) && ins.every(([k, vs]) => vs.includes(r[k]));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        eq(c: string, v: unknown) {
          eqs.push([c, v]);
          return b;
        },
        in(c: string, vs: unknown[]) {
          ins.push([c, vs]);
          return b;
        },
        order() {
          return b;
        },
        limit(n: number) {
          limitN = n;
          return b;
        },
        select() {
          return b;
        },
        maybeSingle: async () => ({ data: rows.filter(matches)[0] ?? null, error: null }),
        then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
          let result: unknown;
          if (mode === "update") {
            const hit = rows.filter(matches);
            hit.forEach((r) => Object.assign(r, patch));
            result = { data: hit.map((r) => ({ id: r.id })), error: null };
          } else if (selectOpts?.head) {
            result = { count: rows.filter(matches).length, data: null, error: null };
          } else {
            if (table === "sequence_bulk_enrollment_items" && onChunk) onChunk();
            let hit = rows.filter(matches);
            if (limitN != null) hit = hit.slice(0, limitN);
            result = { data: hit, error: null };
          }
          Promise.resolve(result).then(resolve, reject);
        },
      };
      return b;
    };
    return {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => make("select", undefined, opts),
      update: (patch: Row) => make("update", patch),
    };
  }
  return { from };
}

vi.mock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: async () => makeDb() }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => makeDb(),
}));

import { processBulkEnrollRun, runBulkEnrollQueue } from "./bulk-enroll-runner";

const T = "t1";
const RUN = "run-1";

function seed(opts: { leads?: number; runOverrides?: Row; seqStatus?: string } = {}) {
  const n = opts.leads ?? 3;
  tables = {
    sequence_bulk_enrollments: [
      { id: RUN, tenant_id: T, sequence_id: "seq-1", created_by: "user-1", status: "queued", cancel_requested: false, enrolled_count: 0, skipped_count: 0, failed_count: 0, ...opts.runOverrides },
    ],
    sequence_bulk_enrollment_items: Array.from({ length: n }, (_, i) => ({
      id: `item-${i + 1}`, run_id: RUN, lead_id: `lead-${i + 1}`, outcome: "pending", reason: null, created_at: i,
    })),
    email_sequences: [{ id: "seq-1", status: opts.seqStatus ?? "active" }],
    leads: Array.from({ length: n }, (_, i) => ({ id: `lead-${i + 1}`, assigned_to: i === 0 ? "rep-1" : null, deleted_at: null })),
  };
}

const outcomes = () => tables.sequence_bulk_enrollment_items.map((i) => i.outcome);
const run = () => tables.sequence_bulk_enrollments[0];

beforeEach(() => {
  enrollCalls = [];
  enrollBehavior = async () => ({});
  authResult = { userId: "user-1", tenantId: T };
  onChunk = null;
});

describe("processBulkEnrollRun", () => {
  it("enrolls every pending lead through enrollLead, attributes to the starter, and completes with matching counts", async () => {
    seed({ leads: 3 });

    const summary = await processBulkEnrollRun(T, RUN);

    expect(summary).toMatchObject({ enrolled: 3, skipped: 0, failed: 0, finished: true });
    expect(outcomes()).toEqual(["enrolled", "enrolled", "enrolled"]);
    expect(enrollCalls).toEqual([
      { leadId: "lead-1", assignedTo: "rep-1", enrolledBy: "user-1" }, // keeps the lead's assignee
      { leadId: "lead-2", assignedTo: "user-1", enrolledBy: "user-1" }, // unassigned -> the starter
      { leadId: "lead-3", assignedTo: "user-1", enrolledBy: "user-1" },
    ]);
    expect(run()).toMatchObject({ status: "completed", enrolled_count: 3, skipped_count: 0, failed_count: 0 });
    expect(run().finished_at).toEqual(expect.any(String));
  });

  it("a lead already in a sequence is skipped; another error is a recorded failure and the run carries on", async () => {
    seed({ leads: 3 });
    enrollBehavior = async (leadId) => {
      if (leadId === "lead-1") throw new FakeConflict("already");
      if (leadId === "lead-2") throw new Error("boom");
      return {};
    };

    await processBulkEnrollRun(T, RUN);

    expect(outcomes()).toEqual(["skipped", "failed", "enrolled"]);
    expect(tables.sequence_bulk_enrollment_items[0].reason).toBe("already_in_sequence");
    expect(tables.sequence_bulk_enrollment_items[1].reason).toBe("boom");
    expect(run()).toMatchObject({ status: "completed", enrolled_count: 1, skipped_count: 1, failed_count: 1 });
  });

  it("a soft-deleted lead is skipped, never enrolled", async () => {
    seed({ leads: 2 });
    tables.leads[0].deleted_at = "2026-10-01T00:00:00Z";

    await processBulkEnrollRun(T, RUN);

    expect(outcomes()).toEqual(["skipped", "enrolled"]);
    expect(tables.sequence_bulk_enrollment_items[0].reason).toBe("lead_deleted");
    expect(enrollCalls.map((c) => c.leadId)).toEqual(["lead-2"]);
  });

  it("is idempotent: a second pass over a finished run enrolls nobody again", async () => {
    seed({ leads: 3 });
    await processBulkEnrollRun(T, RUN);
    enrollCalls = [];

    const second = await processBulkEnrollRun(T, RUN);

    expect(second).toEqual({ enrolled: 0, skipped: 0, failed: 0, finished: false });
    expect(enrollCalls).toHaveLength(0);
  });

  it("restart: a run stopped part-way continues with only the still-pending leads", async () => {
    seed({ leads: 4, runOverrides: { status: "running" } });
    tables.sequence_bulk_enrollment_items[0].outcome = "enrolled";
    tables.sequence_bulk_enrollment_items[1].outcome = "enrolled";

    const summary = await processBulkEnrollRun(T, RUN);

    expect(enrollCalls.map((c) => c.leadId)).toEqual(["lead-3", "lead-4"]);
    expect(summary.enrolled).toBe(2);
    expect(run()).toMatchObject({ status: "completed", enrolled_count: 4 });
  });

  it("cancel: stops between chunks and skips what is left as 'cancelled' (enrolled leads stay enrolled)", async () => {
    seed({ leads: 60 }); // > one chunk of 25
    let chunkLoads = 0;
    onChunk = () => {
      chunkLoads++;
      if (chunkLoads === 1) run().cancel_requested = true; // the rep clicks Cancel while the first chunk is being processed
    };

    await processBulkEnrollRun(T, RUN);

    const enrolled = outcomes().filter((o) => o === "enrolled").length;
    const cancelled = tables.sequence_bulk_enrollment_items.filter((i) => i.reason === "cancelled").length;
    expect(enrolled).toBe(25);
    expect(cancelled).toBe(35);
    expect(outcomes().includes("pending")).toBe(false);
    expect(run()).toMatchObject({ status: "cancelled", enrolled_count: 25, skipped_count: 35 });
  });

  it("a run cancelled before it started never enrolls anyone", async () => {
    seed({ leads: 3, runOverrides: { cancel_requested: true } });
    await processBulkEnrollRun(T, RUN);
    expect(enrollCalls).toHaveLength(0);
    expect(run().status).toBe("cancelled");
    expect(outcomes()).toEqual(["skipped", "skipped", "skipped"]);
  });

  it("fails the run (enrolling nobody) when the sequence was archived meanwhile", async () => {
    seed({ leads: 2, seqStatus: "archived" });
    await processBulkEnrollRun(T, RUN);
    expect(enrollCalls).toHaveLength(0);
    expect(run()).toMatchObject({ status: "failed", error: "The sequence is no longer active." });
  });

  it("fails the run when the person who started it no longer has access", async () => {
    seed({ leads: 2 });
    authResult = null;
    await processBulkEnrollRun(T, RUN);
    expect(enrollCalls).toHaveLength(0);
    expect(run().status).toBe("failed");
  });

  it("ignores runs that are already finished", async () => {
    seed({ leads: 2, runOverrides: { status: "completed" } });
    const summary = await processBulkEnrollRun(T, RUN);
    expect(summary).toEqual({ enrolled: 0, skipped: 0, failed: 0, finished: false });
    expect(enrollCalls).toHaveLength(0);
  });

  it("respects the time budget: with no time left it enrolls nothing and leaves the run running", async () => {
    seed({ leads: 3 });
    const summary = await processBulkEnrollRun(T, RUN, 0);
    expect(summary.enrolled).toBe(0);
    expect(run().status).toBe("running");
    expect(outcomes()).toEqual(["pending", "pending", "pending"]);
  });
});

describe("runBulkEnrollQueue", () => {
  it("picks up queued and running runs and processes them", async () => {
    seed({ leads: 2 });
    await runBulkEnrollQueue();
    expect(run().status).toBe("completed");
    expect(enrollCalls).toHaveLength(2);
  });
});
