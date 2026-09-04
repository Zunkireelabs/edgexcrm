import { describe, it, expect } from "vitest";
import { resolveDateRangeFrom } from "./date-range-presets";

describe("resolveDateRangeFrom — timezone-aware day boundaries", () => {
  describe("Asia/Kathmandu (UTC+05:45 — the tenant default, a 45-minute offset)", () => {
    const tz = "Asia/Kathmandu";

    it("'today' snaps to the tenant's local midnight, not the server's", () => {
      // 02:00Z on the 3rd is already 07:45 on the 3rd in Kathmandu, so 'today'
      // is 2026-09-03 local — whose midnight is 18:15Z on the 2nd.
      const now = new Date("2026-09-03T02:00:00Z");
      expect(resolveDateRangeFrom("today", now, tz)?.toISOString()).toBe(
        "2026-09-02T18:15:00.000Z",
      );
    });

    it("'today' still resolves to the local day when the server date is a day ahead", () => {
      // 20:00Z on the 2nd is 01:45 on the 3rd in Kathmandu — local 'today' is the 3rd.
      const now = new Date("2026-09-02T20:00:00Z");
      expect(resolveDateRangeFrom("today", now, tz)?.toISOString()).toBe(
        "2026-09-02T18:15:00.000Z",
      );
    });

    it("'month' snaps to the first of the local month at local midnight", () => {
      const now = new Date("2026-09-03T02:00:00Z");
      expect(resolveDateRangeFrom("month", now, tz)?.toISOString()).toBe(
        "2026-08-31T18:15:00.000Z",
      );
    });
  });

  describe("America/New_York (proves DST is handled, not a fixed offset)", () => {
    const tz = "America/New_York";

    it("'today' in EDT is a UTC-4 midnight", () => {
      // 2026-03-08 is the spring-forward date; by the 9th New York is on EDT.
      const now = new Date("2026-03-09T12:00:00Z"); // 08:00 on the 9th, EDT
      expect(resolveDateRangeFrom("today", now, tz)?.toISOString()).toBe(
        "2026-03-09T04:00:00.000Z",
      );
    });

    it("'today' in EST is a UTC-5 midnight — same tz, different offset", () => {
      const now = new Date("2026-01-15T12:00:00Z"); // 07:00 on the 15th, EST
      expect(resolveDateRangeFrom("today", now, tz)?.toISOString()).toBe(
        "2026-01-15T05:00:00.000Z",
      );
    });
  });

  describe("rolling presets are unaffected by tz", () => {
    const now = new Date("2026-09-03T02:00:00Z");

    it("'7d' is a plain -7 day offset from now regardless of tz", () => {
      const a = resolveDateRangeFrom("7d", now, "Asia/Kathmandu")!;
      const b = resolveDateRangeFrom("7d", now, "America/New_York")!;
      expect(a.toISOString()).toBe(b.toISOString());
      const expected = new Date(now);
      expected.setDate(expected.getDate() - 7);
      expect(a.toISOString()).toBe(expected.toISOString());
    });

    it("'30d' is a plain -30 day offset from now regardless of tz", () => {
      const a = resolveDateRangeFrom("30d", now, "Asia/Kathmandu")!;
      const b = resolveDateRangeFrom("30d", now, "America/New_York")!;
      expect(a.toISOString()).toBe(b.toISOString());
      const expected = new Date(now);
      expected.setDate(expected.getDate() - 30);
      expect(a.toISOString()).toBe(expected.toISOString());
    });
  });

  describe("null cases", () => {
    const now = new Date("2026-09-03T02:00:00Z");
    it("'all' → null", () => {
      expect(resolveDateRangeFrom("all", now, "Asia/Kathmandu")).toBeNull();
    });
    it("undefined → null", () => {
      expect(resolveDateRangeFrom(undefined, now, "Asia/Kathmandu")).toBeNull();
    });
    it("unrecognized key → null", () => {
      expect(resolveDateRangeFrom("last-quarter", now, "Asia/Kathmandu")).toBeNull();
    });
  });
});
