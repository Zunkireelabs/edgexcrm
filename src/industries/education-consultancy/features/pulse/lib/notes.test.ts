import { describe, it, expect } from "vitest";
import { coachingNote, rowNote, windowTitle } from "./notes";
import { ZERO_COUNTS, type MetricCounts, type PersonRow } from "./types";

const c = (o: Partial<MetricCounts> = {}): MetricCounts => ({ ...ZERO_COUNTS, ...o });
const P = (cur: Partial<MetricCounts>, usual: Partial<MetricCounts>, flag: PersonRow["flag"] = null): PersonRow => ({
  userId: "u", name: "Asha", email: null, positionSlug: null, positionName: null, positionKey: "telecaller", positionLabel: "TeleCaller", branchId: null, branchName: null,
  current: c(cur), previous: c(), usual: c(usual), notesNew: 0, notesEdited: 0, movesByStage: {}, forwardByStage: {}, backByStage: {}, bulkMoves: 0, trend: [], flag,
});

describe("rowNote — at most one, from the signals", () => {
  it("red: activity share + check in first", () => {
    expect(rowNote(P({ calls: 18, notes: 13 }, { calls: 82, notes: 54 }, "red"))).toEqual({ kind: "red", text: "Activity 23% of usual · check in first" });
  });
  it("amber: the intake multiple", () => {
    expect(rowNote(P({ received: 104 }, { received: 28 }, "amber"))).toEqual({ kind: "amber", text: "Over capacity · 3.7× intake" });
  });
  it("green: the delivered count", () => {
    expect(rowNote(P({ reached_applications: 9 }, { reached_applications: 5 }, "green"))?.text).toBe("Top mover · 9 to Applications");
  });
  it("nothing when there is no flag (no note is ever invented)", () => {
    expect(rowNote(P({ calls: 5 }, { calls: 5 }))).toBeNull();
  });
});

describe("coachingNote — the person's own numbers only", () => {
  it("states the share of usual and the figures", () => {
    expect(coachingNote(P({ calls: 18, notes: 13 }, { calls: 82, notes: 54 }))).toBe("Asha's activity is at 23% of usual. calls 18 vs usual 82 · notes 13 vs usual 54.");
  });
  it("is null when there is nothing meaningful to say", () => {
    expect(coachingNote(P({ calls: 1 }, { calls: 1 }))).toBeNull();
  });
  it("does not speculate about causes or use pronouns", () => {
    const t = coachingNote(P({ calls: 18 }, { calls: 82 }))!;
    expect(t).not.toMatch(/\b(his|her|him|she|he|leave|sick|absence)\b/i);
  });
});

describe("windowTitle", () => {
  it("follows the window", () => {
    expect(windowTitle("24h", "Admizz", "")).toBe("Today at Admizz");
    expect(windowTitle("7d", "Admizz", "")).toBe("This week at Admizz");
    expect(windowTitle("30d", "Admizz", "")).toBe("Last 30 days at Admizz");
    expect(windowTitle("custom", "Admizz", "1 Oct – 7 Oct")).toBe("1 Oct – 7 Oct at Admizz");
  });
});
