import { describe, expect, it } from "vitest";
import { isMorningSlot, pairsToMake, type ReadRowLite } from "./morning";

describe("isMorningSlot: 7:00 in the TENANT's zone", () => {
  it("01:15 UTC is 7:00 in Kathmandu (UTC+5:45) but not in UTC", () => {
    const t = new Date("2026-11-09T01:15:00.000Z");
    expect(isMorningSlot(t, "Asia/Kathmandu")).toBe(true);
    expect(isMorningSlot(t, "UTC")).toBe(false);
  });
  it("07:15 UTC is the morning in UTC only", () => {
    const t = new Date("2026-11-09T07:15:00.000Z");
    expect(isMorningSlot(t, "UTC")).toBe(true);
    expect(isMorningSlot(t, "Asia/Kathmandu")).toBe(false);
  });
});

describe("pairsToMake: who gets a morning read", () => {
  const now = new Date("2026-11-09T01:15:00.000Z"); // Mon 9 Nov 07:00 Kathmandu
  const row = (o: Partial<ReadRowLite>): ReadRowLite => ({ user_id: "u1", scope: "me", for_date: "2026-11-08", opened_at: "2026-11-08T05:00:00.000Z", ...o });
  it("a person who opened Home yesterday gets one", () => {
    expect(pairsToMake([row({})], now, "Asia/Kathmandu")).toEqual([{ userId: "u1", scope: "me" }]);
  });
  it("skips someone who last opened Home 8 days ago (inactive)", () => {
    expect(pairsToMake([row({ opened_at: "2026-10-31T05:00:00.000Z" })], now, "Asia/Kathmandu")).toEqual([]);
  });
  it("a job-made row (no opened_at) never keeps anyone 'active'", () => {
    expect(pairsToMake([row({ opened_at: null })], now, "Asia/Kathmandu")).toEqual([]);
  });
  it("skips someone who already has today's read (a retry never makes it twice)", () => {
    expect(pairsToMake([row({}), row({ for_date: "2026-11-09", opened_at: null })], now, "Asia/Kathmandu")).toEqual([]);
  });
  it("one pair per person and scope, however many days of rows", () => {
    expect(pairsToMake([row({}), row({ for_date: "2026-11-07" })], now, "Asia/Kathmandu")).toHaveLength(1);
  });
});
