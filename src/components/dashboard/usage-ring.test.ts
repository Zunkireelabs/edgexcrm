import { describe, it, expect } from "vitest";
import { usageRingTone, smsUsedPct, aiUsedPct, ringPct, ringTitle } from "./usage-ring";

describe("usageRingTone", () => {
  it("ink below 80, warn from 80, bad from 95", () => {
    expect(usageRingTone(0)).toBe("ink");
    expect(usageRingTone(79)).toBe("ink");
    expect(usageRingTone(80)).toBe("warn");
    expect(usageRingTone(94)).toBe("warn");
    expect(usageRingTone(95)).toBe("bad");
    expect(usageRingTone(100)).toBe("bad");
  });
});

describe("smsUsedPct", () => {
  it("is (granted - balance) / granted", () => {
    expect(smsUsedPct(8412, 10000)).toBe(16);
    expect(smsUsedPct(1500, 10000)).toBe(85);
    expect(smsUsedPct(0, 10000)).toBe(100);
  });
  it("granted 0 (or invalid) → null, no ring", () => {
    expect(smsUsedPct(0, 0)).toBeNull();
    expect(smsUsedPct(5, -1)).toBeNull();
    expect(smsUsedPct(NaN, 10)).toBeNull();
  });
  it("clamps a balance above granted / below zero", () => {
    expect(smsUsedPct(12000, 10000)).toBe(0);
    expect(smsUsedPct(-5, 10000)).toBe(100);
  });
});

describe("aiUsedPct", () => {
  it("is usedToday / limit, clamped", () => {
    expect(aiUsedPct(6000, 200000)).toBe(3);
    expect(aiUsedPct(300000, 200000)).toBe(100);
    expect(aiUsedPct(0, 0)).toBeNull();
  });
});

describe("ringPct", () => {
  it("takes the higher pool", () => {
    expect(ringPct(3, 16)).toEqual({ pct: 16, pool: "sms" });
    expect(ringPct(40, 16)).toEqual({ pct: 40, pool: "ai" });
  });
  it("uses the only pool present; none → null", () => {
    expect(ringPct(null, 16)).toEqual({ pct: 16, pool: "sms" });
    expect(ringPct(7, null)).toEqual({ pct: 7, pool: "ai" });
    expect(ringPct(null, null)).toBeNull();
  });
  it("names the pool in the title", () => {
    expect(ringTitle({ pct: 16, pool: "sms" })).toBe("SMS credits: 16% used");
    expect(ringTitle({ pct: 3, pool: "ai" })).toContain("AI credits");
  });
});
