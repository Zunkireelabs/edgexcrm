import { describe, it, expect } from "vitest";
import { DEADLINE_FIXTURES, fixtureOfficeHours } from "./working-hours.fixtures";
import {
  DEFAULT_OFFICE_HOURS,
  LEARN_MIN_EVENTS,
  describeClock,
  describeDays,
  describeOfficeHours,
  isInOfficeHours,
  learnOfficeHours,
  parseOfficeHours,
  validateOfficeHoursInput,
  withinOneWorkingHour,
  workingClockStart,
  workingDeadline,
  workingMinutesBetween,
} from "./working-hours";

const at = (iso: string) => new Date(iso);
const ADMIZZ = { days: [0, 1, 2, 3, 4, 5], startMin: 540, endMin: 1080, source: "saved" as const };
const KTM = "Asia/Kathmandu";

describe("workingDeadline parity table (independent oracle; the same rows run through SQL)", () => {
  it.each(DEADLINE_FIXTURES)("$name", (f) => {
    expect(workingDeadline(at(f.at), f.minutes, fixtureOfficeHours(f), f.tz).toISOString().replace(".000Z", "Z")).toBe(f.deadline);
  });
  it("the table includes a foreign timezone with a clock change and a half-hour opening", () => {
    expect(DEADLINE_FIXTURES.some((f) => f.tz === "America/New_York")).toBe(true);
    expect(DEADLINE_FIXTURES.some((f) => f.startMin % 60 === 30)).toBe(true);
  });
});

describe("workingDeadline edges", () => {
  it("a Saturday 20:10 lead on Sunday-Friday hours is due Sunday 10:00, not Saturday night", () => {
    expect(workingDeadline(at("2026-11-07T14:25:00Z"), 60, ADMIZZ, KTM)).toEqual(at("2026-11-08T04:15:00Z"));
  });
  it("with every day working (today's default) a Saturday lead is on the clock from arrival until 18:00", () => {
    expect(workingDeadline(at("2026-11-07T04:00:00Z"), 60, DEFAULT_OFFICE_HOURS, KTM)).toEqual(at("2026-11-07T05:00:00Z"));
  });
  it("0 minutes is the working-clock start: inside hours it is the arrival itself", () => {
    const t = at("2026-11-02T06:00:00Z");
    expect(workingClockStart(t, KTM, ADMIZZ)).toEqual(t);
  });
  it("a deadline exactly at closing time is allowed (<=), one minute more rolls over", () => {
    expect(workingDeadline(at("2026-11-05T11:15:00Z"), 60, ADMIZZ, KTM)).toEqual(at("2026-11-05T12:15:00Z")); // 17:00 + 60 = 18:00
    expect(workingDeadline(at("2026-11-05T11:15:00Z"), 61, ADMIZZ, KTM)).toEqual(at("2026-11-06T03:16:00Z")); // 9:01 next day
  });
  it("no working days -> plain clock minutes, never an endless loop", () => {
    expect(workingDeadline(at("2026-11-02T06:00:00Z"), 60, { ...ADMIZZ, days: [] }, KTM)).toEqual(at("2026-11-02T07:00:00Z"));
  });
  it("withinOneWorkingHour follows the office hours", () => {
    const created = at("2026-11-07T14:25:00Z"); // Saturday evening
    expect(withinOneWorkingHour(created, at("2026-11-08T04:10:00Z"), KTM, ADMIZZ)).toBe(true); // Sunday 9:55
    expect(withinOneWorkingHour(created, at("2026-11-08T04:20:00Z"), KTM, ADMIZZ)).toBe(false);
    expect(withinOneWorkingHour(created, null, KTM, ADMIZZ)).toBe(false);
  });
});

describe("workingMinutesBetween", () => {
  it("counts only office minutes", () => {
    // Friday 17:00 -> Sunday 10:00 on Sun-Fri 9-18: 60 (Friday) + 60 (Sunday)
    expect(workingMinutesBetween(at("2026-11-06T11:15:00Z"), at("2026-11-08T04:15:00Z"), ADMIZZ, KTM)).toBe(120);
  });
  it("is 0 when `to` is not after `from`, and the plain gap with no working days", () => {
    expect(workingMinutesBetween(at("2026-11-08T04:15:00Z"), at("2026-11-08T04:15:00Z"), ADMIZZ, KTM)).toBe(0);
    expect(workingMinutesBetween(at("2026-11-02T06:00:00Z"), at("2026-11-02T06:30:00Z"), { ...ADMIZZ, days: [] }, KTM)).toBe(30);
  });
  it.each(DEADLINE_FIXTURES.filter((f) => f.minutes > 0))("is the inverse of workingDeadline: $name", (f) => {
    const oh = fixtureOfficeHours(f);
    const start = workingClockStart(at(f.at), f.tz, oh);
    expect(workingMinutesBetween(start, at(f.deadline), oh, f.tz)).toBeCloseTo(f.minutes, 6);
  });
  it("works in a foreign timezone too (New York, Friday 16:30 -> Monday 09:30)", () => {
    const oh = { days: [1, 2, 3, 4, 5], startMin: 540, endMin: 1020, source: "saved" as const };
    expect(workingMinutesBetween(at("2026-10-30T20:30:00Z"), at("2026-11-02T14:30:00Z"), oh, "America/New_York")).toBe(60);
  });
});

