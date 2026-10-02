import { describe, it, expect } from "vitest";
import {
  computeDueAt,
  countryToTimeZone,
  describeSendWindow,
  DEFAULT_SEND_WINDOW,
  resolveWindowTimeZone,
  spreadOffsetMinutes,
  validateSendWindow,
  type SendWindow,
} from "./send-window";

// Calendar facts used below (2026 / 2027): Thu 1 Oct 2026 · Fri 2 · Sat 3 · Sun 4 · Mon 5 Oct 2026 · Fri 30 Oct ·
// Sun 1 Nov 2026 (US clocks go back) · Fri 31 Dec 2027.
const NPT = "Asia/Kathmandu"; // UTC+5:45, no DST
const iso = (d: Date) => d.toISOString();
const at = (s: string) => new Date(s);

const weekdays10: SendWindow = { time: "10:00", days: [1, 2, 3, 4, 5], timezone_mode: "office", spread_minutes: 0 };

describe("computeDueAt — no window (the old behaviour)", () => {
  it("is exactly now + delayDays x 24h, whatever the day or time", () => {
    const now = at("2026-10-03T22:30:00Z"); // a Saturday night
    expect(iso(computeDueAt({ now, delayDays: 0, window: null }))).toBe("2026-10-03T22:30:00.000Z");
    expect(iso(computeDueAt({ now, delayDays: 3, window: null }))).toBe("2026-10-06T22:30:00.000Z");
  });
});

describe("computeDueAt — time of day and allowed days", () => {
  it("before today's window: waits until it opens (10:00 Kathmandu = 04:15 UTC)", () => {
    const now = at("2026-10-07T03:00:00Z"); // Wed 08:45 NPT
    expect(iso(computeDueAt({ now, delayDays: 0, window: weekdays10, timeZone: NPT }))).toBe("2026-10-07T04:15:00.000Z");
  });

  it("after today's window: the next allowed day", () => {
    const now = at("2026-10-07T08:00:00Z"); // Wed 13:45 NPT, window (a single minute) is over
    expect(iso(computeDueAt({ now, delayDays: 0, window: weekdays10, timeZone: NPT }))).toBe("2026-10-08T04:15:00.000Z");
  });

  it("a Friday after the window goes to MONDAY, skipping the weekend", () => {
    const now = at("2026-10-02T08:00:00Z"); // Fri
    expect(iso(computeDueAt({ now, delayDays: 0, window: weekdays10, timeZone: NPT }))).toBe("2026-10-05T04:15:00.000Z");
  });

  it("a working week that includes Sunday but not Saturday (Nepal): Saturday -> Sunday", () => {
    const sunToFri: SendWindow = { ...weekdays10, days: [0, 1, 2, 3, 4, 5] };
    const now = at("2026-10-03T05:00:00Z"); // Sat
    expect(iso(computeDueAt({ now, delayDays: 0, window: sunToFri, timeZone: NPT }))).toBe("2026-10-04T04:15:00.000Z");
  });

  it("applies the wait first, then snaps to the window (Thu + 3 days lands on Sunday -> Monday)", () => {
    const now = at("2026-10-01T06:00:00Z"); // Thu
    expect(iso(computeDueAt({ now, delayDays: 3, window: weekdays10, timeZone: NPT }))).toBe("2026-10-05T04:15:00.000Z");
  });

  it("crosses a month end and a year end", () => {
    // Fri 30 Oct 2026 after the window -> Mon 2 Nov
    expect(iso(computeDueAt({ now: at("2026-10-30T09:00:00Z"), delayDays: 0, window: weekdays10, timeZone: NPT }))).toBe("2026-11-02T04:15:00.000Z");
    // Fri 31 Dec 2027 after the window -> Mon 3 Jan 2028
    expect(iso(computeDueAt({ now: at("2027-12-31T09:00:00Z"), delayDays: 0, window: weekdays10, timeZone: NPT }))).toBe("2028-01-03T04:15:00.000Z");
  });

  it("exactly at the window start is on time (not pushed a day)", () => {
    const now = at("2026-10-07T04:15:00Z");
    expect(iso(computeDueAt({ now, delayDays: 0, window: weekdays10, timeZone: NPT }))).toBe("2026-10-07T04:15:00.000Z");
  });
});

