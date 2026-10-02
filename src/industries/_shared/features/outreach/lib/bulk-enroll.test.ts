import { describe, it, expect, vi, beforeEach } from "vitest";

// Bulk enroll planning (OUTREACH-BULK-ENROLL-BRIEF.md §3-§4): body parsing, the per-lead plan (enroll vs skip +
// reason), the preview numbers, the cap estimate, the run/items it saves, and the skipped CSV.

const resolveAudienceMock = vi.fn();
const resolveAudienceForLeadIdsMock = vi.fn();
vi.mock("@/lib/email/outbound/audience", () => ({
  resolveAudience: (...a: unknown[]) => resolveAudienceMock(...a),
  resolveAudienceForLeadIds: (...a: unknown[]) => resolveAudienceForLeadIdsMock(...a),
}));
vi.mock("@/lib/email/outbound/cap", () => ({
  getDailyCapStatus: async () => ({ dailyCap: 2000, sentToday: 500, remaining: 1500 }),
}));
vi.mock("@/lib/email/outbound/flag", () => ({
  isBulkEmailEnabledForTenant: async () => true,
  isEmailOutboundSandbox: () => false,
}));

import {
  BULK_ENROLL_MAX_LEADS,
  createBulkEnrollRun,
  estimateExtraDays,
  parseBulkBody,
  planBulkEnroll,
  requestCancel,
  skippedItemsToCsv,
} from "./bulk-enroll";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const SEQ = "33333333-3333-4333-8333-333333333333";

function row(id: string, first = "A") {
  return { leadId: id, email: `${id}@x.com`, lead: { first_name: first, last_name: "Lead" } };
}

/** Fake db: sequence_enrollments (for the already-in-sequence lookup) + the two bulk tables. */
function makeDb(inSequence: string[] = []) {
  const tables: Record<string, Row[]> = {
    sequence_enrollments: inSequence.map((lead_id) => ({ lead_id, status: "active" })),
    sequence_bulk_enrollments: [],
    sequence_bulk_enrollment_items: [],
  };
  const db = {
    from(table: string) {
      const rows = tables[table];
      return {
        select: () => {
          const ins: Array<[string, unknown[]]> = [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const b: any = {
            in(c: string, vs: unknown[]) {
              ins.push([c, vs]);
              return b;
            },
            then(resolve: (v: unknown) => void) {
              resolve({ data: rows.filter((r) => ins.every(([c, vs]) => vs.includes(r[c]) || c === "status")), error: null });
            },
          };
          return b;
        },
        insert: (payload: Row | Row[]) => {
          const list = Array.isArray(payload) ? payload : [payload];
          const created = list.map((p, i) => ({ id: `${table}-${rows.length + i + 1}`, ...p }));
          rows.push(...created);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const b: any = {
            select: () => b,
            single: async () => ({ data: created[0], error: null }),
            then(resolve: (v: unknown) => void) {
              resolve({ data: null, error: null });
            },
          };
          return b;
        },
        update: (patch: Row) => {
          const eqs: Array<[string, unknown]> = [];
          const ins: Array<[string, unknown[]]> = [];
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
            select() {
              return b;
            },
            then(resolve: (v: unknown) => void) {
              const hit = rows.filter((r) => eqs.every(([c, v]) => r[c] === v) && ins.every(([c, vs]) => vs.includes(r[c])));
              hit.forEach((r) => Object.assign(r, patch));
              resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
            },
          };
          return b;
        },
      };
    },
  };
  return { db: db as never, tables };
}

const AUTH = { userId: "u1", tenantId: "t1", industryId: "education_consultancy" } as never;

beforeEach(() => {
  resolveAudienceMock.mockReset();
  resolveAudienceForLeadIdsMock.mockReset();
});

