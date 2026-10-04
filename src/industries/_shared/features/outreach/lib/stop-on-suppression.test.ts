import { describe, it, expect, vi, beforeEach } from "vitest";

// stopEnrollmentsForSuppressedEmail (migration 262): an address on the do-not-contact list ends every running sequence
// of the leads that carry it — case-insensitively, twins included, the address matched literally — skips their pending
// drafts, cancels a queued "next" sequence, records why, and is a no-op the second time.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

let tables: Record<string, Row[]>;
const emitEventMock = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/api/audit", () => ({ emitEvent: (...a: unknown[]) => emitEventMock(...a) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

/** ilike with Postgres' default `\` escape: `\x` is literal x, `%` any run, `_` any single char. */
function ilikeRegex(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (c === "%") out += ".*";
    else if (c === "_") out += ".";
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "i");
}

function makeDb() {
  function from(table: string) {
    const rows = tables[table] ?? (tables[table] = []);
    const build = (mode: "select" | "update", patch?: Row) => {
      const eqs: Array<[string, unknown]> = [];
      const ins: Array<[string, unknown[]]> = [];
      const likes: Array<[string, RegExp]> = [];
      let limitN: number | null = null;
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
        ilike(c: string, pattern: string) {
          likes.push([c, ilikeRegex(pattern)]);
          return b;
        },
        limit(n: number) {
          limitN = n;
          return b;
        },
        select() {
          return b;
        },
        then(resolve: (v: unknown) => void) {
          let hit = rows.filter(
            (r) =>
              eqs.every(([c, v]) => r[c] === v) &&
              ins.every(([c, vs]) => vs.includes(r[c])) &&
              likes.every(([c, re]) => typeof r[c] === "string" && re.test(r[c]))
          );
          if (limitN != null) hit = hit.slice(0, limitN);
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

import { stopEnrollmentsForSuppressedEmail } from "./stop-on-suppression";

const P = { tenantId: "t1", email: "Student@Example.com", reason: "hard_bounce" };

beforeEach(() => {
  emitEventMock.mockClear();
  tables = {
    leads: [
      { id: "lead-1", email: "student@example.com" },
      { id: "lead-2", email: "STUDENT@example.com" }, // a twin with different case
      { id: "lead-3", email: "someone-else@example.com" },
    ],
    sequence_enrollments: [
      { id: "e1", lead_id: "lead-1", sequence_id: "s1", status: "active", stop_reason: null },
      { id: "e2", lead_id: "lead-2", sequence_id: "s2", status: "paused", stop_reason: "replied" },
      { id: "e3", lead_id: "lead-3", sequence_id: "s1", status: "active", stop_reason: null },
      { id: "e4", lead_id: "lead-1", sequence_id: "s3", status: "completed", stop_reason: null },
    ],
    sequence_step_drafts: [
      { id: "d1", enrollment_id: "e1", status: "pending" },
      { id: "d2", enrollment_id: "e1", status: "sent" },
      { id: "d3", enrollment_id: "e2", status: "pending" },
      { id: "d4", enrollment_id: "e3", status: "pending" },
    ],
    sequence_enrollment_queue: [
      { id: "q1", lead_id: "lead-1", sequence_id: "s9", status: "waiting" },
      { id: "q2", lead_id: "lead-3", sequence_id: "s9", status: "waiting" },
    ],
  };
});

describe("stopEnrollmentsForSuppressedEmail", () => {
  it("ends the running enrollments (active AND paused) of every lead with that address, whatever the case", async () => {
    const result = await stopEnrollmentsForSuppressedEmail(makeDb(), P);

    expect(result).toEqual({ leads: 2, ended: 2, queueCancelled: 1 });
    expect(tables.sequence_enrollments.map((e) => [e.id, e.status, e.stop_reason])).toEqual([
      ["e1", "unenrolled", "suppressed"],
      ["e2", "unenrolled", "suppressed"], // a reply-paused enrollment is ended too: it can never be mailed
      ["e3", "active", null], // another person's lead is untouched
      ["e4", "completed", null], // finished enrollments are untouched
    ]);
    expect(tables.sequence_enrollments[0].stopped_at).toEqual(expect.any(String));
  });

  it("skips the pending drafts of the ended enrollments only (never a sent one, never someone else's)", async () => {
    await stopEnrollmentsForSuppressedEmail(makeDb(), P);
    expect(tables.sequence_step_drafts.map((d) => [d.id, d.status])).toEqual([
      ["d1", "skipped"], ["d2", "sent"], ["d3", "skipped"], ["d4", "pending"],
    ]);
  });

  it("cancels a waiting 'queue next' sequence for those leads, and only those", async () => {
    await stopEnrollmentsForSuppressedEmail(makeDb(), P);
    expect(tables.sequence_enrollment_queue.map((q) => [q.id, q.status])).toEqual([["q1", "cancelled"], ["q2", "waiting"]]);
    expect(tables.sequence_enrollment_queue[0].reason).toBe("The address is on the do-not-contact list.");
  });

  it("emits one event per ended enrollment with the reason", async () => {
    await stopEnrollmentsForSuppressedEmail(makeDb(), { ...P, reason: "complaint" });
    expect(emitEventMock).toHaveBeenCalledTimes(2);
    expect(emitEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "sequence.ended_suppressed", entityId: "e1", payload: expect.objectContaining({ reason: "complaint", lead_id: "lead-1" }) })
    );
  });

  it("is idempotent: the second call finds nothing running", async () => {
    await stopEnrollmentsForSuppressedEmail(makeDb(), P);
    emitEventMock.mockClear();
    const again = await stopEnrollmentsForSuppressedEmail(makeDb(), P);
    expect(again).toMatchObject({ ended: 0, queueCancelled: 0 });
    expect(emitEventMock).not.toHaveBeenCalled();
  });

  it("matches the address literally: an underscore is not a wildcard", async () => {
    tables.leads = [
      { id: "lead-a", email: "a_b@example.com" },
      { id: "lead-x", email: "axb@example.com" }, // would match a_b@ if "_" were a wildcard
    ];
    tables.sequence_enrollments = [
      { id: "ea", lead_id: "lead-a", sequence_id: "s1", status: "active", stop_reason: null },
      { id: "ex", lead_id: "lead-x", sequence_id: "s1", status: "active", stop_reason: null },
    ];
    tables.sequence_step_drafts = [];
    tables.sequence_enrollment_queue = [];

    await stopEnrollmentsForSuppressedEmail(makeDb(), { ...P, email: "a_b@example.com" });

    expect(tables.sequence_enrollments.map((e) => [e.id, e.status])).toEqual([["ea", "unenrolled"], ["ex", "active"]]);
  });

  it("also covers the lead id the caller already knows, even if the stored email differs", async () => {
    tables.leads = [{ id: "lead-known", email: "typo@exampel.com" }];
    tables.sequence_enrollments = [{ id: "ek", lead_id: "lead-known", sequence_id: "s1", status: "active", stop_reason: null }];
    tables.sequence_step_drafts = [];
    tables.sequence_enrollment_queue = [];

    await stopEnrollmentsForSuppressedEmail(makeDb(), { ...P, leadId: "lead-known" });

    expect(tables.sequence_enrollments[0].status).toBe("unenrolled");
  });

  it("an empty address or an address no lead has does nothing", async () => {
    expect(await stopEnrollmentsForSuppressedEmail(makeDb(), { ...P, email: "  " })).toEqual({ leads: 0, ended: 0, queueCancelled: 0 });
    expect(await stopEnrollmentsForSuppressedEmail(makeDb(), { ...P, email: "nobody@nowhere.com" })).toEqual({ leads: 0, ended: 0, queueCancelled: 0 });
    expect(tables.sequence_enrollments.map((e) => e.status)).toEqual(["active", "paused", "active", "completed"]);
  });
});