describe("computeDueAt — timezones", () => {
  it("follows daylight saving: 10:00 New York is 14:00 UTC in summer time and 15:00 UTC after the clocks go back", () => {
    const ny: SendWindow = { ...weekdays10, timezone_mode: "office" };
    // Wed 28 Oct 2026, EDT (UTC-4): after the window -> Thu 29 Oct 10:00 EDT = 14:00 UTC
    expect(iso(computeDueAt({ now: at("2026-10-28T20:00:00Z"), delayDays: 0, window: ny, timeZone: "America/New_York" }))).toBe("2026-10-29T14:00:00.000Z");
    // Fri 30 Oct after the window -> Mon 2 Nov, AFTER the 1 Nov change (EST, UTC-5): 10:00 EST = 15:00 UTC
    expect(iso(computeDueAt({ now: at("2026-10-30T20:00:00Z"), delayDays: 0, window: ny, timeZone: "America/New_York" }))).toBe("2026-11-02T15:00:00.000Z");
  });

  it("uses the lead's LOCAL date even when it is already tomorrow there (Auckland is UTC+13 in October)", () => {
    // Wed 20:00 UTC = Thu 09:00 in Auckland, so today's window (Thu 10:00 local = Wed 21:00 UTC) is still ahead
    expect(iso(computeDueAt({ now: at("2026-10-07T20:00:00Z"), delayDays: 0, window: weekdays10, timeZone: "Pacific/Auckland" }))).toBe("2026-10-07T21:00:00.000Z");
  });

  it("an invalid timezone falls back to UTC instead of throwing", () => {
    const now = at("2026-10-07T03:00:00Z");
    expect(iso(computeDueAt({ now, delayDays: 0, window: weekdays10, timeZone: "Not/AZone" }))).toBe("2026-10-07T10:00:00.000Z");
    expect(iso(computeDueAt({ now, delayDays: 0, window: weekdays10 }))).toBe("2026-10-07T10:00:00.000Z");
  });
});

describe("computeDueAt — spread", () => {
  const spread: SendWindow = { ...weekdays10, spread_minutes: 120 };
  const start = at("2026-10-07T04:15:00Z").getTime();

  it("gives each lead a stable minute inside [time, time + spread), never outside", () => {
    const now = at("2026-10-07T03:00:00Z");
    const minutes = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const due = computeDueAt({ now, delayDays: 0, window: spread, timeZone: NPT, spreadKey: `lead-${i}:step-1` }).getTime();
      const offset = (due - start) / 60_000;
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(120);
      minutes.add(offset);
    }
    // 1,000 leads reach almost every one of the 120 minutes — a batch is released gradually, not at one instant
    expect(minutes.size).toBeGreaterThan(110);
  });

  it("the same lead and step always gets the same minute", () => {
    const now = at("2026-10-07T03:00:00Z");
    const a = computeDueAt({ now, delayDays: 0, window: spread, timeZone: NPT, spreadKey: "lead-9:step-2" });
    const b = computeDueAt({ now, delayDays: 0, window: spread, timeZone: NPT, spreadKey: "lead-9:step-2" });
    expect(a.getTime()).toBe(b.getTime());
  });

  it("inside the window already: waits for the lead's minute if it is still ahead, otherwise goes straight away", () => {
    const now = new Date(start + 30 * 60_000); // 30 minutes into the window
    const keyAhead = Array.from({ length: 200 }, (_, i) => `k${i}`).find((k) => spreadOffsetMinutes(k, 120) === 90)!;
    const keyPast = Array.from({ length: 200 }, (_, i) => `k${i}`).find((k) => spreadOffsetMinutes(k, 120) === 10)!;
    expect(computeDueAt({ now, delayDays: 0, window: spread, timeZone: NPT, spreadKey: keyAhead }).getTime()).toBe(start + 90 * 60_000);
    expect(computeDueAt({ now, delayDays: 0, window: spread, timeZone: NPT, spreadKey: keyPast }).getTime()).toBe(now.getTime());
  });

  it("after the whole spread has passed, tomorrow", () => {
    const now = new Date(start + 121 * 60_000);
    expect(computeDueAt({ now, delayDays: 0, window: spread, timeZone: NPT, spreadKey: "x" }).getTime()).toBeGreaterThan(start + 20 * 3600_000);
  });

  it("spread 0 means exactly the window time for everyone", () => {
    expect(spreadOffsetMinutes("anything", 0)).toBe(0);
  });
});

