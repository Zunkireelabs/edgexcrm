import { describe, it, expect } from "vitest";
import { coachingNote, rowNote, ROW_NOTE_MAX, windowTitle } from "./notes";
import { ZERO_COUNTS, type MetricCounts, type PersonRow } from "./types";

const c = (o: Partial<MetricCounts> = {}): MetricCounts => ({ ...ZERO_COUNTS, ...o });
const P = (cur: Partial<MetricCounts>, usual: Partial<MetricCounts>, flag: PersonRow["flag"] = null): PersonRow => ({
  userId: "u", name: "Asha", email: null, positionSlug: null, positionName: null, positionKey: "telecaller", positionLabel: "TeleCaller", branchId: null, branchName: null,
  current: c(cur), previous: c(), usual: c(usual), notesNew: 0, notesEdited: 0, movesByStage: {}, forwardByStage: {}, backByStage: {}, bulkMoves: 0, trend: [], flag,
});

describe("rowNote — at most one, from the signals", () => {
  it("red: activity share + check in first", () => {
    expect(rowNote(P({ calls: 18, notes: 13 }, { calls: 82, notes: 54 }, "red"))).toEqual({ kind: "red", text: "Activity 23% of usual" });
  });
  it("amber: the intake multiple", () => {
    expect(rowNote(P({ received: 104 }, { received: 28 }, "amber"))).toEqual({ kind: "amber", text: "Over capacity · 3.7× intake" });
  });
  it("green: the delivered count", () => {
    expect(rowNote(P({ reached_applications: 9 }, { reached_applications: 5 }, "green"))?.text).toBe("Top mover · 9 to Apps");
  });
  it("nothing when there is no flag (no note is ever invented)", () => {
    expect(rowNote(P({ calls: 5 }, { calls: 5 }))).toBeNull();
  });
});

describe("rowNote — quiet-since and the length cap", () => {
  it("names the day they went quiet when the series has a clean stop", () => {
    const p = { ...P({ calls: 18, notes: 13 }, { calls: 82, notes: 54 }, "red"), quietSinceDay: "2025-11-08" };
    expect(rowNote({ ...p, quietSinceDay: "2025-11-06" })?.text).toBe("Quiet since Thu · check in first");
  });
  it("never exceeds the cap", () => {
    for (const day of ["2025-11-03", "2025-11-04", "2025-11-05", "2025-11-06", "2025-11-07"]) {
      const text = rowNote({ ...P({ calls: 18 }, { calls: 82 }, "red"), quietSinceDay: day })!.text;
      expect(text.length).toBeLessThanOrEqual(ROW_NOTE_MAX);
    }
    expect(rowNote(P({ reached_applications: 123456 }, { reached_applications: 5 }, "green"))!.text.length).toBeLessThanOrEqual(ROW_NOTE_MAX);
  });
});

describe("coachingNote — the most notable signal first, then the context", () => {
  it("leads with the biggest change against their own usual", () => {
    expect(coachingNote(P({ calls: 18, notes: 13 }, { calls: 82, notes: 54 }))).toBe("Asha made 18 calls, 78% below usual. Notes 13 vs usual 54.");
  });
  it("a results metric can lead, and normal-level activity is context, not the headline", () => {
    const t = coachingNote(P({ calls: 50, notes: 20, reached_applications: 9 }, { calls: 49, notes: 20, reached_applications: 6 }));
    expect(t).toBe("Asha moved 9 students to Applications, 50% above usual, with calls and notes at their normal level.");
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
