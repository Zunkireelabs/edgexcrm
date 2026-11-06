import { describe, it, expect } from "vitest";
import { activityWhat, buildAttention, type AttentionInput } from "./attention";
import { buildBriefing, type BriefingInput } from "./briefing";
import { changeVsUsual } from "./compare";
import { untouchedHeldOfPersonHref } from "./leads-links";
import { coachingNote } from "./notes";
import { personTiles } from "./person-tiles";
import { normalizePosition } from "./positions";
import { rollups } from "./rollup";
import { NA_ROLES, sumVisible } from "./scoreboard-cols";
import { computeSignals } from "./signals";
import { DEFAULT_PULSE_THRESHOLDS as T } from "./thresholds";
import { ZERO_COUNTS, type MetricCounts, type PersonRow } from "./types";

const c = (o: Partial<MetricCounts> = {}): MetricCounts => ({ ...ZERO_COUNTS, ...o });
const P = (id: string, name: string, slug: string, branch: string | null, cur: Partial<MetricCounts>, usual: Partial<MetricCounts>, prev: Partial<MetricCounts> = {}): PersonRow => {
  const { key, label } = normalizePosition(slug);
  return { userId: id, name, email: null, positionSlug: slug, positionName: label, positionKey: key, positionLabel: label, branchId: branch, branchName: branch,
    current: c(cur), previous: c(prev), usual: c(usual), notesNew: 0, notesEdited: 0, movesByStage: {}, forwardByStage: {}, backByStage: {}, bulkMoves: 0, trend: [], flag: null };
};

describe("G1/G2: one guard for the scoreboard, the drawer tiles and the coaching note", () => {
  const esha = P("e", "Esha Thapa", "counsellor", "Kathmandu", { reached_applications: 18, calls: 50, notes: 36 }, { reached_applications: 5.5, calls: 46, notes: 31 });
  it("changeVsUsual: uses the PRINTED usual, hides < 25%, tones a rise", () => {
    expect(changeVsUsual(18, 5.5)?.text).toBe("+200%");
    expect(changeVsUsual(50, 46)).toBeNull();
    expect(changeVsUsual(36, 31)).toBeNull();
    expect(changeVsUsual(5, 0)).toBeNull();
    expect(changeVsUsual(9, 6, true, "warn")?.cls).toBe("am");
    expect(changeVsUsual(9, 6, true, "bad")?.cls).toBe("dn");
    expect(changeVsUsual(9, 6)?.cls).toBe("up");
    expect(changeVsUsual(2, 6)?.cls).toBe("dn");
  });
  it("drawer tiles: Esha To Apps is +200% vs 6; Calls and Notes show no delta", () => {
    const shown = personTiles(esha, 0).map((t) => ({ label: t.label, d: t.usual != null ? changeVsUsual(t.value, t.usual)?.text ?? null : null }));
    expect(shown.find((s) => s.label === "To Apps")?.d).toBe("+200%");
    expect(shown.find((s) => s.label === "Calls")?.d).toBeNull();
    expect(shown.find((s) => s.label === "Notes")?.d).toBeNull();
  });
  it("coachingNote agrees: 200% above usual, calls and notes at their normal level", () => {
    expect(coachingNote(esha)).toBe("Esha Thapa moved 18 students to Applications, 200% above usual, with calls and notes at their normal level.");
  });
  it("a +9% / +18% change is 'normal level', not a delta", () => {
    const p = P("x", "Xena", "telecaller", null, { calls: 50, notes: 36, moves: 20 }, { calls: 46, notes: 31, moves: 10 });
    expect(coachingNote(p)).toContain("with calls and notes at their normal level");
  });
});

