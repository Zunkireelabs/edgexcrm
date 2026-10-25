import { describe, it, expect, vi, beforeEach } from "vitest";

// Stage auto-enroll (migration 277). Pins the product rules: entering a linked stage saves ONE run per rule for the
// eligible leads only (opted-out and already-auto-enrolled leads are left out); email and SMS rules are independent; the
// run uses the QUEUE conflict policy and is tagged 'stage_rule'; leaving a stage stops only rule-started enrollments that
// are no longer linked (a person's enrollments are never touched, a sequence covering several stages keeps going); with
// no rules nothing happens; a failure never escapes the Safe wrapper. Nothing here touches a database.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

let tables: Record<string, Row[]>;
let unenrollCalls: Array<{ id: string; opts: unknown }>;
let kicked: string[];
let idSeq: number;

vi.mock("./engine", () => ({
  unenrollLead: async (_db: unknown, id: string, opts: unknown) => {
    unenrollCalls.push({ id, opts });
  },
}));
vi.mock("./bulk-enroll-runner", () => ({
  processBulkEnrollRun: async (_tenantId: string, runId: string) => {
    kicked.push(runId);
  },
}));
vi.mock("next/server", () => ({
  after: (fn: () => Promise<void>) => {
    void fn();
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

function makeDb() {
  function from(table: string) {
    const rows = tables[table] ?? (tables[table] = []);
    const filters = () => {
      const eqs: Array<[string, unknown]> = [];
      const ins: Array<[string, unknown[]]> = [];
      return { eqs, ins, matches: (r: Row) => eqs.every(([k, v]) => r[k] === v) && ins.every(([k, vs]) => vs.includes(r[k])) };
    };
    return {
      select: () => {
        const f = filters();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = {
          eq: (c: string, v: unknown) => (f.eqs.push([c, v]), b),
          in: (c: string, vs: unknown[]) => (f.ins.push([c, vs]), b),
          maybeSingle: async () => ({ data: rows.filter(f.matches)[0] ?? null, error: null }),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve({ data: rows.filter(f.matches), error: null }).then(resolve, reject),
        };
        return b;
      },
      insert: (payload: Row | Row[]) => {
        const list = (Array.isArray(payload) ? payload : [payload]).map((p) => ({ id: `${table}-${++idSeq}`, ...p }));
        rows.push(...list);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = {
          select: () => b,
          single: async () => ({ data: list[0], error: null }),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve({ data: list, error: null }).then(resolve, reject),
        };
        return b;
      },
      update: (patch: Row) => {
        const f = filters();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = {
          eq: (c: string, v: unknown) => (f.eqs.push([c, v]), b),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
            rows.filter(f.matches).forEach((r) => Object.assign(r, patch));
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          },
        };
        return b;
      },
    };
  }
  return { from };
}

vi.mock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: async () => makeDb() }));

import { onLeadsEnteredStage, onLeadsEnteredStageSafe } from "./stage-auto-enroll";

const T = "tenant-1";
const QUALIFIED = "list-qualified";
const PROSPECTS = "list-prospects";
const APPLICATIONS = "list-applications";

const trigger = (over: Row = {}): Row => ({
  sequence_id: "seq-email",
  list_id: QUALIFIED,
  channel: "email",
  created_by: "admin-1",
  is_active: true,
  ...over,
});

beforeEach(() => {
  tables = {
    email_sequences: [
      { id: "seq-email", status: "active" },
      { id: "seq-sms", status: "active" },
      { id: "seq-archived", status: "archived" },
    ],
  };
  unenrollCalls = [];
  kicked = [];
  idSeq = 0;
});

