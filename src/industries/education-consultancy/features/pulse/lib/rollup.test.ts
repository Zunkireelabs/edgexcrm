import { describe, it, expect } from "vitest";
import { rollups } from "./rollup";
import { normalizePosition, pluralLabel } from "./positions";
import { ZERO_COUNTS, type MetricCounts, type PersonRow } from "./types";

const counts = (o: Partial<MetricCounts> = {}): MetricCounts => ({ ...ZERO_COUNTS, ...o });
const person = (id: string, slug: string, cur: Partial<MetricCounts>, usual: Partial<MetricCounts>, fwd = {}, back = {}): PersonRow => {
  const { key, label } = normalizePosition(slug);
  return {
    userId: id, name: id, email: null, positionSlug: slug, positionName: label, positionKey: key, positionLabel: label,
    branchId: null, branchName: null, current: counts(cur), previous: counts(), usual: counts(usual), notesNew: 0, notesEdited: 0,
    movesByStage: {}, forwardByStage: fwd, backByStage: back, bulkMoves: 0, trend: [], flag: null,
  };
};

describe("normalizePosition (review round 1: one role, one label)", () => {
  it("counselor and counsellor are the same role", () => {
    expect(normalizePosition("counselor").key).toBe("counsellor");
    expect(normalizePosition("counsellor").key).toBe("counsellor");
    expect(normalizePosition("counselor").label).toBe(normalizePosition("counsellor").label);
  });
  it("lead-executive is an Executive; unknown roles keep their own name; none is none", () => {
    expect(normalizePosition("lead-executive")).toEqual({ key: "executive", label: "Executive" });
    expect(normalizePosition("branch-manager").label).toBe("Branch Manager");
    expect(normalizePosition("weird-role", "Weird Role")).toEqual({ key: "weird-role", label: "Weird Role" });
    expect(normalizePosition(null).key).toBe("none");
  });
  it("pluralises without doubling", () => {
    expect(pluralLabel("Counsellor")).toBe("Counsellors");
    expect(pluralLabel("Sales")).toBe("Sales");
  });
});

describe("rollups", () => {
  const people = [
    person("a", "counselor", { calls: 10, prospects: 3 }, { calls: 8, prospects: 2 }, { S1: { current: 3, previous: 1, usual: 2 } }),
    person("b", "counsellor", { calls: 5, prospects: 1 }, { calls: 4, prospects: 1 }, { S1: { current: 1, previous: 0, usual: 1 } }, { ARCH: { current: 2, previous: 0, usual: 0.5 } }),
    person("c", "telecaller", { calls: 20 }, { calls: 30 }),
  ];
  const { groups, team } = rollups(people);

  it("splits 'counselor' and 'counsellor' into ONE group, in display order", () => {
    expect(groups.map((g) => [g.key, g.label, g.people])).toEqual([["counsellor", "Counsellors", 2], ["telecaller", "TeleCallers", 1]]);
  });
  it("subtotals are the sums of their people (current and usual)", () => {
    expect(groups[0].current.calls).toBe(15);
    expect(groups[0].usual.calls).toBe(12);
    expect(groups[0].current.prospects).toBe(4);
  });
  it("per-stage series are summed, forward and back separately", () => {
    expect(groups[0].forwardByStage.S1).toEqual({ current: 4, previous: 1, usual: 3 });
    expect(groups[0].backByStage.ARCH).toEqual({ current: 2, previous: 0, usual: 0.5 });
  });
  it("the team row equals the sum of the groups", () => {
    expect(team.current.calls).toBe(groups.reduce((a, g) => a + g.current.calls, 0));
    expect(team.people).toBe(3);
  });
  it("an empty team rolls up to zeros, not NaN", () => {
    const r = rollups([]);
    expect(r.groups).toEqual([]);
    expect(r.team.current.calls).toBe(0);
  });
});
