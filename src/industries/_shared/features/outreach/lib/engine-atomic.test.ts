import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// engine.ts after the review findings on PR #604 (migration 265):
//  - a draft is stamped with the sequence's steps_version its step was read at; if the steps were edited meanwhile the
//    database refuses it (STEPS_CHANGED) and the engine re-reads the step and rebuilds — a bounded number of times;
//  - switchEnrollment ends the old enrollment and starts the new one in ONE database call, so a refused switch changes
//    nothing. (The real database behaviour is pinned in sequence-concurrency.db.test.ts.)

const { emitEvent } = vi.hoisted(() => ({ emitEvent: vi.fn() }));
vi.mock("@/lib/api/audit", () => ({ emitEvent }));
vi.mock("@/lib/ai/flag", () => ({ isOutreachDraftEnabledForTenant: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/ai/draft-email", () => ({ draftSequenceEmail: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { enrollLead, switchEnrollment, EnrollmentConflictError } from "./engine";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

let tables: Record<string, Row[]>;
let draftAttempts: Row[];
let onDraftInsert: ((attempt: number) => { message: string } | null) | null;
let rpcCalls: Array<{ fn: string; args: Row }>;
let rpcResult: { data: unknown; error: { code?: string; message: string } | null };

function makeDb() {
  const table = (name: string) => {
    const rows = tables[name] ?? (tables[name] = []);
    return {
      select: () => {
        const eqs: Array<[string, unknown]> = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = {
          eq(c: string, v: unknown) {
            eqs.push([c, v]);
            return b;
          },
          maybeSingle: async () => ({ data: rows.find((r) => eqs.every(([c, v]) => r[c] === v)) ?? null, error: null }),
          single: async () => {
            const r = rows.find((x) => eqs.every(([c, v]) => x[c] === v));
            return r ? { data: r, error: null } : { data: null, error: { message: "not found" } };
          },
          then(resolve: (v: unknown) => void) {
            resolve({ data: rows.filter((r) => eqs.every(([c, v]) => r[c] === v)), error: null });
          },
        };
        return b;
      },
      insert: (payload: Row) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = {
          select: () => b,
          single: async () => {
            if (name === "sequence_step_drafts") {
              draftAttempts.push(payload);
              const failure = onDraftInsert?.(draftAttempts.length);
              if (failure) return { data: null, error: failure };
            }
            const row = { id: `${name}-${rows.length + 1}`, ...payload };
            rows.push(row);
            return { data: row, error: null };
          },
        };
        return b;
      },
    };
  };
  return {
    from: table,
    fromGlobal: table,
    rpc: async (fn: string, args: Row) => {
      rpcCalls.push({ fn, args });
      return rpcResult;
    },
  };
}

const stepRow = (over: Row = {}) => ({
  id: "step-1", tenant_id: "t1", sequence_id: "seq-1", step_order: 1, delay_days: 0, channel: "email", draft_source: "template",
  subject_template: "Hello", body_template: "<p>Hi</p>", ai_instructions: null, send_time: null,
  email_sequences: { steps_version: 3 },
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T03:00:00Z"));
  emitEvent.mockReset().mockResolvedValue(null);
  draftAttempts = [];
  onDraftInsert = null;
  rpcCalls = [];
  rpcResult = { data: "enr-new", error: null };
  tables = {
    email_sequence_steps: [stepRow()],
    email_sequences: [{ id: "seq-1", name: "Welcome", description: null, send_window: null }],
    leads: [{ id: "lead-1", first_name: "Sita", last_name: "Rai", email: "s@x.com", phone: null, city: null, country: null, custom_fields: null }],
    tenants: [{ id: "t1", name: "Admizz", timezone: "Asia/Kathmandu" }],
    sequence_enrollments: [{ id: "enr-new", tenant_id: "t1", sequence_id: "seq-1", lead_id: "lead-1", assigned_to: "u1", status: "active" }],
    sequence_step_drafts: [],
  };
});
afterEach(() => vi.useRealTimers());

const AUTH = { tenantId: "t1", userId: "u1" } as never;
const params = { sequenceId: "seq-1", leadId: "lead-1", assignedTo: "u1", enrolledBy: "u1" };
const enroll = () => enrollLead(makeDb() as never, AUTH, params);

describe("a draft is stamped with the steps version it was built from", () => {
  it("stamps the version read together with the step", async () => {
    await enroll();
    expect(draftAttempts).toHaveLength(1);
    expect(draftAttempts[0].steps_version).toBe(3);
  });

  it("an old-style step row with no version is not stamped (the database does not check it)", async () => {
    tables.email_sequence_steps = [stepRow({ email_sequences: undefined })];
    await enroll();
    expect(draftAttempts[0].steps_version).toBeNull();
  });
});

describe("steps edited while a draft is being built", () => {
  it("re-reads the step and rebuilds the draft from the NEW step (new wait, new version)", async () => {
    onDraftInsert = (attempt) => {
      if (attempt > 1) return null;
      // the edit lands between our read and our insert
      Object.assign(tables.email_sequence_steps[0], { delay_days: 5, email_sequences: { steps_version: 4 } });
      return { message: "STEPS_CHANGED" };
    };

    await enroll();

    expect(draftAttempts).toHaveLength(2);
    expect(draftAttempts[0].steps_version).toBe(3);
    expect(draftAttempts[1].steps_version).toBe(4);
    // due 5 days from "now" (no send window), not 0
    expect(draftAttempts[1].due_at).toBe("2026-10-12T03:00:00.000Z");
    expect(tables.sequence_step_drafts).toHaveLength(1); // the refused one was never saved
  });

  it("gives up after 3 attempts instead of looping forever", async () => {
    onDraftInsert = () => ({ message: "STEPS_CHANGED" });
    await enroll();
    expect(draftAttempts).toHaveLength(3);
    expect(tables.sequence_step_drafts).toHaveLength(0);
  });

  it("if the step was removed meanwhile there is nothing to draft, and it stops", async () => {
    onDraftInsert = () => {
      tables.email_sequence_steps = [];
      return { message: "STEPS_CHANGED" };
    };
    await enroll();
    expect(draftAttempts).toHaveLength(1);
  });

  it("any other insert error is not retried", async () => {
    onDraftInsert = () => ({ message: "something else" });
    await enroll();
    expect(draftAttempts).toHaveLength(1);
  });
});

describe("switchEnrollment — one database call", () => {
  const sw = () => switchEnrollment(makeDb() as never, AUTH, { oldEnrollmentId: "enr-old", ...params });

  it("hands the old enrollment and the target to switch_lead_enrollment, then creates the step-1 draft and announces it", async () => {
    const row = await sw();

    expect(rpcCalls).toEqual([
      { fn: "switch_lead_enrollment", args: { p_lead_id: "lead-1", p_old_enrollment_id: "enr-old", p_sequence_id: "seq-1", p_assigned_to: "u1", p_enrolled_by: "u1" } },
    ]);
    expect(row.id).toBe("enr-new");
    expect(draftAttempts).toHaveLength(1);
    expect(draftAttempts[0]).toMatchObject({ enrollment_id: "enr-new", lead_id: "lead-1", step_order: 1, steps_version: 3 });
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "sequence.enrolled", entityId: "enr-new" }));
  });

  it("a refused switch (unique violation) is an EnrollmentConflictError and creates nothing", async () => {
    rpcResult = { data: null, error: { code: "23505", message: "duplicate key" } };
    await expect(sw()).rejects.toBeInstanceOf(EnrollmentConflictError);
    expect(draftAttempts).toHaveLength(0);
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it("any other database error is thrown, not swallowed", async () => {
    rpcResult = { data: null, error: { message: "boom" } };
    await expect(sw()).rejects.toThrow(/Failed to switch enrollment/);
    expect(draftAttempts).toHaveLength(0);
  });

  it("a target sequence with no step 1 is refused before touching the database", async () => {
    tables.email_sequence_steps = [];
    await expect(sw()).rejects.toThrow(/no step 1/);
    expect(rpcCalls).toHaveLength(0);
  });
});
