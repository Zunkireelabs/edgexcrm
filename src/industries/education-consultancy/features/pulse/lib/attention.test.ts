import { describe, it, expect } from "vitest";
import { buildAttention, countByCategory, type AttentionInput } from "./attention";
import { leadsOfPersonHref } from "./leads-links";
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
  people, signals, stageFlows: [], leakReasons: {}, staleHeld: { a: 34 }, heldLoad: { a: 200, b: 100, d: 100 }, flags7d: { a: "red", b: "amber" },
  untouched: { count: 63, byBranch: [{ name: "Butwal", count: 41 }, { name: "Pokhara", count: 22 }], byRole: [{ key: "telecaller", label: "TeleCaller", count: 50 }] }, ...o,
});

describe("activity-drop row text", () => {
  it("says since which day when a clean stop day exists", () => {
    const withDay = people.map((p) => (p.userId === "a" ? { ...p, quietSinceDay: "2025-11-06" } : p));
    const a = buildAttention(input({ people: withDay })).find((i) => i.subject === "Asha")!;
    expect(a.what).toBe("activity down 77% since Thu");
  });
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
    expect(a.meta).toMatch(/Dipa holds 100 open leads now$/);
    expect(a.figure).toEqual({ strong: "34", text: " leads untouched" });
  });
  it("never invents a target: with nobody else in the role there is no 'to <name>'", () => {
    const solo = buildAttention(input({ people: [people[0]] })).find((i) => i.subject === "Asha")!;
    expect(solo.action?.label).toBe("Review 34 leads");
    expect(solo.meta).toMatch(/no TeleCaller has spare capacity$/);
    expect(solo.suggested).toBe(false);
  });
  it("untouched leads: branch share and a role target, both from the real tally", () => {
    const u = items.find((i) => i.id === "untouched_leads")!;
    expect(u.what).toBe("untouched for over 48 hours, 41 of them with Butwal");
    expect(u.action?.label).toBe("Review 63 leads"); // Dipa (100 held) can take at most +50
    expect(u.action?.href).toContain("/leads?list=pre-qualified");
    expect(u.action?.label).toMatch(/^(Assign \d+ (to|·)|Review \d+ leads)/);
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

describe("branch heads-up threshold", () => {
  it("a 5% branch change produces no attention item", () => {
    const sig = computeSignals({ people: [], stageFlows: [], untouched: { count: 0, byPerson: [] }, thresholds: T,
      branchKpis: [{ branchId: "k", name: "Kathmandu", metric: "prospects", current: 10, usual: 11, hasUsual: true }] }).all;
    expect(buildAttention({ people: [], signals: sig, stageFlows: [], leakReasons: {}, staleHeld: {}, untouched: { count: 0, byBranch: [], byRole: [] } })).toEqual([]);
  });
});

describe("the same fact reads the same on every surface", () => {
  it("34 vs a usual of 151: briefing 'at 23%' and attention 'down 77%' sum to 100", async () => {
    const { buildBriefing } = await import("./briefing");
    const { rollups } = await import("./rollup");
    const a = P("a", "Asha", { calls: 34 }, { calls: 151, prospects: 12 });
    a.previous = c({ prospects: 12 }); a.current = c({ calls: 34, prospects: 2 });
    const ppl = [a];
    const sig = computeSignals({ people: ppl, stageFlows: [], untouched: { count: 0, byPerson: [] }, branchKpis: [], thresholds: T }).all;
    const row = buildAttention({ people: ppl, signals: sig, stageFlows: [], leakReasons: {}, staleHeld: {}, untouched: { count: 0, byBranch: [], byRole: [] } }).find((i) => i.subject === "Asha")!;
    const down = Number(/down (\d+)%/.exec(row.what)![1]);
    const b = buildBriefing({ people: ppl, team: rollups(ppl).team, stageFlows: [], leakReasons: {}, untouched: { count: 5 }, thresholds: T })!;
    const at = Number(/at (\d+)% of usual/.exec(b.items[0].detail)![1]);
    expect(at + down).toBe(100);
  });
});

describe("reassign target safety (round 11)", () => {
  const row = (o: Partial<AttentionInput>) => buildAttention(input(o)).find((i) => i.subject === "Asha")!;
  const team = [...people, P("e", "Esha", { received: 10 }, { received: 10 }), P("f", "Fan", { received: 10 }, { received: 10 })];
  it("(a) picks by CURRENT held load, not window intake: Dipa received 20 but holds more than Esha", () => {
    const a = row({ people: team, heldLoad: { a: 200, b: 90, d: 100, e: 80, f: 120 }, flags7d: { b: "amber" } });
    expect(a.action?.label).toBe("Reassign 34 to Esha");
  });
  it("(b) never targets someone with an over-capacity or activity-drop signal in the 7d view, whatever the window", () => {
    const a = row({ people: team, heldLoad: { a: 200, b: 1, d: 500, e: 500, f: 500 }, flags7d: { b: "amber", d: "red" } });
    expect(a.action?.label).not.toContain("Binod");
    expect(a.action?.label).not.toContain("Dipa");
  });
  it("(c) never raises a target's held load by more than 50%: a one-person move needs held ≥ 2×n", () => {
    expect(row({ people: team, heldLoad: { a: 200, b: 0, d: 68, e: 0, f: 0 } }).action?.label).toBe("Reassign 34 to Dipa"); // exactly +50%
    expect(row({ people: team, heldLoad: { a: 200, b: 0, d: 67, e: 0, f: 0 } }).action?.label).toBe("Review 34 leads"); // +50.7% → refused
  });
  it("(c) splits across same-role people when one cannot absorb it", () => {
    const a = row({ people: team, staleHeld: { a: 60 }, heldLoad: { a: 200, b: 0, d: 80, e: 80, f: 0 } }); // caps 40 + 40
    expect(a.action?.label).toBe("Reassign 60 · split across 2 TeleCallers");
    expect(a.suggested).toBe(true);
  });
  it("(c) says Review with 'no TeleCaller has spare capacity' when nobody can take it", () => {
    const a = row({ people: team, heldLoad: { a: 200, b: 0, d: 20, e: 20, f: 20 } }); // caps 10 each = 30 < 34
    expect(a.action?.label).toBe("Review 34 leads");
    expect(a.meta).toMatch(/no TeleCaller has spare capacity$/);
    expect(a.suggested).toBe(false);
  });
});

describe("the seeded 7d story (round 12)", () => {
  const items = buildAttention(input());
  it("lists exactly Asha (drop), the 48h new-lead row, Binod (over capacity) as Needs action", () => {
    expect(items.filter((i) => i.category === "needs_action").map((i) => i.subject)).toEqual(["Asha", "63 new leads", "Binod"]);
  });
  it("there is no team-wide held-lead row (that neglect lives on the person rows)", () => {
    expect(items.some((i) => /held lead/.test(i.subject))).toBe(false);
  });
  it("every Needs-action button carries a value", () => {
    for (const i of items.filter((x) => x.category === "needs_action")) expect(i.action?.label).toMatch(/^(Reassign|Assign|Review) \d+/);
  });
  it("Binod's over-capacity button shows the plan and its why", () => {
    const b = items.find((i) => i.subject === "Binod")!;
    expect(b.action?.label).toBe("Review 104 leads"); // the set it opens: everything he received this window
    expect(b.why).toBe("76 more than usual this week. No TeleCaller has room to take them without their load rising over 50%.");
    expect(b.meta).toMatch(/no TeleCaller has spare capacity$/);
    expect(b.action?.drill).toEqual({ metric: "received", userId: "b" });
  });
  it("the 48h row names a plan: split across same-role people when one can't take it", () => {
    const t = [...people, P("e", "Esha", {}, {})];
    const u = buildAttention(input({ people: t, untouched: { count: 63, byBranch: [], byRole: [{ key: "telecaller", label: "TeleCaller", count: 50 }] }, heldLoad: { a: 200, b: 100, d: 80, e: 80 } })).find((i) => i.id === "untouched_leads")!;
    expect(u.action?.label).toBe("Assign 63 · split across 2 TeleCallers"); // caps 40 + 40
  });
});

describe("the number on a Needs-action button equals the leads its link opens (round 13)", () => {
  const items = buildAttention(input()).filter((i) => i.category === "needs_action");
  const n = (t: string) => Number(/\d+/.exec(t)![0]);
  it("every row's button number equals its 'See the N leads' link", () => {
    for (const i of items) {
      const see = i.links.find((l) => /^See the \d+ leads/.test(l.label));
      expect(see, i.subject).toBeDefined();
      expect(n(i.action!.label), i.subject).toBe(n(see!.label));
    }
  });
  it("the button opens the same set as that link", () => {
    for (const i of items) {
      const see = i.links.find((l) => /^See the \d+ leads/.test(l.label))!;
      if (i.action!.drill) expect(i.action!.drill).toEqual(see.drill);
      else expect(i.action!.href).toBe(see.href);
    }
  });
  it("Asha's set is her untouched held leads, not all her leads", () => {
    const a = items.find((i) => i.subject === "Asha")!;
    expect(a.action!.href).toContain("f=");
    expect(a.action!.href).not.toBe(leadsOfPersonHref("a"));
  });
});
