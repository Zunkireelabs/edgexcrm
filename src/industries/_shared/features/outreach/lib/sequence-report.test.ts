import { describe, it, expect } from "vitest";
import { buildSequenceReport, pct } from "./sequence-report";

// The per-sequence report: only COUNT queries, scoped to ONE sequence, with the numbers an admin acts on (who is in it,
// what happened, what the emails did, the step funnel, what is queued).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
let tables: Record<string, Row[]>;
let selects: string[];

const pathGet = (row: Row, path: string) => path.split(".").reduce<unknown>((v, k) => (v as Row | undefined)?.[k], row);

const db = {
  from(table: string) {
    return {
      select(cols: string, opts?: { count?: string; head?: boolean }) {
        selects.push(`${table}|${cols}|${opts?.head ? "head" : "rows"}`);
        const eqs: Array<[string, unknown]> = [];
        const lte: Array<[string, string]> = [];
        const gt: Array<[string, string]> = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = {
          eq(c: string, v: unknown) { eqs.push([c, v]); return b; },
          lte(c: string, v: string) { lte.push([c, v]); return b; },
          gt(c: string, v: string) { gt.push([c, v]); return b; },
          then(resolve: (v: unknown) => void) {
            const hit = (tables[table] ?? []).filter(
              (r) => eqs.every(([c, v]) => pathGet(r, c) === v) && lte.every(([c, v]) => String(pathGet(r, c)) <= v) && gt.every(([c, v]) => String(pathGet(r, c)) > v)
            );
            resolve({ count: hit.length, data: null, error: null });
          },
        };
        return b;
      },
    };
  },
} as never;

const enr = (id: string, status: string, stop_reason: string | null = null, sequence_id = "seq-1") => ({ id, sequence_id, status, stop_reason });
const sent = (id: string, step_order: number, emailStatus: string | null, sequence_id = "seq-1") => ({
  id, status: "sent", step_order, due_at: "2026-10-01T00:00:00.000Z",
  sequence_enrollments: { sequence_id, status: "active" },
  email_messages: emailStatus ? { status: emailStatus } : null,
});
const pending = (id: string, due_at: string, enrStatus = "active", sequence_id = "seq-1") => ({
  id, status: "pending", step_order: 2, due_at, sequence_enrollments: { sequence_id, status: enrStatus }, email_messages: null,
});

const PAST = "2026-10-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";

describe("pct", () => {
  it("one decimal, null when there is nothing to divide by", () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(2, 3)).toBe(66.7);
    expect(pct(5, 5)).toBe(100);
    expect(pct(0, 10)).toBe(0);
    expect(pct(3, 0)).toBeNull();
  });
});

describe("buildSequenceReport", () => {
  it("counts enrollments by state and outcome, for THIS sequence only", async () => {
    selects = [];
    tables = {
      sequence_enrollments: [
        enr("a", "active"), enr("b", "active"),
        enr("c", "paused", "replied"), enr("d", "paused", "sequence_paused"), enr("e", "paused"),
        enr("f", "completed"), enr("g", "unenrolled", "suppressed"), enr("h", "unenrolled", "replied"), enr("i", "unenrolled"),
        enr("other", "active", null, "seq-OTHER"),
      ],
      sequence_step_drafts: [],
    };

    const r = await buildSequenceReport(db, "seq-1", [1, 2]);

    expect(r.enrollments).toEqual({ total: 9, running: 2, paused: 3, completed: 1, ended: 3, replied: 2, doNotContact: 1, pausedByStopAll: 1 });
  });

  it("counts sent emails and what the provider reported, plus the step funnel", async () => {
    tables = {
      sequence_enrollments: [enr("a", "active"), enr("b", "active"), enr("c", "completed"), enr("d", "paused", "replied")],
      sequence_step_drafts: [
        sent("1", 1, "delivered"), sent("2", 1, "delivered"), sent("3", 1, "bounced"), sent("4", 1, "sent"),
        sent("5", 2, "delivered"), sent("6", 2, "complained"),
        sent("7", 3, null),
        sent("x", 1, "delivered", "seq-OTHER"), // another sequence's email is never counted
      ],
    };

    const r = await buildSequenceReport(db, "seq-1", [1, 2, 3]);

    expect(r.emails).toEqual({ sent: 7, delivered: 3, bounced: 1, complained: 1 });
    expect(r.steps).toEqual([{ stepOrder: 1, sent: 4 }, { stepOrder: 2, sent: 2 }, { stepOrder: 3, sent: 1 }]);
    expect(r.rates).toEqual({ deliveredPct: 42.9, bouncedPct: 14.3, complainedPct: 14.3, repliedPct: 25 });
  });

  it("queue: drafts due now vs scheduled later, only for ACTIVE enrollments of this sequence", async () => {
    tables = {
      sequence_enrollments: [],
      sequence_step_drafts: [
        pending("p1", PAST), pending("p2", PAST), pending("p3", FUTURE),
        pending("paused", PAST, "paused"), // a paused lead's draft is not waiting to go out
        pending("other", PAST, "active", "seq-OTHER"),
      ],
    };

    const r = await buildSequenceReport(db, "seq-1", [1]);

    expect(r.queue).toEqual({ dueNow: 2, scheduledLater: 1 });
  });

  it("an empty sequence reports zeros and null rates (no divide-by-zero)", async () => {
    tables = { sequence_enrollments: [], sequence_step_drafts: [] };
    const r = await buildSequenceReport(db, "seq-1", []);
    expect(r.enrollments.total).toBe(0);
    expect(r.emails).toEqual({ sent: 0, delivered: 0, bounced: 0, complained: 0 });
    expect(r.steps).toEqual([]);
    expect(r.rates).toEqual({ deliveredPct: null, bouncedPct: null, complainedPct: null, repliedPct: null });
  });

  it("uses COUNT queries only — never fetches rows (PostgREST caps a row list at 1,000)", async () => {
    selects = [];
    tables = { sequence_enrollments: [], sequence_step_drafts: [] };
    await buildSequenceReport(db, "seq-1", [1, 2]);
    expect(selects.length).toBeGreaterThan(10);
    expect(selects.every((s) => s.endsWith("|head"))).toBe(true);
  });

  it("a database error surfaces instead of reporting wrong numbers", async () => {
    // every builder method returns the builder; awaiting it yields a database error
    const builder: unknown = new Proxy({}, { get: (_t, prop) => (prop === "then" ? (r: (v: unknown) => void) => r({ count: null, error: { message: "boom" } }) : () => builder) });
    const failing = { from: () => ({ select: () => builder }) } as never;
    await expect(buildSequenceReport(failing, "seq-1", [])).rejects.toThrow("sequence report: boom");
  });
});
