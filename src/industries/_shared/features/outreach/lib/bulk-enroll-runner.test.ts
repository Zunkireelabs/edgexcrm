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
let switchCalls: Array<Record<string, unknown>>;
let switchBehavior: (leadId: string) => Promise<unknown>;
let queueCalls: Array<{ leadId: string; sequenceId: string; queuedBy: string; runId: string | null }>;
let queueResult: "queued" | "already_queued";

// vi.mock factories are hoisted above every other top-level statement, so anything they touch at factory time
// must come from vi.hoisted.
const { FakeConflict } = vi.hoisted(() => ({ FakeConflict: class FakeConflict extends Error {} }));

vi.mock("./engine", () => ({
  EnrollmentConflictError: FakeConflict,
  switchEnrollment: async (_db: unknown, _auth: unknown, params: { leadId: string }) => {
    switchCalls.push(params);
    return switchBehavior(params.leadId);
  },
  enrollLead: async (_db: unknown, _auth: unknown, params: { leadId: string; assignedTo: string | null; enrolledBy: string }) => {
    enrollCalls.push({ leadId: params.leadId, assignedTo: params.assignedTo, enrolledBy: params.enrolledBy });
    return enrollBehavior(params.leadId);
  },
}));
vi.mock("./queue-next", () => ({
  queueNextSequence: async (_db: unknown, params: { leadId: string; sequenceId: string; queuedBy: string; runId: string | null }) => {
    queueCalls.push(params);
    return queueResult;
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
  switchCalls = [];
  switchBehavior = async () => ({});
  queueCalls = [];
  queueResult = "queued";
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

describe("two passes over the same run at once (Start route's first pass + the timer)", () => {
  it("only one works the run: every lead ends enrolled, none is mislabelled as skipped", async () => {
    seed({ leads: 60 });
    tables.sequence_enrollments = [];
    // like the real unique index: a lead can be enrolled once; a second attempt conflicts. Each enroll yields to the
    // event loop so two unguarded passes would genuinely interleave.
    enrollBehavior = async (leadId) => {
      await new Promise((r) => setTimeout(r, 0));
      if (tables.sequence_enrollments.some((e) => e.lead_id === leadId)) throw new FakeConflict("already");
      tables.sequence_enrollments.push({ id: `enr-${leadId}`, lead_id: leadId, sequence_id: "seq-1", status: "active" });
      return {};
    };

    const [a, b] = await Promise.all([processBulkEnrollRun(T, RUN), processBulkEnrollRun(T, RUN)]);

    expect(a.enrolled + b.enrolled).toBe(60);
    expect(outcomes().every((o) => o === "enrolled")).toBe(true);
    expect(enrollCalls).toHaveLength(60); // nobody attempted twice
    expect(run()).toMatchObject({ status: "completed", enrolled_count: 60, skipped_count: 0, failed_count: 0 });
  });

  it("the lock is released afterwards, so a later pass can continue a run", async () => {
    seed({ leads: 3 });
    await processBulkEnrollRun(T, RUN, 0); // no time: nothing done, run left running
    const second = await processBulkEnrollRun(T, RUN);
    expect(second.enrolled).toBe(3);
  });

  it("a lead already in THIS sequence is labelled as such under the default skip policy", async () => {
    seed({ leads: 1, runOverrides: { conflict_policy: "skip" } });
    tables.sequence_enrollments = [{ id: "enr-same", lead_id: "lead-1", sequence_id: "seq-1", status: "active" }];
    enrollBehavior = async () => {
      throw new FakeConflict("already");
    };
    await processBulkEnrollRun(T, RUN);
    expect(tables.sequence_bulk_enrollment_items[0].reason).toBe("already_in_this_sequence");
  });
});

describe("conflict policies (a lead already in a running sequence)", () => {
  /** lead-1 throws a conflict on its FIRST enroll; later calls succeed unless `again` is set. */
  function conflictOnFirst(leadId: string, again = false) {
    const seen = new Map<string, number>();
    enrollBehavior = async (id) => {
      const n = (seen.get(id) ?? 0) + 1;
      seen.set(id, n);
      if (id === leadId && (n === 1 || again)) throw new FakeConflict("already");
      return {};
    };
  }

  it("skip (default): the lead is left where it is", async () => {
    seed({ leads: 1, runOverrides: { conflict_policy: "skip" } });
    conflictOnFirst("lead-1");
    await processBulkEnrollRun(T, RUN);
    expect(outcomes()).toEqual(["skipped"]);
    expect(tables.sequence_bulk_enrollment_items[0].reason).toBe("already_in_sequence");
    expect(switchCalls).toHaveLength(0);
    expect(queueCalls).toHaveLength(0);
  });

  it("switch: ends the current enrollment WITHOUT promoting the queue, then enrolls here", async () => {
    seed({ leads: 1, runOverrides: { conflict_policy: "switch" } });
    tables.sequence_enrollments = [{ id: "enr-old", lead_id: "lead-1", sequence_id: "seq-OTHER", status: "active" }];
    conflictOnFirst("lead-1");

    await processBulkEnrollRun(T, RUN);

    expect(switchCalls).toEqual([
      { oldEnrollmentId: "enr-old", sequenceId: "seq-1", leadId: "lead-1", assignedTo: "rep-1", enrolledBy: "user-1" },
    ]);
    expect(enrollCalls.map((c) => c.leadId)).toEqual(["lead-1"]); // refused once; the switch is ONE call, not unenroll + enroll
    expect(outcomes()).toEqual(["enrolled"]);
    expect(tables.sequence_bulk_enrollment_items[0].reason).toBe("switched");
  });

  it("switch: a lead already in THIS sequence is never restarted", async () => {
    seed({ leads: 1, runOverrides: { conflict_policy: "switch" } });
    tables.sequence_enrollments = [{ id: "enr-same", lead_id: "lead-1", sequence_id: "seq-1", status: "paused" }];
    conflictOnFirst("lead-1");

    await processBulkEnrollRun(T, RUN);

    expect(switchCalls).toHaveLength(0);
    expect(outcomes()).toEqual(["skipped"]);
    expect(tables.sequence_bulk_enrollment_items[0].reason).toBe("already_in_this_sequence");
  });

  it("switch: if the lead lands in another sequence in between, it is skipped, not duplicated", async () => {
    seed({ leads: 1, runOverrides: { conflict_policy: "switch" } });
    tables.sequence_enrollments = [{ id: "enr-old", lead_id: "lead-1", sequence_id: "seq-OTHER", status: "active" }];
    conflictOnFirst("lead-1");
    switchBehavior = async () => {
      throw new FakeConflict("already"); // the transaction refuses: someone enrolled the lead meanwhile
    };

    await processBulkEnrollRun(T, RUN);

    expect(outcomes()).toEqual(["skipped"]);
    expect(tables.sequence_bulk_enrollment_items[0].reason).toBe("already_in_sequence");
  });

  it("queue: parks this sequence behind the current one and records it as queued_next", async () => {
    seed({ leads: 1, runOverrides: { conflict_policy: "queue" } });
    conflictOnFirst("lead-1");

    await processBulkEnrollRun(T, RUN);

    expect(queueCalls).toEqual([{ leadId: "lead-1", sequenceId: "seq-1", queuedBy: "user-1", runId: RUN }]);
    expect(outcomes()).toEqual(["skipped"]);
    expect(tables.sequence_bulk_enrollment_items[0].reason).toBe("queued_next");
    expect(switchCalls).toHaveLength(0);
  });

  it("queue: a lead that already has a waiting queued sequence is reported as already_queued", async () => {
    seed({ leads: 1, runOverrides: { conflict_policy: "queue" } });
    queueResult = "already_queued";
    conflictOnFirst("lead-1");
    await processBulkEnrollRun(T, RUN);
    expect(tables.sequence_bulk_enrollment_items[0].reason).toBe("already_queued");
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
