import { describe, it, expect, vi, beforeEach } from "vitest";

// Auto-send worker (OUTREACH-PHASE2-BRIEF.md §5, moved off Inngest in Outreach Phase 4). Pins:
//  - it_agency's manual sequences (auto_send=false) take ZERO new code path through it (the load-bearing regression)
//  - only DUE drafts of ACTIVE enrollments in AUTO-SEND sequences are sent, oldest first
//  - the due drafts are found with an embedded join and a short sequence-id list — never an in(…) of enrollment ids,
//    which broke past a few hundred enrolled leads (a bulk enroll of thousands)
//  - the daily cap stops a batch and keeps the drafts' due time; a failing draft is pushed out so a few bad addresses
//    can't starve the queue behind them
//  - a pass keeps taking batches while there is work, the cap allows and the budget lasts

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

let tables: Record<string, Row[]>;
let inCalls: Array<{ table: string; col: string; values: unknown[] }>;
let sendBehavior: (draft: { id: string; lead_id: string }) => unknown;
let sentOrder: string[];

vi.mock("@/industries/_shared/features/outreach/lib/send-draft", () => ({
  sendDraftViaEdgeX: async (_db: unknown, _tenant: string, draft: { id: string; lead_id: string }) => {
    sentOrder.push(draft.id);
    const result = (await sendBehavior(draft)) as { status: string };
    // what the real send does on success: markDraftSentViaEdgeX flips the draft to 'sent'
    if (result.status === "sent") {
      const row = tables.sequence_step_drafts.find((d) => d.id === draft.id);
      if (row) row.status = "sent";
    }
    return result;
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const pathGet = (row: Row, path: string) => path.split(".").reduce<unknown>((v, k) => (v as Row | undefined)?.[k], row);

function makeDb() {
  function from(table: string) {
    const rows = tables[table] ?? (tables[table] = []);
    const select = () => {
      const eqs: Array<[string, unknown]> = [];
      const lte: Array<[string, string]> = [];
      const ins: Array<[string, unknown[]]> = [];
      let limitN: number | null = null;
      let orderCol: string | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        eq(c: string, v: unknown) {
          eqs.push([c, v]);
          return b;
        },
        lte(c: string, v: string) {
          lte.push([c, v]);
          return b;
        },
        in(c: string, vs: unknown[]) {
          inCalls.push({ table, col: c, values: vs });
          ins.push([c, vs]);
          return b;
        },
        order(c: string) {
          orderCol = c;
          return b;
        },
        limit(n: number) {
          limitN = n;
          return b;
        },
        then(resolve: (v: unknown) => void) {
          let hit = rows.filter(
            (r) => eqs.every(([c, v]) => pathGet(r, c) === v) && lte.every(([c, v]) => String(pathGet(r, c)) <= v) && ins.every(([c, vs]) => vs.includes(pathGet(r, c)))
          );
          if (orderCol) hit = [...hit].sort((a, c) => (String(pathGet(a, orderCol!)) < String(pathGet(c, orderCol!)) ? -1 : 1));
          if (limitN != null) hit = hit.slice(0, limitN);
          resolve({ data: hit.map((r) => ({ ...r })), error: null });
        },
      };
      return b;
    };
    return {
      select,
      update: (patch: Row) => {
        const eqs: Array<[string, unknown]> = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = {
          eq(c: string, v: unknown) {
            eqs.push([c, v]);
            return b;
          },
          then(resolve: (v: unknown) => void) {
            rows.filter((r) => eqs.every(([c, v]) => r[c] === v)).forEach((r) => Object.assign(r, patch));
            resolve({ data: null, error: null });
          },
        };
        return b;
      },
    };
  }
  return { from };
}
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => makeDb() }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: async () => makeDb() }));

import { processTenantAutoSendDrafts, runAutoSendSequenceSteps } from "./sequence-autosend-runner";

const PAST = "2026-10-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";

function draft(id: string, over: Row = {}): Row {
  return {
    id, tenant_id: "t1", lead_id: `lead-${id}`, subject: "Hi", body_html: "<p>Hi</p>", status: "pending", due_at: PAST,
    sequence_enrollments: { status: "active", sequence_id: "seq-auto" },
    ...over,
  };
}