describe("G4: never 'down 100%' / '100% below usual' in prose", () => {
  it("coachingNote: no calls → 'made no calls (usual 84)'", () => {
    const p = P("b", "Binod", "telecaller", null, { notes: 30 }, { calls: 84, notes: 30 });
    const note = coachingNote(p)!;
    expect(note).toBe("Binod made no calls (usual 84), with notes at their normal level.");
    expect(note).not.toMatch(/100%/);
  });
  const p = P("a", "Asha", "telecaller", "K", {}, { calls: 82, notes: 54 });
  it("activityWhat: zero activity states facts, for since-day, today and other windows", () => {
    expect(activityWhat({ ...p, quietSinceDay: "2025-11-03" }, 0, 136, "this week")).toBe("no activity since Mon (usual 136)");
    expect(activityWhat(p, 0, 12, "today")).toBe("no activity yet today (usual 12 by now)");
    expect(activityWhat(p, 0, 136, "this week")).toBe("no activity this week (usual 136)");
    expect(activityWhat(p, 1, 400, "this week")).toBe("almost no activity this week (usual 400)");
    expect(activityWhat(p, 18, 136, "this week")).toBe("activity down 87% against usual");
  });
  it("buildAttention row text has no 'down 100%'", () => {
    const people = [p];
    const signals = computeSignals({ people, stageFlows: [], untouched: { count: 0, byPerson: [] }, branchKpis: [], thresholds: T }).all;
    const items = buildAttention({ people, signals, stageFlows: [], leakReasons: {}, staleHeld: {}, untouched: { count: 0, byBranch: [], byRole: [] }, periodNoun: "today" } as AttentionInput);
    const row = items.find((i) => i.subject === "Asha");
    expect(row?.what).toBe("no activity yet today (usual 136 by now)");
  });
});

describe("G5: the activity-drop button always names what it opens", () => {
  const people = [P("a", "Asha Rai", "telecaller", "K", { calls: 18, notes: 13 }, { calls: 82, notes: 54 }), P("d", "Dipa", "telecaller", "K", { calls: 60 }, { calls: 60 })];
  const signals = computeSignals({ people, stageFlows: [], untouched: { count: 0, byPerson: [] }, branchKpis: [], thresholds: T }).all;
  const run = (stale: number) => buildAttention({ people, signals, stageFlows: [], leakReasons: {}, staleHeld: { a: stale }, heldLoad: { a: 100, d: 100 }, untouched: { count: 0, byBranch: [], byRole: [] } } as AttentionInput).find((i) => i.subject === "Asha Rai")!;
  it("stale = 0 → 'See Asha's day' opens the person drawer (no lead set, no 'Review leads')", () => {
    const a = run(0).action!;
    expect(a.label).toBe("See Asha's day");
    expect(a.personId).toBe("a");
    expect(a.label).not.toMatch(/Review leads/);
  });
  it("stale > 0 → the button carries the count and opens exactly the untouched leads", () => {
    const a = run(23).action!;
    expect(a.label).toMatch(/23/);
    expect(a.href).toBe(untouchedHeldOfPersonHref("a"));
    expect(a.personId).toBeUndefined();
  });
});

