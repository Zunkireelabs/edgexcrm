import { describe, it, expect } from "vitest";
import { buildBriefing, recordCountOf, type BriefingInput } from "./briefing";
import { rollups } from "./rollup";
import { pickLightestLoad } from "./suggest";
import { DEFAULT_PULSE_THRESHOLDS as T } from "./thresholds";
import { normalizePosition } from "./positions";
import { ZERO_COUNTS, type LeakReason, type MetricCounts, type PersonRow, type StageFlow } from "./types";

const c = (o: Partial<MetricCounts> = {}): MetricCounts => ({ ...ZERO_COUNTS, ...o });
const P = (id: string, slug: string, branch: string | null, cur: Partial<MetricCounts>, prev: Partial<MetricCounts>, usual: Partial<MetricCounts>, flag: PersonRow["flag"] = null): PersonRow => {
  const { key, label } = normalizePosition(slug);
  return {
    userId: id, name: id, email: null, positionSlug: slug, positionName: label, positionKey: key, positionLabel: label,
    branchId: branch, branchName: branch, current: c(cur), previous: c(prev), usual: c(usual), notesNew: 0, notesEdited: 0,
    movesByStage: {}, forwardByStage: {}, backByStage: {}, bulkMoves: 0, trend: [], flag,
  };
};
const flow = (over: Partial<StageFlow> = {}): StageFlow => ({ listId: "q", name: "Qualified", sortOrder: 2, base: 50, entered: 0, forward: 0, out: 0, previousOut: 0, series: [], ...over });
const input = (people: PersonRow[], extra: Partial<BriefingInput> = {}): BriefingInput => ({
  people, team: rollups(people).team, stageFlows: [], leakReasons: {}, untouched: { count: 0 }, thresholds: T, ...extra,
});

describe("buildBriefing — each template, from real numbers only", () => {
  // Kathmandu collapses; Pokhara is fine. Team prospects 20 → 12 (−40%).
  const people = [
    P("Asha", "telecaller", "Kathmandu", { calls: 18, prospects: 2 }, { prospects: 12 }, { calls: 82, notes: 20, prospects: 12 }),
    P("Esha", "counselor", "Kathmandu", { prospects: 4, reached_applications: 9 }, { prospects: 4, reached_applications: 3 }, { prospects: 4, reached_applications: 5 }),
    P("Farhan", "counsellor", "Pokhara", { prospects: 6, reached_applications: 3 }, { prospects: 4, reached_applications: 3 }, { prospects: 4, reached_applications: 3 }),
  ];

  it("(a) the biggest negative move names the contributing branch and the person behind it", () => {
    const b = buildBriefing(input(people))!;
    const neg = b.items.find((i) => i.id === "neg")!;
    expect(neg.headline).toBe("Prospects fell 33%, and Kathmandu accounts for nearly all of it.");
    expect(neg.detail).toContain("Asha's activity is at");
    // Kathmandu fell 10 while Pokhara rose 2: the team's NET drop is 8, and the evidence must not claim "−10 of −8".
    expect(neg.evidence).toContain("Kathmandu −10 · team net −8");
    expect(neg.evidence).toContain("Asha 18 calls vs usual 82");
    expect(neg.link).toEqual({ label: "18 calls", drill: { metric: "calls", userId: "Asha" } });
  });
  it("(b) the top win is the person furthest above their OWN usual, with a drill to their records", () => {
    const win = buildBriefing(input(people))!.items.find((i) => i.id === "win")!;
    expect(win.headline).toContain("Esha delivered 9 of the 12 students to Applications");
    expect(win.headline).toContain("80% above their usual");
    expect(win.link.drill).toEqual({ metric: "reached_applications", userId: "Esha" });
  });
  it("(c) the biggest stage leak carries its top archive reason; without reasons it prints a count instead", () => {
    const reasons: Record<string, LeakReason[]> = { q: [{ reason: "Not reachable", leads: 8 }, { reason: "Not interested", leads: 2 }] };
    const withR = buildBriefing(input(people, { stageFlows: [flow({ out: 15, previousOut: 5 })], leakReasons: reasons }))!.items.find((i) => i.id === "leak")!;
    expect(withR.headline).toBe("More leads are leaving Qualified: 15 this period, up from 5.");
    expect(withR.detail).toBe('The top reason is "Not reachable".');
    expect(withR.evidence).toContain("Not reachable 8 · Not interested 2");
    const noR = buildBriefing(input(people, { stageFlows: [flow({ out: 15, previousOut: 5 })] }))!.items.find((i) => i.id === "leak")!;
    expect(noR.detail).toBe("");
    expect(noR.evidence).toBe("15 of the 50 leads that were in Qualified moved back or were archived");
  });
  it("skips lines whose data it does not have (no negative move, no win, no leak → no item)", () => {
    const flat = [P("A", "counsellor", "K", { prospects: 5 }, { prospects: 5 }, { prospects: 5 })];
    expect(buildBriefing(input(flat))).toBeNull();
  });
  it("a leak that is not rising is not reported", () => {
    const b = buildBriefing(input(people, { stageFlows: [flow({ out: 15, previousOut: 20 })] }))!;
    expect(b.items.find((i) => i.id === "leak")).toBeUndefined();
  });
  it("returns at most 3 items", () => {
    expect(buildBriefing(input(people, { stageFlows: [flow({ out: 15, previousOut: 5 })] }))!.items.length).toBeLessThanOrEqual(3);
  });
});

