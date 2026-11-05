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
    expect(neg.headline).toBe("Prospects fell 40%, and Kathmandu accounts for nearly all of it.");
    expect(neg.detail).toContain("Asha's activity is at");
    // Kathmandu fell 10 while Pokhara rose 2: the team's NET drop is 8, and the evidence must not claim "−10 of −8".
    expect(neg.evidence).toContain("Kathmandu (vs last week) −10 · team net −8");
    expect(neg.evidence).toContain("Asha 18 calls vs usual 82");
    expect(neg.link).toEqual({ label: "18 calls", drill: { metric: "calls", userId: "Asha" } });
  });
  it("(b) the top win is the person furthest above their OWN usual, with a drill to their records", () => {
    const win = buildBriefing(input(people))!.items.find((i) => i.id === "win")!;
    expect(win.headline).toContain("Esha delivered 9 of the 12 students to Applications");
    expect(win.headline).toContain(", 80% above their usual");
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
    expect(b.read).toContain("Asha has gone quiet"); // exactly two causes: the fall and the next-strongest, so untouched waits its turn
    expect(b.read!.split(/(?<=\.)\s/).length).toBeLessThanOrEqual(3);
  });
  it("synthesizes: direction → facts with places/people → fix; no 5-word run is shared with any item headline", () => {
    const b = buildBriefing(input(people, { untouched: { count: 63 }, stageFlows: [flow({ out: 15, previousOut: 5 })], newLeads: { current: 120, previous: 60 } }))!;
    expect(b.read).toMatch(/^Applications are up sharply, but fewer leads are moving forward\./);
    expect(b.read).toContain("Prospects fell 83%, mostly in Kathmandu, and Asha has gone quiet");
    expect(b.read).toContain("Fix those two");
    const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9% ]/g, " ").split(/\s+/).filter(Boolean);
    const grams = (t: string) => { const w = words(t); const out = new Set<string>(); for (let i = 0; i + 5 <= w.length; i++) out.add(w.slice(i, i + 5).join(" ")); return out; };
    const head = new Set(b.items.flatMap((i) => [...grams(i.headline)]));
    for (const g of grams(b.read!)) expect(head.has(g)).toBe(false);
  });
  it("sentence 3's number word matches the causes in sentence 2 (two causes → 'those two', one → 'that')", () => {
    const two = buildBriefing(input(people, { untouched: { count: 63 }, stageFlows: [flow({ out: 15, previousOut: 5 })] }))!.read!.split(/(?<=\.)\s+/);
    expect(two[two.length - 2].split(", and ")).toHaveLength(2);
    expect(two[two.length - 1]).toMatch(/^Fix those two /);
    const flatApps = [P("Asha", "telecaller", "Kathmandu", { calls: 18, prospects: 12 }, { prospects: 12 }, { calls: 18, prospects: 12 })];
    const one = buildBriefing(input(flatApps, { untouched: { count: 5 }, stageFlows: [] }));
    // a single cause (untouched) plus no other signal is below the 2-signal bar, so no read at all
    expect(one?.read ?? null).toBeNull();
    const oneCause = [P("Esha", "counsellor", "K", { reached_applications: 9 }, { reached_applications: 3 }, { reached_applications: 5 })];
    const r = buildBriefing(input(oneCause, { untouched: { count: 5 } }))!.read!.split(/(?<=\.)\s+/);
    expect(r[r.length - 1]).toMatch(/^Fix that and /);
    expect(r[r.length - 2].split(", and ")).toHaveLength(1);
  });
  it("with no positive move, sentence 1 states the negative trend plainly", () => {
    const flatApps = [P("Asha", "telecaller", "Kathmandu", { calls: 18, prospects: 2 }, { prospects: 12 }, { calls: 82, prospects: 12 })];
    const b = buildBriefing(input(flatApps, { untouched: { count: 5 } }))!;
    expect(b.read).toMatch(/^Fewer leads are moving forward than last week\./);
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
  it("skips people who are over capacity (amber): never hand work to someone already overloaded", () => {
    const loaded = people.map((p) => (p.userId === "Dipa" ? { ...p, flag: "amber" as const } : p));
    expect(pickLightestLoad(loaded, a)?.userId).toBe("Binod");
    const allLoaded = people.map((p) => (p.userId === "Binod" || p.userId === "Dipa" ? { ...p, flag: "amber" as const } : p));
    expect(pickLightestLoad(allLoaded, a)).toBeNull();
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
