import { describe, it, expect } from "vitest";
import { UNTOUCHED_HELD_DAYS, untouchedHeldCutoff } from "./untouched";

describe("untouched (held leads) — one absolute definition", () => {
  it("is 3 days, and the cutoff depends only on now — never on the Pulse window (Today / 7d / 30d give the same set)", () => {
    expect(UNTOUCHED_HELD_DAYS).toBe(3);
    const now = new Date("2026-11-05T09:30:00.000Z");
    expect(untouchedHeldCutoff(now)).toBe("2026-11-02T09:30:00.000Z");
  });
});