function seed(drafts: Row[], sequences: Row[] = [{ id: "seq-auto", auto_send: true }, { id: "seq-manual", auto_send: false }]) {
  tables = { email_sequences: sequences, sequence_step_drafts: drafts };
}

beforeEach(() => {
  inCalls = [];
  sentOrder = [];
  sendBehavior = () => ({ status: "sent", emailMessageId: "m" });
});

describe("processTenantAutoSendDrafts", () => {
  it("a tenant with no auto-send sequences short-circuits before touching drafts (it_agency regression)", async () => {
    seed([draft("d1")], [{ id: "seq-manual", auto_send: false }]);
    expect(await processTenantAutoSendDrafts("t1")).toEqual({ sent: 0, throttled: 0, failed: 0, skipped: 0 });
    expect(sentOrder).toHaveLength(0);
  });

  it("sends only DUE drafts of ACTIVE enrollments in AUTO-SEND sequences, oldest first", async () => {
    seed([
      draft("late", { due_at: "2026-10-02T00:00:00.000Z" }),
      draft("early", { due_at: "2026-10-01T00:00:00.000Z" }),
      draft("future", { due_at: FUTURE }),
      draft("paused", { sequence_enrollments: { status: "paused", sequence_id: "seq-auto" } }),
      draft("ended", { sequence_enrollments: { status: "unenrolled", sequence_id: "seq-auto" } }),
      draft("manual-seq", { sequence_enrollments: { status: "active", sequence_id: "seq-manual" } }),
      draft("already-sent", { status: "sent" }),
    ]);

    const result = await processTenantAutoSendDrafts("t1");

    expect(sentOrder).toEqual(["early", "late"]);
    expect(result).toEqual({ sent: 2, throttled: 0, failed: 0, skipped: 0 });
  });

  it("the daily cap stops the batch and the throttled draft keeps its due time", async () => {
    seed([draft("a", { due_at: "2026-10-01T00:00:00.000Z" }), draft("b", { due_at: "2026-10-01T01:00:00.000Z" }), draft("c", { due_at: "2026-10-01T02:00:00.000Z" })]);
    sendBehavior = (d) => (d.id === "b" ? { status: "throttled" } : { status: "sent", emailMessageId: "m" });

    const result = await processTenantAutoSendDrafts("t1");

    expect(sentOrder).toEqual(["a", "b"]); // "c" is not even attempted once the cap is hit
    expect(result).toEqual({ sent: 1, throttled: 1, failed: 0, skipped: 0 });
    expect(tables.sequence_step_drafts.find((d) => d.id === "b")!.due_at).toBe("2026-10-01T01:00:00.000Z");
  });

  it("a failed send is pushed an hour out (and stays pending) so it cannot starve the queue; the error is kept", async () => {
    seed([draft("bad"), draft("good", { due_at: "2026-10-02T00:00:00.000Z" })]);
    sendBehavior = (d) => (d.id === "bad" ? { status: "failed", suppressed: false, errorCode: "x", errorMessage: "mailbox does not exist" } : { status: "sent", emailMessageId: "m" });
    const before = Date.now();

    const result = await processTenantAutoSendDrafts("t1");

    expect(result).toMatchObject({ sent: 1, failed: 1 });
    const bad = tables.sequence_step_drafts.find((d) => d.id === "bad")!;
    expect(bad.status).toBe("pending");
    expect(bad.scheduled_error).toBe("mailbox does not exist");
    expect(new Date(bad.due_at).getTime()).toBeGreaterThanOrEqual(before + 59 * 60_000);
    expect(new Date(bad.due_at).getTime()).toBeLessThanOrEqual(Date.now() + 61 * 60_000);

    sentOrder = [];
    await processTenantAutoSendDrafts("t1"); // next batch: the bad one is no longer due
    expect(sentOrder).toEqual([]);
  });

  it("a draft a previous attempt already ended (failed / suppressed) waits a day instead of being re-selected every pass", async () => {
    seed([draft("ended")]);
    sendBehavior = () => ({ status: "already_handled", messageStatus: "suppressed", errorCode: null, errorMessage: null });
    const before = Date.now();

    expect(await processTenantAutoSendDrafts("t1")).toMatchObject({ failed: 1 });
    const d = tables.sequence_step_drafts[0];
    expect(new Date(d.due_at).getTime()).toBeGreaterThanOrEqual(before + 23 * 3600_000);
    expect(d.scheduled_error).toContain("suppressed");
  });

  it("a lead with no email is counted as skipped; already_sent / in_progress change nothing", async () => {
    seed([draft("a"), draft("b"), draft("c")]);
    const results: Record<string, unknown> = { a: { status: "no_email" }, b: { status: "already_sent" }, c: { status: "in_progress" } };
    sendBehavior = (d) => results[d.id];
    expect(await processTenantAutoSendDrafts("t1")).toEqual({ sent: 0, throttled: 0, failed: 0, skipped: 1 });
  });
});

