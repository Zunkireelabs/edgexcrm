import { describe, it, expect, vi, beforeEach } from "vitest";

// "Queue next" (migration 259): park a sequence behind a lead's running one, start it when theirs ends.
// Pins: one waiting row per lead (23505 -> already_queued); starting uses the one existing enrollLead; a lead
// that is back in a sequence keeps waiting; an archived sequence / deleted lead / departed starter marks the
// queue row failed with a reason instead of enrolling or throwing.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

let tables: Record<string, Row[]>;
let authResult: { userId: string; tenantId: string } | null;
let enrollCalls: Array<Record<string, unknown>>;
let enrollBehavior: () => Promise<unknown>;

const { FakeConflict } = vi.hoisted(() => ({ FakeConflict: class FakeConflict extends Error {} }));

vi.mock("./engine", () => ({
  EnrollmentConflictError: FakeConflict,
  enrollLead: async (_db: unknown, _auth: unknown, params: Record<string, unknown>) => {
    enrollCalls.push(params);
    return enrollBehavior();
  },
}));
vi.mock("@/lib/api/auth", () => ({ buildUserAuthContext: async () => authResult }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

let insertError: { code: string; message: string } | null = null;

function makeDb() {
  return {
    from(table: string) {
      const rows = tables[table] ?? (tables[table] = []);
      const make = (mode: "select" | "update", patch?: Row) => {
        const eqs: Array<[string, unknown]> = [];
        const matches = (r: Row) => eqs.every(([k, v]) => r[k] === v);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = {
          eq(c: string, v: unknown) {
            eqs.push([c, v]);
            return b;
          },
          order() {
            return b;
          },
          limit() {
            return b;
          },
          maybeSingle: async () => ({ data: rows.filter(matches)[0] ?? null, error: null }),
          then(resolve: (v: unknown) => void) {
            if (mode === "update") {
              const hit = rows.filter(matches);
              hit.forEach((r) => Object.assign(r, patch));
              resolve({ data: hit, error: null });
            } else resolve({ data: rows.filter(matches), error: null });
          },
        };
        return b;
      };
      return {
        select: () => make("select"),
        update: (patch: Row) => make("update", patch),
        insert: async (payload: Row) => {
          if (insertError) return { error: insertError };
          rows.push({ id: `q-${rows.length + 1}`, ...payload });
          return { error: null };
        },
      };
    },
  };
}
vi.mock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: async () => makeDb() }));

import { queueNextSequence, startQueuedEnrollment, promoteQueuedEnrollment } from "./queue-next";

const T = "t1";

function seed(opts: { seqStatus?: string; leadDeleted?: boolean; queueStatus?: string } = {}) {
  tables = {
    sequence_enrollment_queue: [
      { id: "q1", lead_id: "lead-1", sequence_id: "seq-B", queued_by: "user-1", status: opts.queueStatus ?? "waiting", created_at: 1 },
    ],
    email_sequences: [{ id: "seq-B", status: opts.seqStatus ?? "active" }],
    leads: [{ id: "lead-1", assigned_to: "rep-1", deleted_at: opts.leadDeleted ? "2026-10-01T00:00:00Z" : null }],
  };
}

beforeEach(() => {
  authResult = { userId: "user-1", tenantId: T };
  enrollCalls = [];
  enrollBehavior = async () => ({});
  insertError = null;
});

describe("queueNextSequence", () => {
  it("inserts a waiting row, and reports an existing waiting one as already_queued", async () => {
    tables = { sequence_enrollment_queue: [] };
    const db = makeDb() as never;
    expect(await queueNextSequence(db, { leadId: "lead-1", sequenceId: "seq-B", queuedBy: "u", runId: "run-1" })).toBe("queued");
    expect(tables.sequence_enrollment_queue[0]).toMatchObject({ lead_id: "lead-1", sequence_id: "seq-B", queued_by: "u", run_id: "run-1", status: "waiting" });

    insertError = { code: "23505", message: "duplicate" }; // the partial unique index: one waiting row per lead
    expect(await queueNextSequence(db, { leadId: "lead-1", sequenceId: "seq-C", queuedBy: "u", runId: null })).toBe("already_queued");
  });

  it("any other database error is thrown", async () => {
    tables = { sequence_enrollment_queue: [] };
    insertError = { code: "XX000", message: "down" };
    await expect(queueNextSequence(makeDb() as never, { leadId: "l", sequenceId: "s", queuedBy: "u", runId: null })).rejects.toThrow("down");
  });
});

describe("startQueuedEnrollment", () => {
  it("nothing waiting -> none, nothing enrolled", async () => {
    tables = { sequence_enrollment_queue: [] };
    expect(await startQueuedEnrollment(T, "lead-1")).toBe("none");
    expect(enrollCalls).toHaveLength(0);
  });

  it("starts the queued sequence for the lead (keeping the lead's assignee) and marks the row started", async () => {
    seed();
    expect(await startQueuedEnrollment(T, "lead-1")).toBe("started");
    expect(enrollCalls).toEqual([{ sequenceId: "seq-B", leadId: "lead-1", assignedTo: "rep-1", enrolledBy: "user-1" }]);
    expect(tables.sequence_enrollment_queue[0]).toMatchObject({ status: "started" });
    expect(tables.sequence_enrollment_queue[0].started_at).toEqual(expect.any(String));
  });

  it("only ever starts a WAITING row (a started / cancelled one is not started twice)", async () => {
    seed({ queueStatus: "started" });
    expect(await startQueuedEnrollment(T, "lead-1")).toBe("none");
    expect(enrollCalls).toHaveLength(0);
  });

  it("a lead that is in a sequence again keeps waiting", async () => {
    seed();
    enrollBehavior = async () => {
      throw new FakeConflict("running");
    };
    expect(await startQueuedEnrollment(T, "lead-1")).toBe("waiting");
    expect(tables.sequence_enrollment_queue[0].status).toBe("waiting");
  });

  it("an archived sequence / deleted lead / departed starter fails the row with a reason and enrolls nobody", async () => {
    seed({ seqStatus: "archived" });
    expect(await startQueuedEnrollment(T, "lead-1")).toBe("failed");
    expect(tables.sequence_enrollment_queue[0]).toMatchObject({ status: "failed", reason: "The queued sequence is no longer active." });

    seed({ leadDeleted: true });
    expect(await startQueuedEnrollment(T, "lead-1")).toBe("failed");
    expect(tables.sequence_enrollment_queue[0].reason).toBe("The lead was deleted.");

    seed();
    authResult = null;
    expect(await startQueuedEnrollment(T, "lead-1")).toBe("failed");
    expect(tables.sequence_enrollment_queue[0].reason).toBe("The person who queued this no longer has access.");
    expect(enrollCalls).toHaveLength(0);
  });

  it("an unexpected enroll error marks the row failed (and does not throw)", async () => {
    seed();
    enrollBehavior = async () => {
      throw new Error("draft failed");
    };
    expect(await startQueuedEnrollment(T, "lead-1")).toBe("failed");
    expect(tables.sequence_enrollment_queue[0]).toMatchObject({ status: "failed", reason: "draft failed" });
  });
});

describe("promoteQueuedEnrollment", () => {
  it("never throws, even when starting blows up", async () => {
    seed();
    enrollBehavior = async () => {
      throw new Error("x");
    };
    tables.email_sequences = undefined as never; // makes the lookup itself throw
    await expect(promoteQueuedEnrollment(T, "lead-1")).resolves.toBeUndefined();
  });
});