describe("parseBulkBody", () => {
  it("accepts selected rows and a filter tree", () => {
    const sel = parseBulkBody({ sequence_id: SEQ, source: { mode: "selected", lead_ids: [UUID_A, UUID_B] } });
    expect(sel).toEqual({ ok: true, sequenceId: SEQ, source: { mode: "selected", leadIds: [UUID_A, UUID_B] } });

    const tree = { id: "root", conjunction: "and", conditions: [] };
    const flt = parseBulkBody({ sequence_id: SEQ, source: { mode: "filter", tree } });
    expect(flt.ok).toBe(true);
  });

  it("rejects a bad sequence id, empty / malformed / oversized id lists, an unknown mode and a bad tree", () => {
    expect(parseBulkBody({ sequence_id: "nope", source: { mode: "selected", lead_ids: [UUID_A] } }).ok).toBe(false);
    expect(parseBulkBody({ sequence_id: SEQ, source: { mode: "selected", lead_ids: [] } }).ok).toBe(false);
    expect(parseBulkBody({ sequence_id: SEQ, source: { mode: "selected", lead_ids: ["x"] } }).ok).toBe(false);
    const tooMany = Array.from({ length: BULK_ENROLL_MAX_LEADS + 1 }, () => UUID_A);
    expect(parseBulkBody({ sequence_id: SEQ, source: { mode: "selected", lead_ids: tooMany } }).ok).toBe(false);
    expect(parseBulkBody({ sequence_id: SEQ, source: { mode: "everyone" } }).ok).toBe(false);
    expect(parseBulkBody({ sequence_id: SEQ, source: { mode: "filter", tree: { nope: 1 } } }).ok).toBe(false);
    expect(parseBulkBody({ sequence_id: SEQ }).ok).toBe(false);
  });
});

describe("estimateExtraDays", () => {
  it("is 0 when everything fits in what is left today", () => {
    expect(estimateExtraDays(1500, 1500, 2000)).toBe(0);
    expect(estimateExtraDays(10, 1500, 2000)).toBe(0);
  });
  it("counts the extra full days beyond today's remaining room", () => {
    expect(estimateExtraDays(5000, 1500, 2000)).toBe(2); // 1500 today + 2000 + 1500 more
    expect(estimateExtraDays(3501, 1500, 2000)).toBe(2);
    expect(estimateExtraDays(3500, 1500, 2000)).toBe(1);
    expect(estimateExtraDays(100, 0, 2000)).toBe(1);
  });
});

describe("planBulkEnroll", () => {
  it("selected rows: enroll vs skip per lead, with reasons, and counts for ids that were not visible", async () => {
    resolveAudienceForLeadIdsMock.mockResolvedValue({
      requested: 6,
      audience: {
        matched: 5, // 1 of the 6 ids isn't visible to the caller
        sendable: [row("l1", "Sita"), row("l2"), row("l3")],
        suppressed: [row("l4")],
        excluded: { noEmail: 1, malformed: 0, suppressed: 1, duplicate: 0 },
        excludedRows: [{ leadId: "l5", reason: "noEmail" }],
      },
    });
    const { db } = makeDb(["l2"]); // l2 already has a running enrollment

    const planned = await planBulkEnroll(AUTH, { mode: "selected", leadIds: ["l1", "l2", "l3", "l4", "l5", "l6"] }, { db } as never);

    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const { preview, items } = planned.plan;
    expect(preview).toMatchObject({
      matched: 5,
      notVisible: 1,
      willEnroll: 2,
      overLimit: false,
      sandbox: false,
      sendingEnabled: true,
      sampleNames: ["Sita Lead", "A Lead"],
      cap: { dailyCap: 2000, sentToday: 500, remaining: 1500 },
      estimatedExtraDays: 0,
    });
    expect(preview.skipped).toEqual({ noEmail: 1, malformedEmail: 0, duplicateEmail: 0, suppressed: 1, alreadyInSequence: 1 });
    expect(items).toEqual([
      { leadId: "l1", outcome: "pending", reason: null },
      { leadId: "l2", outcome: "skipped", reason: "already_in_sequence" },
      { leadId: "l3", outcome: "pending", reason: null },
      { leadId: "l4", outcome: "skipped", reason: "suppressed" },
      { leadId: "l5", outcome: "skipped", reason: "no_email" },
    ]);
    expect(resolveAudienceMock).not.toHaveBeenCalled();
  });

  it("filter mode resolves through resolveAudience and maps its duplicateEmail key", async () => {
    resolveAudienceMock.mockResolvedValue({
      ok: true,
      audience: {
        matched: 3,
        sendable: [row("l1")],
        suppressed: [],
        excluded: { noEmail: 0, malformed: 1, suppressed: 0, duplicateEmail: 1 },
        excludedRows: [
          { leadId: "l2", reason: "malformed" },
          { leadId: "l3", reason: "duplicate" },
        ],
      },
    });
    const { db } = makeDb();
    const tree = { id: "root", conjunction: "and", conditions: [] };

    const planned = await planBulkEnroll(AUTH, { mode: "filter", tree } as never, { db } as never);

    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.preview.skipped).toMatchObject({ malformedEmail: 1, duplicateEmail: 1 });
    expect(planned.plan.items.map((i) => i.reason)).toEqual([null, "malformed_email", "duplicate_email"]);
  });

  it("flags a run over the per-run limit, and a filter that fails validation comes back as errors", async () => {
    const many = Array.from({ length: BULK_ENROLL_MAX_LEADS + 1 }, (_, i) => row(`l${i}`));
    resolveAudienceForLeadIdsMock.mockResolvedValue({
      requested: many.length,
      audience: { matched: many.length, sendable: many, suppressed: [], excluded: { noEmail: 0, malformed: 0, suppressed: 0, duplicate: 0 }, excludedRows: [] },
    });
    const { db } = makeDb();
    const planned = await planBulkEnroll(AUTH, { mode: "selected", leadIds: ["x"] }, { db } as never);
    expect(planned.ok && planned.plan.preview.overLimit).toBe(true);

    resolveAudienceMock.mockResolvedValue({ ok: false, errors: { f: ["bad"] } });
    const bad = await planBulkEnroll(AUTH, { mode: "filter", tree: {} } as never, { db } as never);
    expect(bad).toEqual({ ok: false, errors: { f: ["bad"] } });
  });
});