describe("isInOfficeHours", () => {
  it("start is inside, end is outside, closed days are outside", () => {
    expect(isInOfficeHours(at("2026-11-01T03:15:00Z"), ADMIZZ, KTM)).toBe(true); // Sun 9:00
    expect(isInOfficeHours(at("2026-11-05T12:15:00Z"), ADMIZZ, KTM)).toBe(false); // Thu 18:00
    expect(isInOfficeHours(at("2026-11-07T06:00:00Z"), ADMIZZ, KTM)).toBe(false); // Sat noon
  });
});

describe("describe + parse + validate", () => {
  it("reads like the mockup: 'Sun–Fri, 9–6'", () => {
    expect(describeOfficeHours(ADMIZZ)).toBe("Sun–Fri, 9–6");
    expect(describeDays([0, 1, 2, 3, 4, 5, 6])).toBe("every day");
    expect(describeDays([1, 3, 5])).toBe("Mon, Wed, Fri");
    expect(describeDays([1, 2])).toBe("Mon, Tue");
    expect(describeClock(570)).toBe("9:30");
    expect(describeClock(1050)).toBe("5:30");
  });
  it("parseOfficeHours reads the SQL JSON and falls back to the default on anything off", () => {
    expect(parseOfficeHours({ days: [5, 1, 1, 0], start_min: 540, end_min: 1080, source: "saved" })).toEqual({ days: [0, 1, 5], startMin: 540, endMin: 1080, source: "saved" });
    expect(parseOfficeHours({ days: [0], start_min: 540, end_min: 1080, source: "learned" }).source).toBe("learned");
    for (const bad of [null, {}, { days: [], start_min: 540, end_min: 1080 }, { days: [9], start_min: 540, end_min: 1080 }, { days: [1], start_min: 1080, end_min: 540 }, { days: [1], start_min: 0, end_min: 1441 }]) {
      expect(parseOfficeHours(bad)).toBe(DEFAULT_OFFICE_HOURS);
    }
  });
  it("validateOfficeHoursInput accepts a good body (days sorted and unique) and names every bad field", () => {
    expect(validateOfficeHoursInput({ days: [5, 0, 0, 3], startMin: 540, endMin: 1080 })).toEqual({ ok: true, value: { days: [0, 3, 5], startMin: 540, endMin: 1080 } });
    const bad = validateOfficeHoursInput({ days: [], startMin: -5, endMin: 2000 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["days", "endMin", "startMin"]);
    expect(validateOfficeHoursInput({ days: [1], startMin: 600, endMin: 600 }).ok).toBe(false);
    expect(validateOfficeHoursInput({ days: [1], startMin: 600.5, endMin: 900 }).ok).toBe(false);
    expect(validateOfficeHoursInput({ days: [7], startMin: 600, endMin: 900 }).ok).toBe(false);
    expect(validateOfficeHoursInput(null).ok).toBe(false);
  });
});

describe("learnOfficeHours (the TS twin of the SQL learned branch)", () => {
  it("drops Saturday at 11 of 1,613 (real Admizz counts) and keeps Sunday to Friday, 9-18", () => {
    const l = learnOfficeHours([1533, 1264, 1613, 1513, 1548, 801, 11]);
    expect(l).toEqual({ days: [0, 1, 2, 3, 4, 5], startMin: 540, endMin: 1080, source: "learned" });
  });
  it("a weekday is working at exactly 10% of the busiest", () => {
    expect(learnOfficeHours([1000, 100, 99, 500, 500, 500, 500]).days).toEqual([0, 1, 3, 4, 5, 6]);
  });
  it("under 200 events in total -> every day, 9-18", () => {
    expect(LEARN_MIN_EVENTS).toBe(200);
    expect(learnOfficeHours([40, 40, 40, 40, 39, 0, 0])).toBe(DEFAULT_OFFICE_HOURS);
    expect(learnOfficeHours([40, 40, 40, 40, 40, 0, 0]).days).toEqual([0, 1, 2, 3, 4]);
  });
});
