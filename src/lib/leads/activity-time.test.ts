import { describe, it, expect } from "vitest";
import { resolveActivityTime } from "./activity-time";

const now = new Date("2026-11-12T10:00:00Z");

describe("resolveActivityTime", () => {
  it("leaves the time to the database default when none is sent", () => {
    expect(resolveActivityTime(undefined, now)).toEqual({ ok: true, iso: null });
    expect(resolveActivityTime(null, now)).toEqual({ ok: true, iso: null });
    expect(resolveActivityTime("", now)).toEqual({ ok: true, iso: null });
  });
  it("accepts a past time and normalises it to ISO", () => {
    expect(resolveActivityTime("2026-11-11T09:30:00+05:45", now)).toEqual({ ok: true, iso: "2026-11-11T03:45:00.000Z" });
  });
  it("tolerates a minute of clock skew but not the future", () => {
    expect(resolveActivityTime("2026-11-12T10:00:30Z", now).ok).toBe(true);
    expect(resolveActivityTime("2026-11-12T10:05:00Z", now)).toEqual({ ok: false, error: "Can't be in the future" });
  });
  it("rejects junk", () => {
    expect(resolveActivityTime("yesterday", now).ok).toBe(false);
    expect(resolveActivityTime(12345, now).ok).toBe(false);
    expect(resolveActivityTime("1970-01-01T00:00:00Z", now).ok).toBe(false);
  });
});
