import { describe, expect, it } from "vitest";
import { buildAttention, type AttentionInput } from "./attention";
import { normalizePosition } from "./positions";
import { computeSignals } from "./signals";
import { DEFAULT_PULSE_THRESHOLDS as T } from "./thresholds";
import { ZERO_COUNTS, type MetricCounts, type PersonRow, type StageFlow } from "./types";

// Click-through round 5, O: the rarer Pulse rows read properly at 1.
const c = (o: Partial<MetricCounts> = {}): MetricCounts => ({ ...ZERO_COUNTS, ...o });
const P = (id: string, name: string, cur: Partial<MetricCounts>, usual: Partial<MetricCounts>): PersonRow => {
  const { key, label } = normalizePosition("telecaller");
  return { userId: id, name, email: null, positionSlug: "telecaller", positionName: label, positionKey: key, positionLabel: label, branchId: "k", branchName: "Kathmandu",
    current: c(cur), previous: c(), usual: c(usual), notesNew: 0, notesEdited: 0, movesByStage: {}, forwardByStage: {}, backByStage: {}, bulkMoves: 0, trend: [], flag: null };
};
const asha = P("a", "Asha", { calls: 18, notes: 13 }, { calls: 82, notes: 54 });
const base = (o: Partial<AttentionInput>): AttentionInput => ({ people: [asha], signals: [], stageFlows: [], leakReasons: {}, staleHeld: {}, heldLoad: {}, flags7d: {}, untouched: { count: 0, listIds: [], byBranch: [], byRole: [] }, ...o });
const flow = (out: number) => ({ listId: "L", name: "Qualified", sortOrder: 1, base: 10, entered: 0, forward: 0, out, previousOut: 0 }) as StageFlow;
const leak = { id: "leak", kind: "stage_leak", subject: { id: "L" }, drill: {} } as unknown as AttentionInput["signals"][number];
const mover = (value: number) => ({ id: "top", kind: "top_mover", subject: { id: "a" }, evidence: { value, baseline: 0, metric: "prospects" }, detail: "", drill: {} }) as unknown as AttentionInput["signals"][number];

describe("stage leak", () => {
  const item = (out: number, covered?: boolean) => buildAttention(base({ signals: [leak], stageFlows: [flow(out)], baselineCovered: covered }))[0];
  it("at 1", () => {
    expect(item(1).what).toBe("1 lead moved back or archived, up from 0");
    expect(item(1, false).what).toBe("1 lead moved back or archived");
    expect(item(1).links[0].label).toBe("See the 1 lead →");
  });
  it("at 2", () => {
    expect(item(2).what).toBe("2 leads moved back or archived, up from 0");
    expect(item(2, false).what).toBe("2 leads moved back or archived");
    expect(item(2).links[0].label).toBe("See the 2 leads →");
  });
});

describe("top mover", () => {
  const item = (n: number) => buildAttention(base({ signals: [mover(n)] }))[0];
  it("at 1", () => expect(item(1).what).toBe("delivered 1 lead to Prospects"));
  it("at 2", () => expect(item(2).what).toBe("delivered 2 leads to Prospects"));
});

describe("the person why", () => {
  const signals = computeSignals({ people: [asha], stageFlows: [], untouched: { count: 0, byPerson: [] }, branchKpis: [], thresholds: T }).all;
  const why = (n: number) => buildAttention(base({ signals, staleHeld: { a: n }, heldLoad: { a: 100 } })).find((i) => i.subject === "Asha")!.why;
  it("at 1", () => expect(why(1)).toContain("1 of the leads Asha holds has had no touch or move in 3+ days."));
  it("at 2", () => expect(why(2)).toContain("2 of the leads Asha holds have had no touch or move in 3+ days."));
});
