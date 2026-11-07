import { describe, expect, it } from "vitest";
import { clock12, tenantLocalToIso } from "./time";

describe("clock12", () => {
  it("is '9:08 pm' style in the tenant zone", () => {
    expect(clock12(new Date("2026-11-09T15:23:00.000Z"), "Asia/Kathmandu")).toBe("9:08 pm");
    expect(clock12(new Date("2026-11-09T04:15:00.000Z"), "Asia/Kathmandu")).toBe("10:00 am");
  });
});

// The same wall-clock value must book the SAME instant whatever zone the browser is set to: it is read in the tenant's.
describe("tenantLocalToIso", () => {
  it("Kathmandu (UTC+5:45): 09:08 local is 03:23Z", () => {
    expect(tenantLocalToIso("2026-11-11T09:08", "Asia/Kathmandu")).toBe("2026-11-11T03:23:00.000Z");
  });
  it("does not depend on the process / browser zone", () => {
    const naive = new Date("2026-11-11T09:08").toISOString(); // what the old code did: reads in the runner's zone
    const viaTenant = tenantLocalToIso("2026-11-11T09:08", "Asia/Kathmandu");
    expect(viaTenant).toBe("2026-11-11T03:23:00.000Z");
    // Only equal when the runner happens to be in the tenant zone: proves the old behaviour was zone-dependent.
    if (process.env.TZ !== "Asia/Kathmandu") expect(naive).not.toBe(viaTenant);
  });
  it("a foreign tenant zone with DST: New York in November is UTC-5, in July UTC-4", () => {
    expect(tenantLocalToIso("2026-11-11T09:08", "America/New_York")).toBe("2026-11-11T14:08:00.000Z");
    expect(tenantLocalToIso("2026-07-11T09:08", "America/New_York")).toBe("2026-07-11T13:08:00.000Z");
  });
  it("UTC passes through; garbage is null", () => {
    expect(tenantLocalToIso("2026-11-11T09:08", "UTC")).toBe("2026-11-11T09:08:00.000Z");
    expect(tenantLocalToIso("tomorrow", "UTC")).toBeNull();
    expect(tenantLocalToIso("2026-11-11 09:08", "UTC")).toBeNull();
  });
});