describe("createBulkEnrollRun / requestCancel", () => {
  it("saves the run (counts, snapshot) and one item per lead, queued for the worker", async () => {
    const { db, tables } = makeDb();
    const plan = {
      preview: { willEnroll: 2 } as never,
      items: [
        { leadId: "l1", outcome: "pending" as const, reason: null },
        { leadId: "l2", outcome: "pending" as const, reason: null },
        { leadId: "l3", outcome: "skipped" as const, reason: "no_email" as const },
      ],
    };

    const runId = await createBulkEnrollRun(db, AUTH, { sequenceId: SEQ, source: { mode: "selected", leadIds: ["l1", "l2", "l3"] }, conflictPolicy: "skip", plan });

    expect(tables.sequence_bulk_enrollments).toHaveLength(1);
    expect(tables.sequence_bulk_enrollments[0]).toMatchObject({
      id: runId, sequence_id: SEQ, created_by: "u1", source_mode: "selected", source_snapshot: { lead_ids: 3 }, status: "queued", total_count: 2, skipped_count: 1,
    });
    expect(tables.sequence_bulk_enrollment_items.map((i) => [i.lead_id, i.outcome, i.reason])).toEqual([
      ["l1", "pending", null],
      ["l2", "pending", null],
      ["l3", "skipped", "no_email"],
    ]);
    expect(tables.sequence_bulk_enrollment_items.every((i) => i.run_id === runId)).toBe(true);
    expect(tables.sequence_bulk_enrollment_items[2].processed_at).toEqual(expect.any(String));
  });

  it("requestCancel only flips a queued / running run", async () => {
    const { db, tables } = makeDb();
    tables.sequence_bulk_enrollments.push({ id: "r1", status: "running", cancel_requested: false }, { id: "r2", status: "completed", cancel_requested: false });

    expect(await requestCancel(db, "r1")).toBe(true);
    expect(await requestCancel(db, "r2")).toBe(false);
    expect(tables.sequence_bulk_enrollments.map((r) => r.cancel_requested)).toEqual([true, false]);
  });
});

describe("skippedItemsToCsv", () => {
  it("lists only skipped / failed leads, with reasons, and escapes commas and quotes", () => {
    const csv = skippedItemsToCsv([
      { lead_id: "l1", outcome: "enrolled", reason: null },
      { lead_id: "l2", outcome: "skipped", reason: "no_email" },
      { lead_id: "l3", outcome: "failed", reason: 'bad, "quoted" thing' },
    ]);
    expect(csv).toBe('lead_id,reason\nl2,no_email\nl3,"failed: bad, ""quoted"" thing"\n');
  });
});
