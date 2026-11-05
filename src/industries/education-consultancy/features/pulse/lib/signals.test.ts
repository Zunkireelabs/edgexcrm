import { describe, it, expect } from "vitest";
import {
  MAX_KEY_CHANGES,
  MAX_NEEDS_YOU,
  activityDropSignals,
  biggestDropSignal,
  computeSignals,
  overCapacitySignals,
  sortSignals,
  stageLeakSignals,
  topMoverSignal,
  untouchedSignal,
} from "./signals";
import { DEFAULT_PULSE_THRESHOLDS as T, resolvePulseThresholds } from "./thresholds";
import { ZERO_COUNTS, type MetricCounts, type PersonRow, type Signal, type StageFlow } from "./types";

const counts = (o: Partial<MetricCounts> = {}): MetricCounts => ({ ...ZERO_COUNTS, ...o });
const person = (id: string, cur: Partial<MetricCounts>, usual: Partial<MetricCounts>): PersonRow => ({
  userId: id,
  name: `P-${id}`,
  email: null,
  positionSlug: null,
  positionName: null,
  positionKey: "none",
  positionLabel: "No position",
  branchId: null,
  branchName: null,
  current: counts(cur),
  previous: counts(),
  usual: counts(usual),
  notesNew: 0,
  notesEdited: 0,
  movesByStage: {},
  forwardByStage: {},
  backByStage: {},
  bulkMoves: 0,
  trend: [],
  flag: null,
});

describe("activity drop (<= 40% of usual AND usual >= 10)", () => {
  it("fires exactly at the 40% edge", () => {
    const s = activityDropSignals([person("a", { calls: 4 }, { calls: 10 })], T);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: "activity_drop", severity: "high", flag: "red", action: "reassign" });
    expect(s[0].surfaces).toEqual(["key_changes", "needs_you"]);
  });
  it("does not fire just above 40%", () => {
    expect(activityDropSignals([person("a", { calls: 4, notes: 1 }, { calls: 10 })], T)).toHaveLength(0); // 5/10 = 50%
    expect(activityDropSignals([person("a", { calls: 5 }, { calls: 12 })], T)).toHaveLength(0); // 5/12 = 41.7%
  });
  it("needs usual >= 10 (quiet people are noise)", () => {
    expect(activityDropSignals([person("a", {}, { calls: 9 })], T)).toHaveLength(0);
    expect(activityDropSignals([person("a", {}, { calls: 10 })], T)).toHaveLength(1);
  });
  it("sums calls + notes + moves", () => {
    const p = person("a", { calls: 1, notes: 1, moves: 1 }, { calls: 5, notes: 5, moves: 5 }); // 3/15
    expect(activityDropSignals([p], T)).toHaveLength(1);
  });
});

describe("untouched new leads", () => {
  it("fires on >0 and goes to Needs you only", () => {
    const s = untouchedSignal({ count: 3, byPerson: [] });
    expect(s).toHaveLength(1);
    expect(s[0].surfaces).toEqual(["needs_you"]);
    expect(s[0].title).toContain("3 new leads");
  });
  it("is silent at 0 and singular for 1", () => {
    expect(untouchedSignal({ count: 0, byPerson: [] })).toHaveLength(0);
    expect(untouchedSignal({ count: 1, byPerson: [] })[0].title).toContain("1 new lead untouched");
  });
});

describe("over capacity (>= 1.8x usual AND >= 20)", () => {
  it("fires at the edge", () => {
    expect(overCapacitySignals([person("a", { received: 36 }, { received: 20 })], T)).toHaveLength(1); // 1.8x exactly
  });
  it("not below 1.8x or below 20", () => {
    expect(overCapacitySignals([person("a", { received: 35 }, { received: 20 })], T)).toHaveLength(0);
    expect(overCapacitySignals([person("a", { received: 19 }, { received: 5 })], T)).toHaveLength(0);
  });
  it("is amber, never red", () => {
    const s = overCapacitySignals([person("a", { received: 40 }, { received: 10 })], T)[0];
    expect(s.flag).toBe("amber");
    expect(s.surfaces).toEqual(["key_changes", "needs_you"]);
  });
});

describe("stage leak (out >= 2x previous AND >= 10)", () => {
  const flow = (out: number, previousOut: number): StageFlow => ({
    listId: "s1", name: "Qualified", sortOrder: 2, base: 50, entered: 0, forward: 0, out, previousOut, series: [],
  });
  it("fires at the edge", () => {
    expect(stageLeakSignals([flow(10, 5)], T)).toHaveLength(1);
  });
  it("not at 9 leads, nor below 2x", () => {
    expect(stageLeakSignals([flow(9, 1)], T)).toHaveLength(0);
    expect(stageLeakSignals([flow(10, 6)], T)).toHaveLength(0);
  });
  it("fires when there was no previous leakage at all", () => {
    expect(stageLeakSignals([flow(12, 0)], T)).toHaveLength(1);
  });
});

describe("top mover", () => {
  it("picks the largest positive delta on reached_applications", () => {
    const s = topMoverSignal([
      person("a", { reached_applications: 5 }, { reached_applications: 3 }),
      person("b", { reached_applications: 9 }, { reached_applications: 4 }),
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].subject.id).toBe("b");
    expect(s[0].tone).toBe("good");
  });
  it("falls back to prospects only if nobody improved on applications", () => {
    const s = topMoverSignal([person("a", { reached_applications: 1, prospects: 7 }, { reached_applications: 3, prospects: 2 })]);
    expect(s[0].evidence.metric).toBe("prospects");
    const s2 = topMoverSignal([
      person("a", { reached_applications: 2, prospects: 20 }, { reached_applications: 1, prospects: 1 }),
    ]);
    expect(s2[0].evidence.metric).toBe("reached_applications");
  });
  it("is silent with no positive delta", () => {
    expect(topMoverSignal([person("a", { prospects: 1 }, { prospects: 5 })])).toHaveLength(0);
  });
});

