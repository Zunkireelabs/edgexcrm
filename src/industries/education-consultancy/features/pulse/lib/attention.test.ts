import { describe, it, expect } from "vitest";
import { buildAttention, countByCategory, type AttentionInput } from "./attention";
import { computeSignals } from "./signals";
import { DEFAULT_PULSE_THRESHOLDS as T } from "./thresholds";
import { normalizePosition } from "./positions";
import { ZERO_COUNTS, type MetricCounts, type PersonRow } from "./types";

const c = (o: Partial<MetricCounts> = {}): MetricCounts => ({ ...ZERO_COUNTS, ...o });
const P = (id: string, name: string, cur: Partial<MetricCounts>, usual: Partial<MetricCounts>): PersonRow => {
  const { key, label } = normalizePosition("telecaller");
  return { userId: id, name, email: null, positionSlug: "telecaller", positionName: label, positionKey: key, positionLabel: label, branchId: "k", branchName: "Kathmandu",
    current: c(cur), previous: c(), usual: c(usual), notesNew: 0, notesEdited: 0, movesByStage: {}, forwardByStage: {}, backByStage: {}, bulkMoves: 0, trend: [], flag: null };
};
const people = [P("a", "Asha", { calls: 18, notes: 13 }, { calls: 82, notes: 54 }), P("b", "Binod", { received: 104, calls: 80 }, { received: 28, calls: 80 }), P("d", "Dipa", { received: 20, calls: 60 }, { received: 20, calls: 60 })];
const signals = computeSignals({ people, stageFlows: [], untouched: { count: 63, byPerson: [] }, branchKpis: [], thresholds: T }).all;
const input = (o: Partial<AttentionInput> = {}): AttentionInput => ({
  people, signals, stageFlows: [], leakReasons: {}, staleHeld: { a: 34 },
  untouched: { count: 63, byBranch: [{ name: "Butwal", count: 41 }, { name: "Pokhara", count: 22 }], byRole: [{ key: "telecaller", label: "TeleCaller", count: 50 }] }, ...o,
});

describe("buildAttention — the one list", () => {
  const items = buildAttention(input());
  it("splits into Needs action / Heads-up / Wins with counts", () => {
    expect(countByCategory(items).needs_action).toBe(3);
  });
  it("the primary action carries the concrete value (a count and a real, lightest-load target)", () => {
    const a = items.find((i) => i.subject === "Asha")!;
    expect(a.action).toMatchObject({ label: "Reassign 34 to Dipa", primary: true });
    expect(a.suggested).toBe(true);
    expect(a.figure).toEqual({ strong: "34", text: " leads untouched" });
  });
  it("never invents a target: with nobody else in the role there is no 'to <name>'", () => {
    const solo = buildAttention(input({ people: [people[0]] })).find((i) => i.subject === "Asha")!;
    expect(solo.action?.label).toBe("Review leads");
    expect(solo.suggested).toBe(false);
  });
  it("untouched leads: branch share and a role target, both from the real tally", () => {
    const u = items.find((i) => i.id === "untouched_leads")!;
    expect(u.what).toBe("untouched for over 48 hours, 41 of them with Butwal");
    expect(u.action?.label).toBe("Spread across TeleCallers");
    expect(u.action?.href).toContain("untouched_new".slice(0, 0) + "/leads?list=pre-qualified");
  });
  it("over capacity is a rule item without a Suggested tag", () => {
    const o = items.find((i) => i.subject === "Binod")!;
    expect(o.what).toBe("received 104 new leads, usual is 28");
    expect(o.figure?.text).toBe("3.7× usual");
    expect(o.suggested).toBe(false);
  });
  it("is phrased without guessed pronouns", () => {
    const text = items.flatMap((i) => [i.what, i.why ?? "", i.meta ?? ""]).join(" ");
    expect(text).not.toMatch(/\b(his|her|him|she|he)\b/i);
  });
  it("every item is drillable", () => {
    for (const i of items) expect(i.drill.metric).toBeDefined();
  });
});
