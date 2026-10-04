import { describe, it, expect } from "vitest";
import { formatDateTime12, formatMinutes12, formatTime12, joinTime, splitTime } from "./time-format";

describe("12-hour formatting", () => {
  it("shows AM / PM for every hour, including midnight and noon", () => {
    expect(formatTime12("00:00")).toBe("12:00 AM");
    expect(formatTime12("00:30")).toBe("12:30 AM");
    expect(formatTime12("09:05")).toBe("9:05 AM");
    expect(formatTime12("12:00")).toBe("12:00 PM");
    expect(formatTime12("15:00")).toBe("3:00 PM");
    expect(formatTime12("23:59")).toBe("11:59 PM");
  });
  it("leaves something that isn't HH:MM alone", () => {
    expect(formatTime12("soon")).toBe("soon");
  });
  it("formats minutes past midnight, wrapping over 24 h", () => {
    expect(formatMinutes12(12 * 60)).toBe("12:00 PM");
    expect(formatMinutes12(25 * 60)).toBe("1:00 AM");
  });
  it("always writes AM / PM for a date-time, whatever the locale", () => {
    expect(formatDateTime12(new Date(2026, 9, 3, 15, 0))).toMatch(/3:00 PM$/);
    expect(formatDateTime12(new Date(2026, 9, 3, 9, 15))).toMatch(/9:15 AM$/);
  });
  it("splits and joins the same value both ways", () => {
    for (const t of ["00:00", "00:45", "09:30", "12:00", "12:15", "13:05", "23:55"]) {
      const p = splitTime(t)!;
      expect(joinTime(p.hour12, p.minute, p.pm)).toBe(t);
    }
    expect(splitTime("")).toBeNull();
  });
});
