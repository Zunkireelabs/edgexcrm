import { describe, expect, it } from "vitest";
import { coerceCallbackDue } from "./callback-due";

const now = new Date("2026-11-07T10:00:00.000Z");

describe("coerceCallbackDue", () => {
  it("accepts null (clears)", () => expect(coerceCallbackDue(null, now)).toEqual({ ok: true, value: null }));
  it("accepts a future ISO time and normalises to UTC", () => {
    expect(coerceCallbackDue("2026-11-07T17:00:00+05:45", now)).toEqual({ ok: true, value: "2026-11-07T11:15:00.000Z" });
  });
  it("accepts up to 5 minutes in the past", () => {
    expect(coerceCallbackDue("2026-11-07T09:55:30.000Z", now).ok).toBe(true);
  });
  it("rejects more than 5 minutes in the past", () => {
    const r = coerceCallbackDue("2026-11-07T09:54:00.000Z", now);
    expect(r).toEqual({ ok: false, error: "Call-back time can't be in the past" });
  });
  it("rejects more than 90 days ahead, accepts exactly 90", () => {
    expect(coerceCallbackDue("2027-02-05T10:00:00.000Z", now).ok).toBe(true);
    expect(coerceCallbackDue("2027-02-05T10:00:01.000Z", now)).toEqual({
      ok: false,
      error: "Call-back time can't be more than 90 days ahead",
    });
  });
  it("rejects non-strings, blanks and garbage", () => {
    expect(coerceCallbackDue(123, now).ok).toBe(false);
    expect(coerceCallbackDue("", now).ok).toBe(false);
    expect(coerceCallbackDue("not a date", now).ok).toBe(false);
  });
});
