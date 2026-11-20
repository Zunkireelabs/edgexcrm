import { describe, it, expect } from "vitest";
import { ageTone, daysInStage, resolveCounsellor, initialsOf, isFinishedStage } from "./card-metrics";

describe("ageTone", () => {
  it.each([
    [13, "neutral"],
    [14, "amber"],
    [29, "amber"],
    [30, "red"],
  ])("%i days -> %s", (d, tone) => {
    expect(ageTone(d, false)).toBe(tone);
  });
  it("is always neutral on finished stages", () => {
    expect(ageTone(13, true)).toBe("neutral");
    expect(ageTone(30, true)).toBe("neutral");
    expect(ageTone(90, true)).toBe("neutral");
  });
  it("daysInStage floors whole days", () => {
    const now = Date.UTC(2026, 10, 13, 12);
    expect(daysInStage(new Date(now - 29.9 * 86_400_000).toISOString(), now)).toBe(29);
    expect(daysInStage("garbage", now)).toBe(0);
  });
});

describe("isFinishedStage", () => {
  it("true on is_terminal or terminal_type, false otherwise", () => {
    expect(isFinishedStage({ is_terminal: true, terminal_type: null })).toBe(true);
    expect(isFinishedStage({ is_terminal: false, terminal_type: "won" })).toBe(true);
    expect(isFinishedStage({ is_terminal: false, terminal_type: null })).toBe(false);
    expect(isFinishedStage(undefined)).toBe(false);
  });
});

describe("resolveCounsellor", () => {
  const names = { app1: "Asha Tamang", lead1: "Binod Rai" };
  it("prefers the application assignee, initials from the counsellor", () => {
    const c = resolveCounsellor({ assigned_to: "app1", leads: { assigned_to: "lead1" } }, names);
    expect(c).toEqual({ id: "app1", name: "Asha Tamang", initials: "AT" });
  });
  it("falls back to the lead's assignee", () => {
    expect(resolveCounsellor({ assigned_to: null, leads: { assigned_to: "lead1" } }, names)?.initials).toBe("BR");
  });
  it("returns null when neither is set", () => {
    expect(resolveCounsellor({ assigned_to: null, leads: { assigned_to: null } }, names)).toBeNull();
    expect(resolveCounsellor({ assigned_to: null }, names)).toBeNull();
  });
  it("initialsOf handles single names", () => {
    expect(initialsOf("Madonna")).toBe("M");
  });
});
