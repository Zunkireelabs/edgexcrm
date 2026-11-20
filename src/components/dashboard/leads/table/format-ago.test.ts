import { describe, expect, it } from "vitest";
import { formatAgo } from "./format-ago";

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatAgo", () => {
  it("handles missing and invalid input", () => {
    expect(formatAgo(null, NOW)).toBe("—");
    expect(formatAgo(undefined, NOW)).toBe("—");
    expect(formatAgo("nope", NOW)).toBe("—");
  });
  it("Just now below a minute, and for future timestamps", () => {
    expect(formatAgo(ago(0), NOW)).toBe("Just now");
    expect(formatAgo(ago(59_999), NOW)).toBe("Just now");
    expect(formatAgo(ago(-5 * MIN), NOW)).toBe("Just now");
  });
  it("minutes boundary", () => {
    expect(formatAgo(ago(MIN), NOW)).toBe("1m ago");
    expect(formatAgo(ago(HOUR - 1), NOW)).toBe("59m ago");
  });
  it("hours boundary", () => {
    expect(formatAgo(ago(HOUR), NOW)).toBe("1h ago");
    expect(formatAgo(ago(DAY - 1), NOW)).toBe("23h ago");
  });
  it("days run up to 59d", () => {
    expect(formatAgo(ago(DAY), NOW)).toBe("1d ago");
    expect(formatAgo(ago(59 * DAY + HOUR), NOW)).toBe("59d ago");
  });
  it("months from 60 days, capped at 11mo", () => {
    expect(formatAgo(ago(60 * DAY), NOW)).toBe("2mo ago");
    expect(formatAgo(ago(90 * DAY), NOW)).toBe("3mo ago");
    expect(formatAgo(ago(364 * DAY), NOW)).toBe("11mo ago");
  });
  it("years from 365 days", () => {
    expect(formatAgo(ago(365 * DAY), NOW)).toBe("1y ago");
    expect(formatAgo(ago(800 * DAY), NOW)).toBe("2y ago");
  });
});