describe("biggest drop by branch", () => {
  it("picks the most negative delta and ignores zero baselines", () => {
    const s = biggestDropSignal([
      { branchId: "b1", name: "Kathmandu", current: 5, usual: 10, metric: "reached_applications" },
      { branchId: "b2", name: "Pokhara", current: 1, usual: 20, metric: "reached_applications" },
      { branchId: "b3", name: "New", current: 0, usual: 0, metric: "reached_applications" },
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].subject.id).toBe("b2");
    expect(s[0].title).toContain("95%");
  });
  it("is silent when nothing fell", () => {
    expect(biggestDropSignal([{ branchId: "b", name: "x", current: 9, usual: 5, metric: "prospects" }])).toHaveLength(0);
  });
});

describe("ordering and caps", () => {
  const sig = (id: string, severity: Signal["severity"], magnitude: number, surfaces: Signal["surfaces"]): Signal => ({
    id, kind: "stage_leak", severity, title: id, detail: "", evidence: { metric: "m", value: 0, baseline: 0 },
    subject: { type: "team", id }, drill: { metric: "calls" }, surfaces, magnitude, tone: "neutral",
  });
  it("sorts by severity, then magnitude", () => {
    const sorted = sortSignals([sig("i", "info", 99, []), sig("m", "medium", 5, []), sig("h-small", "high", 1, []), sig("h-big", "high", 9, [])]);
    expect(sorted.map((s) => s.id)).toEqual(["h-big", "h-small", "m", "i"]);
  });
  it("caps Key changes and Needs you at 4 each", () => {
    expect(MAX_KEY_CHANGES).toBe(4);
    expect(MAX_NEEDS_YOU).toBe(4);
    const people = Array.from({ length: 7 }, (_, i) => person(`p${i}`, {}, { calls: 20 + i }));
    const out = computeSignals({ people, stageFlows: [], untouched: { count: 5, byPerson: [] }, branchKpis: [], thresholds: T });
    expect(out.keyChanges).toHaveLength(4);
    expect(out.needsYou).toHaveLength(4);
    // largest drop first
    expect(out.keyChanges[0].subject.id).toBe("p6");
  });
  it("red flag wins over amber on the same person", () => {
    const p = person("x", { received: 40 }, { received: 10, calls: 30 });
    const out = computeSignals({ people: [p], stageFlows: [], untouched: { count: 0, byPerson: [] }, branchKpis: [], thresholds: T });
    expect(out.flags).toEqual({ x: "red" });
  });
});

describe("Needs you is phrased as ACTIONS; Key changes stays observational (review round 1)", () => {
  it("an activity drop asks for a check-in, it does not restate the drop", () => {
    const [s] = activityDropSignals([person("a", { calls: 2 }, { calls: 20 })], T);
    expect(s.title).toContain("dropped");           // Key changes wording
    expect(s.needs?.title).toBe("Check in with P-a");
    expect(s.needs?.title).not.toBe(s.title);
    expect(s.needs?.detail).not.toMatch(/\b(his|her|him)\b/); // never guess pronouns
  });
  it("over capacity asks to spread the leads, and now also reaches Needs you", () => {
    const [s] = overCapacitySignals([person("b", { received: 104 }, { received: 28 })], T);
    expect(s.needs?.title).toBe("Spread P-b's 104 new leads");
    expect(s.surfaces).toContain("needs_you");
  });
  it("untouched asks to assign", () => {
    expect(untouchedSignal({ count: 37, byPerson: [] })[0].needs?.title).toBe("Assign the 37 untouched new leads");
  });
  it("no Needs-you item repeats its Key-changes text word for word", () => {
    const people = [person("a", { calls: 2 }, { calls: 20 }), person("b", { received: 104 }, { received: 28 })];
    const out = computeSignals({ people, stageFlows: [], untouched: { count: 5, byPerson: [] }, branchKpis: [], thresholds: T });
    for (const n of out.needsYou) expect(n.needs?.title).toBeDefined();
    for (const n of out.needsYou) for (const k of out.keyChanges) expect(n.needs?.title).not.toBe(k.title);
  });
});

describe("row flags", () => {
  it("top mover gets a green flag; red > amber > green on the same person", () => {
    const top = person("t", { reached_applications: 9 }, { reached_applications: 2 });
    expect(computeSignals({ people: [top], stageFlows: [], untouched: { count: 0, byPerson: [] }, branchKpis: [], thresholds: T }).flags).toEqual({ t: "green" });
    const both = person("x", { received: 40, reached_applications: 9 }, { received: 10, reached_applications: 1 });
    expect(computeSignals({ people: [both], stageFlows: [], untouched: { count: 0, byPerson: [] }, branchKpis: [], thresholds: T }).flags).toEqual({ x: "amber" });
  });
});

describe("thresholds config", () => {
  it("falls back to defaults and ignores junk", () => {
    expect(resolvePulseThresholds(null)).toEqual(T);
    const r = resolvePulseThresholds({ pulse_thresholds: { activity_drop_ratio: 0.5, over_capacity_min: -3 } } as never);
    expect(r.activityDropRatio).toBe(0.5);
    expect(r.overCapacityMin).toBe(T.overCapacityMin);
  });
});
