import { describe, expect, it } from "vitest";
import { formatDateTime, toLocalDateString } from "./date";

describe("formatDateTime", () => {
  // Pinned to UTC so the assertions don't depend on the machine's time zone.
  it("renders a readable date and time, without seconds", () => {
    expect(formatDateTime("2026-09-28T13:53:20Z", "UTC")).toBe("Sep 28, 2026, 1:53 PM");
  });

  it("renders morning times with AM", () => {
    expect(formatDateTime("2026-09-29T11:39:50Z", "UTC")).toBe("Sep 29, 2026, 11:39 AM");
  });

  it("gives the same text for the same instant whether given a string or a Date", () => {
    const iso = "2026-09-28T13:53:20Z";
    expect(formatDateTime(new Date(iso), "UTC")).toBe(formatDateTime(iso, "UTC"));
  });

  it("respects the time zone it is given", () => {
    expect(formatDateTime("2026-09-28T13:53:20Z", "Asia/Kathmandu")).toBe("Sep 28, 2026, 7:38 PM");
  });

  it("returns a dash for a missing or invalid value instead of 'Invalid Date'", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
    expect(formatDateTime("")).toBe("—");
    expect(formatDateTime("not a date")).toBe("—");
  });
});

describe("toLocalDateString", () => {
  it("still formats YYYY-MM-DD from the local clock", () => {
    expect(toLocalDateString(new Date(2026, 8, 5))).toBe("2026-09-05");
  });
});
