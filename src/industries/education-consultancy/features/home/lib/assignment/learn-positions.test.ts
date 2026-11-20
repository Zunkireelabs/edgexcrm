import { describe, expect, it } from "vitest";
import { learnFirstTouchPositions, type LearnMember } from "./learn-positions";

const m = (userId: string, slug: string | null, suspended = false): LearnMember => ({ userId, slug, name: slug ? slug.toUpperCase() : null, suspended });

describe("learnFirstTouchPositions", () => {
  it("Admizz: Counselors 71 alone is 68% so Lead Executives (33) join; the suspended TeleCallers never count", () => {
    const members = [m("a", "counselor"), m("b", "counselor"), m("c", "lead-executive"), m("t1", "lead-caller", true), m("t2", "lead-caller", true), m("t3", "lead-caller")];
    const r = learnFirstTouchPositions(members, { a: 40, b: 31, c: 33, t1: 50, t2: 9, t3: 0 });
    expect(r.positions.map((p) => [p.slug, p.count])).toEqual([["counselor", 71], ["lead-executive", 33]]);
    expect(r.chosen).toEqual(["counselor", "lead-executive"]);
    expect(r.total).toBe(104);
  });
  it("stops as soon as >= 80% is covered", () => {
    const r = learnFirstTouchPositions([m("a", "x"), m("b", "y"), m("c", "z")], { a: 85, b: 10, c: 5 });
    expect(r.chosen).toEqual(["x"]);
  });
  it("exactly 80% is enough", () => {
    expect(learnFirstTouchPositions([m("a", "x"), m("b", "y")], { a: 80, b: 20 }).chosen).toEqual(["x"]);
  });
  it("members without a position, and people who received nothing, are ignored", () => {
    const r = learnFirstTouchPositions([m("a", null), m("b", "x"), m("c", "y")], { a: 99, b: 5, c: 0 });
    expect(r.chosen).toEqual(["x"]);
    expect(r.total).toBe(5);
  });
  it("nobody received anything: nothing chosen (the caller keeps the old default)", () => {
    const r = learnFirstTouchPositions([m("a", "x")], {});
    expect(r).toEqual({ positions: [], chosen: [], total: 0, covered: 0 });
  });
  it("ties break on the slug, so the result is stable", () => {
    expect(learnFirstTouchPositions([m("a", "b"), m("b", "a")], { a: 10, b: 10 }).positions.map((p) => p.slug)).toEqual(["a", "b"]);
  });
});
