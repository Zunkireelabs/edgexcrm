import { describe, it, expect } from "vitest";
import { isPulseAiEnabled } from "@/lib/ai/flag";

describe("pulse_ai flag", () => {
  it("is stubbed off in slice 1 — Pulse works fully with AI off, and nothing may enable it by accident", () => {
    expect(isPulseAiEnabled()).toBe(false);
  });
});