describe("G3: scoreboard totals equal the sum of the visible person cells", () => {
  it("each role's delivered tile matches a scoreboard column that is NOT '–' for that role", () => {
    const col = { reached_applications: "r-s", prospects: "r-p", applications_filed: "r-f" } as const;
    for (const slug of ["counsellor", "executive", "app-executive"]) {
      const p = P("u", "N", slug, null, {}, {});
      const metric = personTiles(p, 0)[2].metric as keyof typeof col;
      expect(NA_ROLES[col[metric]]).not.toContain(p.positionKey);
    }
  });
  it("Prospects: Executives' delivered Prospects are credited, so the total equals the visible rows", () => {
    const people = [P("1", "Exec", "executive", null, { prospects: 11 }, {}), P("2", "Tele", "telecaller", null, { prospects: 5 }, {}), P("3", "Couns", "counsellor", null, { prospects: 3 }, {})];
    const total = sumVisible(NA_ROLES["r-p"], people, (p) => ({ current: p.current.prospects, previous: 0, usual: 0 }));
    const visible = people.filter((p) => !NA_ROLES["r-p"].includes(p.positionKey)).reduce((a, p) => a + p.current.prospects, 0);
    expect(total.current).toBe(visible);
    expect(visible).toBe(11);
  });
  it("for every column, the total equals the sum of the non-n/a person cells", () => {
    const keys: Record<string, (p: PersonRow) => number> = {
      received: (p) => p.current.received, back: (p) => p.current.back_archived, status: (p) => p.current.status_changes, notes: (p) => p.current.notes, calls: (p) => p.current.calls,
      "r-p": (p) => p.current.prospects, "r-s": (p) => p.current.reached_applications, "r-f": (p) => p.current.applications_filed,
    };
    const all = { received: 2, back_archived: 3, status_changes: 4, notes: 5, calls: 6, prospects: 7, reached_applications: 8, applications_filed: 9 };
    const people = ["telecaller", "counsellor", "executive", "app-executive"].map((s, i) => P(String(i), s, s, null, all, {}));
    for (const [id, f] of Object.entries(keys)) {
      const total = sumVisible(NA_ROLES[id], people, (p) => ({ current: f(p), previous: 0, usual: 0 })).current;
      expect(total).toBe(people.filter((p) => !NA_ROLES[id].includes(p.positionKey)).reduce((a, p) => a + f(p), 0));
    }
  });
});

describe("briefing: G6 doors, G8 closer, G9 one branch story", () => {
  const people = [
    P("Asha", "Asha", "telecaller", "Kathmandu", { calls: 18, prospects: 2 }, { calls: 82, notes: 20, prospects: 12 }, { prospects: 12 }),
    P("Esha", "Esha", "counsellor", "Kathmandu", { prospects: 4, reached_applications: 9 }, { prospects: 4, reached_applications: 5 }, { prospects: 4, reached_applications: 3 }),
    P("Farhan", "Farhan", "counsellor", "Pokhara", { prospects: 6, reached_applications: 3 }, { prospects: 4, reached_applications: 3 }, { prospects: 4, reached_applications: 3 }),
  ];
  const input = (extra: Partial<BriefingInput> = {}): BriefingInput => ({ people, team: rollups(people).team, stageFlows: [], leakReasons: {}, untouched: { count: 63 }, thresholds: T, ...extra });
  const neg = (extra: Partial<BriefingInput> = {}) => buildBriefing(input(extra))!.items.find((i) => i.id === "neg")!;

  it("G6: a culprit with untouched leads → '<N> leads' with the attention button's href", () => {
    expect(neg({ staleHeld: { Asha: 23 } }).link).toEqual({ label: "23 leads", href: untouchedHeldOfPersonHref("Asha") });
  });
  it("G6: no untouched leads → '<cur> prospects' drilling to the metric; never a zero-record door", () => {
    expect(neg().link).toEqual({ label: "12 prospects", drill: { metric: "prospects" } });
    const zero = [P("A", "A", "telecaller", "K", { prospects: 0 }, {}, { prospects: 8 })];
    const b = buildBriefing({ ...input(), people: zero, team: rollups(zero).team, untouched: { count: 0 } });
    for (const it of b?.items ?? []) if (it.link) expect(it.link.label).not.toMatch(/^0 /);
  });
  it("G8: the Today closer is dropped; 7d/30d keep it", () => {
    expect(buildBriefing(input())!.read).toMatch(/Fix those two and/);
    const today = buildBriefing(input({ closer: false }))!.read;
    expect(today).not.toMatch(/Fix |should hold/);
    expect(today).toBeTruthy();
  });
  it("G9: names a branch only when the Heads-up row blames the same one (or has none)", () => {
    expect(buildBriefing(input())!.read).toContain("mostly in Kathmandu");
    expect(buildBriefing(input({ headsUpBranchId: "Kathmandu" }))!.read).toContain("mostly in Kathmandu");
    const other = buildBriefing(input({ headsUpBranchId: "Pokhara" }))!;
    expect(other.read ?? "").not.toContain("Kathmandu");
    expect(other.items.find((i) => i.id === "neg")!.headline).not.toContain("Kathmandu");
  });
});
