import { describe, it, expect } from "vitest";
import { assemblePeople } from "./assemble";
import type { PersonBucketRow, PersonInfo } from "./types";

const info = (id: string): PersonInfo => ({ userId: id, name: id, email: null, positionSlug: "telecaller", positionName: "TeleCaller", positionKey: "telecaller", positionLabel: "TeleCaller", branchId: null, branchName: null });
const row = (user_id: string, bucket: number, calls: number, extra: Partial<PersonBucketRow> = {}): PersonBucketRow => ({
  user_id, bucket, counts: { calls }, notes_new: 0, notes_edited: 0, moves_by_stage: {}, back_by_stage: {}, bulk_moves: 0, ...extra,
});

describe("assemblePeople", () => {
  it("bucket 0 is current, bucket 1 previous, usual = mean of buckets 1..4", () => {
    const [p] = assemblePeople([info("a")], [row("a", 0, 10), row("a", 1, 8), row("a", 2, 4), row("a", 3, 0), row("a", 4, 4)]);
    expect(p.current.calls).toBe(10);
    expect(p.previous.calls).toBe(8);
    expect(p.usual.calls).toBe(4); // (8+4+0+4)/4
  });
  it("a missing bucket counts as zero in the usual mean (a quiet week is data, not a gap)", () => {
    const [p] = assemblePeople([info("a")], [row("a", 0, 5), row("a", 1, 8)]);
    expect(p.usual.calls).toBe(2); // 8/4
  });
  it("people with no rows still appear, all zero (a collapsed person must not vanish)", () => {
    const [p] = assemblePeople([info("ghost")], []);
    expect(p.current.calls).toBe(0);
    expect(p.trend).toEqual([0, 0, 0, 0, 0]);
  });
  it("trend runs oldest usual window → current window", () => {
    const [p] = assemblePeople([info("a")], [row("a", 0, 1), row("a", 1, 2), row("a", 2, 3), row("a", 3, 4), row("a", 4, 5)]);
    expect(p.trend).toEqual([5, 4, 3, 2, 1]);
  });
  it("does not leak another person's rows", () => {
    const [a] = assemblePeople([info("a")], [row("b", 0, 99)]);
    expect(a.current.calls).toBe(0);
  });
  it("carries notes split, stage breakdown and the bulk tally for the current window only", () => {
    const [p] = assemblePeople([info("a")], [
      row("a", 0, 1, { notes_new: 3, notes_edited: 1, moves_by_stage: { s1: 2 }, bulk_moves: 7 }),
      row("a", 1, 1, { notes_new: 50, bulk_moves: 50 }),
    ]);
    expect([p.notesNew, p.notesEdited, p.movesByStage, p.bulkMoves]).toEqual([3, 1, { s1: 2 }, 7]);
  });
});

describe("per-destination-stage series (forward and back kept apart)", () => {
  it("current / previous / usual per stage, missing buckets count as 0", () => {
    const [p] = assemblePeople([info("a")], [
      row("a", 0, 0, { moves_by_stage: { S1: 6 }, back_by_stage: { ARCH: 2 } }),
      row("a", 1, 0, { moves_by_stage: { S1: 4 }, back_by_stage: { ARCH: 1 } }),
      row("a", 2, 0, { moves_by_stage: { S1: 8 } }),
    ]);
    expect(p.forwardByStage.S1).toEqual({ current: 6, previous: 4, usual: 3 }); // (4+8+0+0)/4
    expect(p.backByStage.ARCH).toEqual({ current: 2, previous: 1, usual: 0.25 });
  });
  it("forward and back never leak into each other", () => {
    const [p] = assemblePeople([info("a")], [row("a", 0, 0, { moves_by_stage: { S1: 1 }, back_by_stage: { S2: 9 } })]);
    expect(Object.keys(p.forwardByStage)).toEqual(["S1"]);
    expect(Object.keys(p.backByStage)).toEqual(["S2"]);
  });
});