describe("validateSendWindow", () => {
  it("null / undefined mean no window", () => {
    expect(validateSendWindow(null)).toEqual({ ok: true, window: null });
    expect(validateSendWindow(undefined)).toEqual({ ok: true, window: null });
  });

  it("accepts a good window and tidies the day list (sorted, de-duplicated)", () => {
    expect(validateSendWindow({ time: "09:30", days: [5, 1, 1, 3], timezone_mode: "lead", spread_minutes: 60 })).toEqual({
      ok: true,
      window: { time: "09:30", days: [1, 3, 5], timezone_mode: "lead", spread_minutes: 60 },
    });
    expect(validateSendWindow(DEFAULT_SEND_WINDOW).ok).toBe(true);
  });

  it("rejects bad times, days, modes and spreads", () => {
    const good = { time: "10:00", days: [1], timezone_mode: "office", spread_minutes: 0 };
    for (const bad of [
      { ...good, time: "10" }, { ...good, time: "24:00" }, { ...good, time: "9:30" }, { ...good, time: 1000 },
      { ...good, days: [] }, { ...good, days: [7] }, { ...good, days: ["1"] }, { ...good, days: "weekdays" },
      { ...good, timezone_mode: "utc" }, { ...good, spread_minutes: -1 }, { ...good, spread_minutes: 481 }, { ...good, spread_minutes: 1.5 },
      "10:00", [], 5,
    ]) {
      expect(validateSendWindow(bad).ok).toBe(false);
    }
  });
});

describe("timezone from the lead's country", () => {
  it("maps common countries, ignoring case and punctuation", () => {
    expect(countryToTimeZone("Nepal")).toBe("Asia/Kathmandu");
    expect(countryToTimeZone("  nepal ")).toBe("Asia/Kathmandu");
    expect(countryToTimeZone("U.S.A.")).toBeNull(); // not a listed spelling -> unknown, the office zone is used
    expect(countryToTimeZone("USA")).toBe("America/New_York");
    expect(countryToTimeZone("United Kingdom")).toBe("Europe/London");
    expect(countryToTimeZone("Australia")).toBe("Australia/Sydney");
  });

  it("is null for unknown / empty values", () => {
    expect(countryToTimeZone("Narnia")).toBeNull();
    expect(countryToTimeZone("")).toBeNull();
    expect(countryToTimeZone(null)).toBeNull();
    expect(countryToTimeZone(undefined)).toBeNull();
  });

  it("lead mode uses the lead's zone and falls back to the office's; office mode always uses the office's", () => {
    expect(resolveWindowTimeZone({ timezone_mode: "lead" }, { leadCountry: "Australia", officeTimeZone: NPT })).toBe("Australia/Sydney");
    expect(resolveWindowTimeZone({ timezone_mode: "lead" }, { leadCountry: "Narnia", officeTimeZone: NPT })).toBe(NPT);
    expect(resolveWindowTimeZone({ timezone_mode: "lead" }, { leadCountry: null, officeTimeZone: NPT })).toBe(NPT);
    expect(resolveWindowTimeZone({ timezone_mode: "office" }, { leadCountry: "Australia", officeTimeZone: NPT })).toBe(NPT);
  });

  it("never returns an invalid zone (a bad office zone becomes UTC)", () => {
    expect(resolveWindowTimeZone({ timezone_mode: "office" }, { officeTimeZone: "Nope/Zone" })).toBe("UTC");
    expect(resolveWindowTimeZone({ timezone_mode: "office" }, {})).toBe("UTC");
  });
});

describe("describeSendWindow", () => {
  it("lists the days Monday first, with the release range", () => {
    expect(describeSendWindow({ time: "10:00", days: [5, 1, 2, 3, 4], timezone_mode: "lead", spread_minutes: 120 })).toBe("Mon, Tue, Wed, Thu, Fri at 10:00–12:00");
    expect(describeSendWindow({ time: "09:30", days: [0, 1, 2, 3, 4, 5], timezone_mode: "office", spread_minutes: 0 })).toBe("Mon, Tue, Wed, Thu, Fri, Sun at 09:30");
    expect(describeSendWindow({ time: "23:00", days: [0, 1, 2, 3, 4, 5, 6], timezone_mode: "office", spread_minutes: 120 })).toBe("every day at 23:00–01:00");
  });
});