describe("runAutoSendSequenceSteps", () => {
  it("finds tenants with due work only, with a short sequence-id list — never an in(…) of enrollment ids (scale)", async () => {
    // 5,000 active enrollments in the auto-send sequence: the old code put all their ids in one in(…) filter
    const many = Array.from({ length: 5000 }, (_, i) =>
      draft(`d${i}`, { tenant_id: i < 4990 ? "t1" : "t2", due_at: i < 10 ? PAST : FUTURE, sequence_enrollments: { status: "active", sequence_id: "seq-auto", id: `enr-${i}` } })
    );
    seed(many);

    const results = await runAutoSendSequenceSteps(5000);

    expect(Object.keys(results)).toEqual(["t1"]); // only t1 has anything due
    expect(results.t1.sent).toBe(10);
    expect(inCalls.every((c) => c.values.length <= 100)).toBe(true);
    expect(inCalls.some((c) => c.col === "id" || c.col === "enrollment_id")).toBe(false);
    expect(inCalls.every((c) => c.col === "sequence_enrollments.sequence_id")).toBe(true);
  });

  it("keeps taking batches while there is work: 120 due drafts go out in one pass (50 + 50 + 20)", async () => {
    seed(Array.from({ length: 120 }, (_, i) => draft(`d${String(i).padStart(3, "0")}`)));
    const results = await runAutoSendSequenceSteps(5000);
    expect(results.t1.sent).toBe(120);
    expect(new Set(sentOrder).size).toBe(120); // none twice
  });

  it("stops the pass for a tenant as soon as the daily cap is reached", async () => {
    seed(Array.from({ length: 120 }, (_, i) => draft(`d${String(i).padStart(3, "0")}`)));
    let n = 0;
    sendBehavior = () => (++n > 70 ? { status: "throttled" } : { status: "sent", emailMessageId: "m" });

    const results = await runAutoSendSequenceSteps(5000);

    expect(results.t1.sent).toBe(70);
    expect(results.t1.throttled).toBe(1);
    expect(sentOrder).toHaveLength(71); // 70 sent + the one that hit the cap — nothing after it is tried
  });

  it("a pass that is already running is not overlapped", async () => {
    seed([draft("a")]);
    let release: () => void = () => {};
    sendBehavior = () => new Promise((resolve) => { release = () => resolve({ status: "sent", emailMessageId: "m" }); });

    const first = runAutoSendSequenceSteps(5000);
    await new Promise((r) => setTimeout(r, 20));
    expect(await runAutoSendSequenceSteps(5000)).toEqual({}); // second call while the first is mid-send
    release();
    await first;
    expect(sentOrder).toEqual(["a"]);
  });

  it("stops when the pass budget is used up, leaving the rest for the next pass", async () => {
    seed(Array.from({ length: 120 }, (_, i) => draft(`d${String(i).padStart(3, "0")}`)));
    const results = await runAutoSendSequenceSteps(0); // no time at all
    expect(results).toEqual({ t1: { sent: 0, throttled: 0, failed: 0, skipped: 0 } });
    expect(sentOrder).toHaveLength(0);
  });

  it("nothing due anywhere -> an empty result and nothing sent", async () => {
    seed([draft("future", { due_at: FUTURE })]);
    expect(await runAutoSendSequenceSteps(5000)).toEqual({});
  });
});
