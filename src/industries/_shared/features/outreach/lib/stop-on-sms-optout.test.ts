import { describe, it, expect, vi, beforeEach } from "vitest";

// stopSmsEnrollmentsForLead: a number that opted out of SMS ends the lead's running SMS sequence(s), skips their pending
// texts, cancels a waiting SMS "queue next", records why, and is a no-op the second time. It never touches the lead's
// EMAIL sequence: an SMS opt-out says nothing about email.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
let tables: Record<string, Row[]>;
const emitEventMock = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/api/audit", () => ({ emitEvent: (...a: unknown[]) => emitEventMock(...a) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

function makeDb() {
  function from(table: string) {
    const rows = tables[table] ?? (tables[table] = []);
    const build = (mode: "select" | "update", patch?: Row) => {
      const eqs: Array<[string, unknown]> = [];
      const ins: Array<[string, unknown[]]> = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        eq(c: string, v: unknown) { eqs.push([c, v]); return b; },
        in(c: string, vs: unknown[]) { ins.push([c, vs]); return b; },
        select() { return b; },
        then(resolve: (v: unknown) => void) {
          const hit = rows.filter((r) => eqs.every(([c, v]) => r[c] === v) && ins.every(([c, vs]) => vs.includes(r[c])));
          if (mode === "update") hit.forEach((r) => Object.assign(r, patch));
          resolve({ data: hit.map((r) => ({ ...r })), error: null });
        },
      };
      return b;
    };
    return { select: () => build("select"), update: (patch: Row) => build("update", patch) };
  }
  return { from } as never;
}

import { stopSmsEnrollmentsForLead } from "./stop-on-sms-optout";

const P = { tenantId: "t1", leadId: "lead-1", reason: "opt_out" };

beforeEach(() => {
  emitEventMock.mockClear();
  tables = {
    sequence_enrollments: [
      { id: "esms", lead_id: "lead-1", sequence_id: "s-sms", status: "active", channel: "sms", stop_reason: null },
      { id: "esms-paused", lead_id: "lead-1", sequence_id: "s-sms2", status: "paused", channel: "sms", stop_reason: null },
      { id: "email", lead_id: "lead-1", sequence_id: "s-mail", status: "active", channel: "email", stop_reason: null },
      { id: "other", lead_id: "lead-2", sequence_id: "s-sms", status: "active", channel: "sms", stop_reason: null },
      { id: "done", lead_id: "lead-1", sequence_id: "s-old", status: "completed", channel: "sms", stop_reason: null },
    ],
    sequence_step_drafts: [
      { id: "d1", enrollment_id: "esms", status: "pending" },
      { id: "d2", enrollment_id: "esms", status: "sent" },
      { id: "d3", enrollment_id: "email", status: "pending" },
    ],
    sequence_enrollment_queue: [
      { id: "q-sms", lead_id: "lead-1", status: "waiting", channel: "sms" },
      { id: "q-mail", lead_id: "lead-1", status: "waiting", channel: "email" },
      { id: "q-other", lead_id: "lead-2", status: "waiting", channel: "sms" },
    ],
  };
});

describe("stopSmsEnrollmentsForLead", () => {
  it("ends the lead's running SMS enrollments (active AND paused) and nothing else", async () => {
    const result = await stopSmsEnrollmentsForLead(makeDb(), P);
    expect(result).toEqual({ ended: 2 });
    expect(tables.sequence_enrollments.map((e) => [e.id, e.status, e.stop_reason])).toEqual([
      ["esms", "unenrolled", "suppressed"],
      ["esms-paused", "unenrolled", "suppressed"],
      ["email", "active", null], // the email sequence is untouched
      ["other", "active", null], // another lead is untouched
      ["done", "completed", null], // finished enrollments are untouched
    ]);
    expect(tables.sequence_enrollments[0].stopped_at).toEqual(expect.any(String));
  });

  it("skips the pending texts of the ended enrollments only (never a sent one, never the email sequence's)", async () => {
    await stopSmsEnrollmentsForLead(makeDb(), P);
    expect(tables.sequence_step_drafts.map((d) => [d.id, d.status])).toEqual([["d1", "skipped"], ["d2", "sent"], ["d3", "pending"]]);
  });

  it("cancels only this lead's waiting SMS queue (not the email queue, not another lead's)", async () => {
    await stopSmsEnrollmentsForLead(makeDb(), P);
    expect(tables.sequence_enrollment_queue.map((q) => [q.id, q.status])).toEqual([
      ["q-sms", "cancelled"],
      ["q-mail", "waiting"],
      ["q-other", "waiting"],
    ]);
  });

  it("emits one event per ended enrollment, tagged as SMS", async () => {
    await stopSmsEnrollmentsForLead(makeDb(), P);
    expect(emitEventMock).toHaveBeenCalledTimes(2);
    expect(emitEventMock.mock.calls[0][0]).toMatchObject({ type: "sequence.ended_suppressed", payload: { channel: "sms", lead_id: "lead-1", reason: "opt_out" } });
  });

  it("is idempotent: a second call changes nothing", async () => {
    const db = makeDb();
    await stopSmsEnrollmentsForLead(db, P);
    emitEventMock.mockClear();
    expect(await stopSmsEnrollmentsForLead(db, P)).toEqual({ ended: 0 });
    expect(emitEventMock).not.toHaveBeenCalled();
  });
});