describe("assemblePeople — coverage-aware usual", () => {
  const DAY = 86_400_000;
  const now = new Date("2026-11-05T12:00:00Z").getTime();
  const rowsAll = [row("a", 0, 120), row("a", 1, 100, { counts: { calls: 100, received: 35 } }), row("a", 2, 0), row("a", 3, 0), row("a", 4, 0)];
  const cov = (days: number, win: number) => ({ windowFrom: new Date(now - win * DAY), lenMs: win * DAY, tenantFirst: new Date(now - days * DAY) });

  it("a tenant with 34 days of history at 30d: no usual, no previous baseline, zero deltas possible", async () => {
    const { computeSignals } = await import("./signals");
    const { DEFAULT_PULSE_THRESHOLDS: T } = await import("./thresholds");
    const [p] = assemblePeople([info("a")], rowsAll, 4, cov(34, 30));
    expect(p.hasUsual).toBe(false);
    expect(p.previousCovered).toBe(false);
    expect(p.usual.calls).toBe(0);
    expect(p.usual.received).toBe(0);
    const out = computeSignals({ people: [{ ...p, current: { ...p.current, received: 35 } }], stageFlows: [], untouched: { count: 0, byPerson: [] }, branchKpis: [], thresholds: T });
    expect(out.all).toEqual([]);
    expect(out.flags).toEqual({});
  });
  it("the same tenant at 7d has a usual again, from covered windows only", () => {
    const [p] = assemblePeople([info("a")], [row("a", 0, 10), row("a", 1, 8), row("a", 2, 4), row("a", 3, 6), row("a", 4, 0)], 4, cov(34, 7));
    expect(p.hasUsual).toBe(true);
    expect(p.usual.calls).toBe(6); // windows 1..3 covered: (8+4+6)/3; the empty 4th (before the data) is NOT a zero
    expect(p.previousCovered).toBe(true);
  });
  it("a new hire with 1 covered window has none", () => {
    const [p] = assemblePeople([{ ...info("n"), joinedAt: new Date(now - 15 * DAY).toISOString() }], [row("n", 0, 10), row("n", 1, 8)], 4, cov(100, 7));
    expect(p.hasUsual).toBe(false);
    expect(p.usual.calls).toBe(0);
  });
  it("no coverage info (old callers / tests) keeps the old behaviour", () => {
    const [p] = assemblePeople([info("a")], [row("a", 0, 5), row("a", 1, 8)]);
    expect(p.hasUsual).toBe(true);
    expect(p.usual.calls).toBe(2);
  });
});

describe("assemblePeople — the seeded story at 7d keeps its signals (accounts created today, activity for 35 days)", () => {
  const DAY = 86_400_000;
  const now = new Date("2026-11-05T12:00:00Z").getTime();
  const seeded = (id: string, slug: string): PersonInfo => ({ ...info(id), positionSlug: slug, positionKey: slug === "counselor" ? "counsellor" : slug, positionLabel: slug, joinedAt: new Date(now).toISOString(), firstActivityAt: new Date(now - 35 * DAY).toISOString() });
  const cov7 = { windowFrom: new Date(now - 7 * DAY), lenMs: 7 * DAY, tenantFirst: new Date(now - 35 * DAY) };
  it("(c) activity-down, over-capacity and the % above usual all come back", async () => {
    const { computeSignals } = await import("./signals");
    const { DEFAULT_PULSE_THRESHOLDS: T } = await import("./thresholds");
    const { buildBriefing } = await import("./briefing");
    const { rollups } = await import("./rollup");
    const rows = [
      ...[0, 1, 2, 3, 4].map((b) => row("asha", b, b === 0 ? 18 : 82)),
      ...[0, 1, 2, 3, 4].map((b) => row("binod", b, 80, { counts: { calls: 80, received: b === 0 ? 104 : 28 } })),
      ...[0, 1, 2, 3, 4].map((b) => row("esha", b, 20, { counts: { calls: 20, reached_applications: b === 0 ? 9 : 6 } })),
    ];
    const people = assemblePeople([seeded("asha", "telecaller"), seeded("binod", "telecaller"), seeded("esha", "counselor")], rows, 4, cov7);
    for (const p of people) expect(p.hasUsual).toBe(true);
    const sig = computeSignals({ people, stageFlows: [], untouched: { count: 0, byPerson: [] }, branchKpis: [], thresholds: T, baselineCovered: true });
    expect(sig.all.map((s) => s.kind)).toEqual(expect.arrayContaining(["activity_drop", "over_capacity", "top_mover"]));
    const b = buildBriefing({ people, team: rollups(people).team, stageFlows: [], leakReasons: {}, untouched: { count: 0 }, thresholds: T, baselineCovered: true })!;
    expect(b.items.find((i) => i.id === "win")!.headline).toContain("50% above their usual");
  });
  it("(d) the 30d honesty rules still hold for the same people", () => {
    const cov30 = { windowFrom: new Date(now - 30 * DAY), lenMs: 30 * DAY, tenantFirst: new Date(now - 35 * DAY) };
    const people = assemblePeople([seeded("asha", "telecaller")], [row("asha", 0, 90), row("asha", 1, 20)], 4, cov30);
    expect(people[0].hasUsual).toBe(false);
    expect(people[0].previousCovered).toBe(false);
    expect(people[0].usual.calls).toBe(0);
  });
});
