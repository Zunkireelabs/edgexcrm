import { describe, it, expect } from "vitest";
import { selectPrimaryTimer } from "./select-timer";

describe("selectPrimaryTimer", () => {
  it("returns null when no timers are running", () => {
    expect(selectPrimaryTimer([])).toBeNull();
  });

  it("returns the single timer with zero extras", () => {
    const timer = { id: "t1", started_at: "2026-01-01T10:00:00Z" };
    expect(selectPrimaryTimer([timer])).toEqual({ primary: timer, extraCount: 0 });
  });

  it("returns the oldest timer plus a count of the rest, regardless of input order", () => {
    const newest = { id: "t3", started_at: "2026-01-01T12:00:00Z" };
    const oldest = { id: "t1", started_at: "2026-01-01T09:00:00Z" };
    const middle = { id: "t2", started_at: "2026-01-01T10:30:00Z" };
    const selection = selectPrimaryTimer([newest, oldest, middle]);
    expect(selection).toEqual({ primary: oldest, extraCount: 2 });
  });
});