describe("entering a linked stage", () => {
  it("saves one queued 'stage_rule' run with the QUEUE policy and one pending item per lead, then kicks the worker", async () => {
    tables.sequence_stage_triggers = [trigger()];
    const res = await onLeadsEnteredStage({ tenantId: T, leadIds: ["a", "b"], fromListId: null, toListId: QUALIFIED });

    expect(res).toMatchObject({ runsCreated: 1, leadsQueued: 2, stopped: 0 });
    const run = tables.sequence_bulk_enrollments[0];
    expect(run).toMatchObject({
      sequence_id: "seq-email",
      created_by: "admin-1",
      conflict_policy: "queue",
      status: "queued",
      trigger_kind: "stage_rule",
      trigger_list_id: QUALIFIED,
      total_count: 2,
    });
    expect(tables.sequence_bulk_enrollment_items.map((i) => [i.run_id, i.lead_id, i.outcome])).toEqual([
      [run.id, "a", "pending"],
      [run.id, "b", "pending"],
    ]);
    expect(kicked).toEqual([run.id]);
  });

  it("does nothing when the stage has no rule — and when no rules exist at all", async () => {
    tables.sequence_stage_triggers = [trigger({ list_id: PROSPECTS })];
    expect(await onLeadsEnteredStage({ tenantId: T, leadIds: ["a"], fromListId: null, toListId: QUALIFIED })).toEqual({
      stopped: 0,
      queuedCancelled: 0,
      runsCreated: 0,
      leadsQueued: 0,
    });
    tables.sequence_stage_triggers = [];
    await onLeadsEnteredStage({ tenantId: T, leadIds: ["a"], fromListId: PROSPECTS, toListId: QUALIFIED });
    expect(tables.sequence_bulk_enrollments ?? []).toHaveLength(0);
  });

  it("ignores an inactive rule and an archived sequence", async () => {
    tables.sequence_stage_triggers = [trigger({ is_active: false }), trigger({ sequence_id: "seq-archived", channel: "sms" })];
    const res = await onLeadsEnteredStage({ tenantId: T, leadIds: ["a"], fromListId: null, toListId: QUALIFIED });
    expect(res.runsCreated).toBe(0);
  });

  it("leaves out opted-out leads (per channel) and leads already auto-enrolled into this sequence once", async () => {
    tables.sequence_stage_triggers = [trigger()];
    tables.lead_auto_enroll_optouts = [
      { lead_id: "optout-email", channel: "email" },
      { lead_id: "optout-sms-only", channel: "sms" },
    ];
    tables.sequence_enrollments = [
      { id: "old", lead_id: "again", sequence_id: "seq-email", source: "stage_rule", status: "completed" },
      { id: "manual", lead_id: "manual-before", sequence_id: "seq-email", source: "manual", status: "completed" },
    ];
    const res = await onLeadsEnteredStage({
      tenantId: T,
      leadIds: ["new", "optout-email", "optout-sms-only", "again", "manual-before"],
      fromListId: PROSPECTS,
      toListId: QUALIFIED,
    });
    // opt-out is per channel (the SMS-only opt-out does not block email); a MANUAL earlier enrollment does not count as "auto once"
    expect(tables.sequence_bulk_enrollment_items.map((i) => i.lead_id).sort()).toEqual(["manual-before", "new", "optout-sms-only"]);
    expect(res.leadsQueued).toBe(3);
  });

  it("evaluates email and SMS rules independently (two runs, each on its own channel's opt-outs)", async () => {
    tables.sequence_stage_triggers = [trigger(), trigger({ sequence_id: "seq-sms", channel: "sms" })];
    tables.lead_auto_enroll_optouts = [{ lead_id: "b", channel: "sms" }];
    const res = await onLeadsEnteredStage({ tenantId: T, leadIds: ["a", "b"], fromListId: null, toListId: QUALIFIED });
    expect(res).toMatchObject({ runsCreated: 2, leadsQueued: 3 });
    const smsRun = tables.sequence_bulk_enrollments.find((r) => r.sequence_id === "seq-sms")!;
    expect(tables.sequence_bulk_enrollment_items.filter((i) => i.run_id === smsRun.id).map((i) => i.lead_id)).toEqual(["a"]);
  });

  it("skips a no-op move (same stage) and an empty list", async () => {
    tables.sequence_stage_triggers = [trigger()];
    expect((await onLeadsEnteredStage({ tenantId: T, leadIds: ["a"], fromListId: QUALIFIED, toListId: QUALIFIED })).runsCreated).toBe(0);
    expect((await onLeadsEnteredStage({ tenantId: T, leadIds: [], fromListId: null, toListId: QUALIFIED })).runsCreated).toBe(0);
  });
});