describe("Orca's read", () => {
  const people = [
    P("Asha", "telecaller", "Kathmandu", { calls: 18, prospects: 2 }, { prospects: 12 }, { calls: 82, notes: 20, prospects: 12 }),
    P("Esha", "counsellor", "Kathmandu", { reached_applications: 9 }, { reached_applications: 3 }, { reached_applications: 5 }),
  ];
  it("is composed from the signals: 2–3 sentences, each a fact from the items", () => {
    const b = buildBriefing(input(people, { untouched: { count: 63 }, stageFlows: [flow({ out: 15, previousOut: 5 })] }))!;
    expect(b.read).toContain("Prospects fell");
    expect(b.read).toContain("63 new leads have waited over 48 hours");
    expect(b.read!.split(/(?<=\.)\s/).length).toBeLessThanOrEqual(3);
  });
  it("is omitted with fewer than 2 meaningful signals", () => {
    const one = [P("Esha", "counsellor", "K", { reached_applications: 9 }, { reached_applications: 3 }, { reached_applications: 5 })];
    const b = buildBriefing(input(one))!; // only the win exists
    expect(b.items).toHaveLength(1);
    expect(b.read).toBeNull();
  });
  it("two signals are enough", () => {
    const b = buildBriefing(input(people, { untouched: { count: 4 } }))!;
    expect(b.read).not.toBeNull();
  });
  it("never guesses pronouns", () => {
    const b = buildBriefing(input(people, { untouched: { count: 63 }, stageFlows: [flow({ out: 15, previousOut: 5 })] }))!;
    const all = [b.read, ...b.items.flatMap((i) => [i.headline, i.detail, i.evidence])].join(" ");
    expect(all).not.toMatch(/\b(he|she|his|her|him)\b/i);
  });
});

describe("provenance", () => {
  it("counts the real activity records behind the numbers", () => {
    expect(recordCountOf(c({ calls: 10, notes: 5, moves: 3, back_archived: 1, status_changes: 2, received: 4, applications_filed: 1 }))).toBe(26);
  });
});

describe("pickLightestLoad — the suggestion target", () => {
  const a = P("Asha", "telecaller", "K", { received: 33 }, {}, {}, "red");
  const people = [a, P("Binod", "telecaller", "P", { received: 104 }, {}, {}), P("Dipa", "telecaller", "P", { received: 20 }, {}, {}), P("Esha", "counsellor", "K", { received: 1 }, {}, {})];
  it("is the same-role person with the fewest new leads, never the subject or another role", () => {
    expect(pickLightestLoad(people, a)?.userId).toBe("Dipa");
  });
  it("skips people who are themselves flagged red", () => {
    const flagged = people.map((p) => (p.userId === "Dipa" ? { ...p, flag: "red" as const } : p));
    expect(pickLightestLoad(flagged, a)?.userId).toBe("Binod");
  });
  it("is null when nobody else holds the role (so no target is ever invented)", () => {
    expect(pickLightestLoad([a], a)).toBeNull();
    expect(pickLightestLoad([a, people[3]], a)).toBeNull();
  });
  it("breaks ties on name so the pick is stable", () => {
    const tie = [a, P("Zed", "telecaller", null, { received: 5 }, {}, {}), P("Amy", "telecaller", null, { received: 5 }, {}, {})];
    expect(pickLightestLoad(tie, a)?.userId).toBe("Amy");
  });
});
