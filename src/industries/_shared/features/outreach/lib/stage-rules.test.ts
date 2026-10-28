import { describe, it, expect, vi, beforeEach } from "vitest";

// Managing a sequence's stage rules (migration 277): the linked stages become exactly what was asked for; a stage another
// ACTIVE sequence holds on the same channel is refused unless `replace` (nothing is taken silently); a leftover rule of an
// ARCHIVED sequence never blocks and is cleared; archive/unknown stages are rejected; bad input is rejected up front.
// In-memory fake database — nothing here touches a real one.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

let tables: Record<string, Row[]>;

vi.mock("./stage-auto-enroll", () => ({ enrollLeadsAlreadyInStage: vi.fn(async () => ({ leadsQueued: 0, capped: false })) }));
vi.mock("./bulk-enroll", () => ({ BULK_ENROLL_MAX_LEADS: 10_000 }));

function makeDb() {
  function from(table: string) {
    const rows = tables[table] ?? (tables[table] = []);
    const filter = () => {
      const eqs: Array<[string, unknown]> = [];
      const ins: Array<[string, unknown[]]> = [];
      return { eqs, ins, matches: (r: Row) => eqs.every(([k, v]) => r[k] === v) && ins.every(([k, vs]) => vs.includes(r[k])) };
    };
    return {
      select: () => {
        const f = filter();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = {
          eq: (c: string, v: unknown) => (f.eqs.push([c, v]), b),
          in: (c: string, vs: unknown[]) => (f.ins.push([c, vs]), b),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve({ data: rows.filter(f.matches), error: null }).then(resolve, reject),
        };
        return b;
      },
      insert: (payload: Row | Row[]) => {
        const list = Array.isArray(payload) ? payload : [payload];
        rows.push(...list.map((p, i) => ({ id: `${table}-${rows.length + i}`, ...p })));
        return Promise.resolve({ data: null, error: null });
      },
      delete: () => {
        const f = filter();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = {
          eq: (c: string, v: unknown) => (f.eqs.push([c, v]), b),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
            for (let i = rows.length - 1; i >= 0; i--) if (f.matches(rows[i])) rows.splice(i, 1);
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          },
        };
        return b;
      },
    };
  }
  return { from } as unknown as import("@/lib/supabase/scoped").ScopedClient;
}

import { parseStageIds, setSequenceStages, loadSequenceStages } from "./stage-rules";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const ARCHIVE = "44444444-4444-4444-4444-444444444444";

/** A rule row as the embed query returns it (names + sequence status come joined). */
const rule = (over: Row): Row => ({
  is_active: true,
  channel: "email",
  lead_lists: { name: "Stage", sort_order: 1 },
  email_sequences: { name: "Other sequence", status: "active" },
  ...over,
});

beforeEach(() => {
  tables = {
    lead_lists: [
      { id: A, is_archive: false },
      { id: B, is_archive: false },
      { id: C, is_archive: false },
      { id: ARCHIVE, is_archive: true },
    ],
    sequence_stage_triggers: [],
  };
});

