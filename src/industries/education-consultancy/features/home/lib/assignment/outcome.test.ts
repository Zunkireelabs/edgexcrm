import { describe, expect, it } from "vitest";
import { agreement, canUndo, classifyHumanAssignment, pickSystemOwner, shouldRequestAssignment, smartAssignmentNotification, smartAssignmentUndoneNotification, undoPatch } from "./outcome";

describe("classifyHumanAssignment (shadow-mode match recording)", () => {
  const shadow = { mode: "shadow" as const, pickedUserId: "asha", outcome: null };
  it("shadow: same person = matched, anyone else = overridden", () => {
    expect(classifyHumanAssignment(shadow, "asha")).toBe("matched");
    expect(classifyHumanAssignment(shadow, "bina")).toBe("overridden");
  });
  it("a resolved decision never changes", () => {
    expect(classifyHumanAssignment({ ...shadow, outcome: "matched" }, "bina")).toBeNull();
  });
  it("auto: only moving it away counts (overridden); re-assigning the same person is a no-op", () => {
    const auto = { mode: "auto" as const, pickedUserId: "asha", outcome: null };
    expect(classifyHumanAssignment(auto, "bina")).toBe("overridden");
    expect(classifyHumanAssignment(auto, "asha")).toBeNull();
  });
});

describe("agreement", () => {
  it("counts resolved shadow decisions: matched of matched + overridden", () => {
    const rows = [...Array(34).fill({ mode: "shadow", outcome: "matched" }), ...Array(6).fill({ mode: "shadow", outcome: "overridden" }), { mode: "shadow", outcome: null }, { mode: "auto", outcome: "matched" }];
    expect(agreement(rows)).toEqual({ matched: 34, total: 40, pct: 85 });
  });
  it("nothing resolved yet → no percentage", () => {
    expect(agreement([{ mode: "shadow", outcome: null }])).toEqual({ matched: 0, total: 0, pct: null });
  });
});

describe("pickSystemOwner (deterministic)", () => {
  const row = (user_id: string, created_at: string, role = "owner", suspended_at: string | null = null) => ({ user_id, role, created_at, suspended_at });
  it("the earliest-created ACTIVE owner", () => {
    expect(pickSystemOwner([row("late", "2026-05-01"), row("early", "2026-01-01"), row("admin", "2025-01-01", "admin")])).toBe("early");
  });
  it("skips suspended owners; none → null", () => {
    expect(pickSystemOwner([row("gone", "2025-01-01", "owner", "2026-02-02"), row("ok", "2026-03-01")])).toBe("ok");
    expect(pickSystemOwner([row("a", "2025-01-01", "admin")])).toBeNull();
  });
  it("same created_at breaks on user id", () => {
    expect(pickSystemOwner([row("b", "2026-01-01"), row("a", "2026-01-01")])).toBe("a");
  });
});

describe("smartAssignmentNotification", () => {
  it("reads 'Smart assignment assigned you <lead>', never an owner name", () => {
    expect(smartAssignmentNotification("Sujan Rai")).toEqual({ title: "Lead assigned to you", message: "Smart assignment assigned you Sujan Rai" });
  });
});

describe("shouldRequestAssignment", () => {
  it("only unassigned leads, only when the mode is on", () => {
    expect(shouldRequestAssignment({ mode: "off", assignedTo: null })).toBe(false);
    expect(shouldRequestAssignment({ mode: "shadow", assignedTo: null })).toBe(true);
    expect(shouldRequestAssignment({ mode: "auto", assignedTo: "u" })).toBe(false);
    expect(shouldRequestAssignment({ mode: "auto", assignedTo: undefined })).toBe(true);
  });
});

describe("canUndo", () => {
  const d = { mode: "auto" as const, pickedUserId: "asha", outcome: null };
  it("only an open auto decision whose lead is still with the pick", () => {
    expect(canUndo(d, "asha")).toBe(true);
    expect(canUndo(d, "bina")).toBe(false);
    expect(canUndo({ ...d, outcome: "undone" }, "asha")).toBe(false);
    expect(canUndo({ ...d, mode: "shadow" as never }, "asha")).toBe(false);
  });
});

describe("a decision with no pick (nobody could take the lead)", () => {
  it("a human assigning it later is neither a match nor an override", () => {
    expect(classifyHumanAssignment({ mode: "shadow", pickedUserId: null, outcome: null }, "asha")).toBeNull();
    expect(classifyHumanAssignment({ mode: "auto", pickedUserId: null, outcome: null }, "asha")).toBeNull();
  });
  it("and never counts in the shadow agreement", () => {
    expect(agreement([{ mode: "shadow", outcome: null }])).toEqual({ matched: 0, total: 0, pct: null });
  });
});

describe("Undo puts everything back", () => {
  it("restores the branch smart assignment moved the lead out of", () => {
    expect(undoPatch("global", "ktm")).toEqual({ assigned_to: null, branch_id: "global" });
  });
  it("a lead that had no branch gets none again", () => {
    expect(undoPatch(null, "ktm")).toEqual({ assigned_to: null, branch_id: null });
  });
  it("branch unchanged: only unassigns", () => {
    expect(undoPatch("ktm", "ktm")).toEqual({ assigned_to: null });
  });
  it("tells the person it was undone, not that it was reassigned to someone else", () => {
    expect(smartAssignmentUndoneNotification("Asha Rai").message).toBe("Smart assignment's pick was undone: Asha Rai is back with the team");
    expect(smartAssignmentUndoneNotification("Asha Rai").message).not.toContain("reassigned");
  });
});