describe("leaving a stage", () => {
  const running = (over: Row = {}): Row => ({
    id: "enr-1",
    lead_id: "a",
    sequence_id: "seq-email",
    channel: "email",
    source: "stage_rule",
    status: "active",
    ...over,
  });

  it("stops a rule-started enrollment whose sequence isn't linked to the new stage, with reason 'stage_left'", async () => {
    tables.sequence_stage_triggers = [trigger()]; // linked to Qualified only
    tables.sequence_enrollments = [running()];
    const res = await onLeadsEnteredStage({ tenantId: T, leadIds: ["a"], fromListId: QUALIFIED, toListId: APPLICATIONS });
    expect(res.stopped).toBe(1);
    // no new rule on email for Applications → the person's queued sequence (if any) may move on
    expect(unenrollCalls).toEqual([{ id: "enr-1", opts: { stopReason: "stage_left", promoteQueue: true } }]);
  });

  it("never touches manual or bulk enrollments", async () => {
    tables.sequence_stage_triggers = [trigger()];
    tables.sequence_enrollments = [running({ id: "m", source: "manual" }), running({ id: "b", source: "bulk" })];
    const res = await onLeadsEnteredStage({ tenantId: T, leadIds: ["a"], fromListId: QUALIFIED, toListId: APPLICATIONS });
    expect(res.stopped).toBe(0);
    expect(unenrollCalls).toEqual([]);
  });

  it("keeps a sequence that is also linked to the new stage (a rule may cover several stages)", async () => {
    tables.sequence_stage_triggers = [trigger(), trigger({ list_id: PROSPECTS })]; // same sequence on both stages
    tables.sequence_enrollments = [running()];
    const res = await onLeadsEnteredStage({ tenantId: T, leadIds: ["a"], fromListId: QUALIFIED, toListId: PROSPECTS });
    expect(res.stopped).toBe(0);
    expect(unenrollCalls).toEqual([]);
    // …and the lead is not enrolled a second time: it was already auto-enrolled into this sequence
    expect(tables.sequence_bulk_enrollments ?? []).toHaveLength(0);
  });

  it("stops the old one and starts the new stage's sequence, without promoting a manual queue in between", async () => {
    tables.sequence_stage_triggers = [trigger(), trigger({ sequence_id: "seq-next", list_id: APPLICATIONS })];
    tables.email_sequences.push({ id: "seq-next", status: "active" });
    tables.sequence_enrollments = [running()];
    const res = await onLeadsEnteredStage({ tenantId: T, leadIds: ["a"], fromListId: QUALIFIED, toListId: APPLICATIONS });
    expect(res).toMatchObject({ stopped: 1, runsCreated: 1 });
    expect(unenrollCalls[0].opts).toEqual({ stopReason: "stage_left", promoteQueue: false });
    expect(tables.sequence_bulk_enrollments[0].sequence_id).toBe("seq-next");
  });

  it("stops everything when the lead is taken out of every stage (toListId null)", async () => {
    tables.sequence_stage_triggers = [trigger()];
    tables.sequence_enrollments = [running(), running({ id: "enr-2", channel: "sms", sequence_id: "seq-sms" })];
    const res = await onLeadsEnteredStage({ tenantId: T, leadIds: ["a"], fromListId: QUALIFIED, toListId: null });
    expect(res.stopped).toBe(2);
  });

  it("only looks for things to stop when the lead had a stage before (a brand-new lead has nothing)", async () => {
    tables.sequence_stage_triggers = [trigger()];
    tables.sequence_enrollments = [running()];
    const res = await onLeadsEnteredStage({ tenantId: T, leadIds: ["a"], fromListId: null, toListId: APPLICATIONS });
    expect(res.stopped).toBe(0);
  });
});

describe("a sequence parked behind a person's sequence", () => {
  it("is cancelled when the lead leaves the stage — but only if a RULE parked it", async () => {
    tables.sequence_stage_triggers = [trigger()];
    tables.sequence_bulk_enrollments = [
      { id: "run-rule", trigger_kind: "stage_rule" },
      { id: "run-person", trigger_kind: "manual" },
    ];
    tables.sequence_enrollment_queue = [
      { id: "q-rule", lead_id: "a", sequence_id: "seq-email", run_id: "run-rule", status: "waiting" },
      { id: "q-person-bulk", lead_id: "b", sequence_id: "seq-email", run_id: "run-person", status: "waiting" },
      { id: "q-person-hand", lead_id: "c", sequence_id: "seq-email", run_id: null, status: "waiting" },
    ];
    const res = await onLeadsEnteredStage({ tenantId: T, leadIds: ["a", "b", "c"], fromListId: QUALIFIED, toListId: APPLICATIONS });
    expect(res.queuedCancelled).toBe(1);
    const status = Object.fromEntries(tables.sequence_enrollment_queue.map((q) => [q.id, q.status]));
    expect(status).toEqual({ "q-rule": "cancelled", "q-person-bulk": "waiting", "q-person-hand": "waiting" });
  });

  it("stays parked when the sequence is still linked to the stage the lead moved to", async () => {
    tables.sequence_stage_triggers = [trigger(), trigger({ list_id: PROSPECTS })];
    tables.sequence_bulk_enrollments = [{ id: "run-rule", trigger_kind: "stage_rule" }];
    tables.sequence_enrollment_queue = [{ id: "q-rule", lead_id: "a", sequence_id: "seq-email", run_id: "run-rule", status: "waiting" }];
    const res = await onLeadsEnteredStage({ tenantId: T, leadIds: ["a"], fromListId: QUALIFIED, toListId: PROSPECTS });
    expect(res.queuedCancelled).toBe(0);
    expect(tables.sequence_enrollment_queue[0].status).toBe("waiting");
  });
});

describe("failure handling", () => {
  it("the Safe wrapper swallows an error (a stage move must never fail because of auto-enroll)", async () => {
    tables.sequence_stage_triggers = [trigger()];
    const original = tables.sequence_stage_triggers;
    Object.defineProperty(tables, "sequence_bulk_enrollments", {
      get() {
        throw new Error("boom");
      },
      configurable: true,
    });
    const res = await onLeadsEnteredStageSafe({ tenantId: T, leadIds: ["a"], fromListId: null, toListId: QUALIFIED });
    expect(res).toEqual({ stopped: 0, queuedCancelled: 0, runsCreated: 0, leadsQueued: 0 });
    expect(original).toHaveLength(1);
  });
});