describe("parseStageIds", () => {
  it("accepts a list of UUIDs and de-duplicates it", () => {
    expect(parseStageIds([A, B, A])).toEqual({ ok: true, listIds: [A, B] });
    expect(parseStageIds([])).toEqual({ ok: true, listIds: [] });
  });
  it("rejects a non-array, a non-UUID entry, and more than 20 stages", () => {
    expect(parseStageIds("nope").ok).toBe(false);
    expect(parseStageIds([A, "not-a-uuid"]).ok).toBe(false);
    expect(parseStageIds(Array.from({ length: 21 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`)).ok).toBe(false);
  });
});

describe("setSequenceStages", () => {
  const base = { sequenceId: "seq-1", channel: "email" as const, createdBy: "admin-1", replace: false };

  it("links new stages and records who set the rule up", async () => {
    const res = await setSequenceStages(makeDb(), { ...base, listIds: [A, B] });
    expect(res).toMatchObject({ ok: true, added: [A, B], removed: [] });
    expect(tables.sequence_stage_triggers.map((t) => [t.sequence_id, t.list_id, t.channel, t.created_by, t.is_active])).toEqual([
      ["seq-1", A, "email", "admin-1", true],
      ["seq-1", B, "email", "admin-1", true],
    ]);
  });

  it("makes the stages EXACTLY the list: unlinks the ones dropped, keeps the ones kept, adds the new", async () => {
    tables.sequence_stage_triggers = [rule({ sequence_id: "seq-1", list_id: A }), rule({ sequence_id: "seq-1", list_id: B })];
    const res = await setSequenceStages(makeDb(), { ...base, listIds: [B, C] });
    expect(res).toMatchObject({ ok: true, added: [C], removed: [A] });
    expect(tables.sequence_stage_triggers.map((t) => t.list_id).sort()).toEqual([B, C].sort());
  });

  it("an empty list switches auto-enroll off", async () => {
    tables.sequence_stage_triggers = [rule({ sequence_id: "seq-1", list_id: A })];
    const res = await setSequenceStages(makeDb(), { ...base, listIds: [] });
    expect(res).toMatchObject({ ok: true, removed: [A] });
    expect(tables.sequence_stage_triggers).toHaveLength(0);
  });

  it("refuses a stage another ACTIVE sequence holds on this channel — and changes nothing", async () => {
    tables.sequence_stage_triggers = [rule({ sequence_id: "seq-other", list_id: A, email_sequences: { name: "Qualified nudge", status: "active" } })];
    const res = await setSequenceStages(makeDb(), { ...base, listIds: [A, B] });
    expect(res).toMatchObject({
      ok: false,
      reason: "taken",
      taken: [{ listId: A, sequenceId: "seq-other", sequenceName: "Qualified nudge" }],
    });
    expect(tables.sequence_stage_triggers).toHaveLength(1); // untouched: B was NOT linked either
  });

  it("with replace: the other sequence loses the stage, this one gets it", async () => {
    tables.sequence_stage_triggers = [rule({ sequence_id: "seq-other", list_id: A })];
    const res = await setSequenceStages(makeDb(), { ...base, listIds: [A], replace: true });
    expect(res).toMatchObject({ ok: true, added: [A], replaced: [{ sequenceId: "seq-other" }] });
    expect(tables.sequence_stage_triggers.map((t) => [t.sequence_id, t.list_id])).toEqual([["seq-1", A]]);
  });

  it("the other channel never conflicts (a stage can have one email AND one SMS sequence)", async () => {
    tables.sequence_stage_triggers = [rule({ sequence_id: "seq-sms", list_id: A, channel: "sms" })];
    const res = await setSequenceStages(makeDb(), { ...base, listIds: [A] });
    expect(res.ok).toBe(true);
    expect(tables.sequence_stage_triggers).toHaveLength(2);
  });

  it("a leftover rule of an ARCHIVED sequence never blocks and is cleared", async () => {
    tables.sequence_stage_triggers = [rule({ sequence_id: "seq-old", list_id: A, email_sequences: { name: "Old", status: "archived" } })];
    const res = await setSequenceStages(makeDb(), { ...base, listIds: [A] });
    expect(res).toMatchObject({ ok: true, added: [A], replaced: [] });
    expect(tables.sequence_stage_triggers.map((t) => t.sequence_id)).toEqual(["seq-1"]);
  });

  it("rejects an archive stage and an unknown stage — and writes nothing", async () => {
    const res = await setSequenceStages(makeDb(), { ...base, listIds: [A, ARCHIVE, "99999999-9999-9999-9999-999999999999"] });
    expect(res).toMatchObject({ ok: false, reason: "invalid_stage", invalid: [ARCHIVE, "99999999-9999-9999-9999-999999999999"] });
    expect(tables.sequence_stage_triggers).toHaveLength(0);
  });
});

describe("loadSequenceStages", () => {
  it("returns the active stages with names, in stage order", async () => {
    tables.sequence_stage_triggers = [
      rule({ sequence_id: "seq-1", list_id: B, lead_lists: { name: "Prospects", sort_order: 20 } }),
      rule({ sequence_id: "seq-1", list_id: A, lead_lists: { name: "Qualified", sort_order: 10 } }),
      rule({ sequence_id: "seq-1", list_id: C, is_active: false }),
      rule({ sequence_id: "seq-2", list_id: C }),
    ];
    expect(await loadSequenceStages(makeDb(), "seq-1")).toEqual([
      { listId: A, listName: "Qualified" },
      { listId: B, listName: "Prospects" },
    ]);
  });
});
