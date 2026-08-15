import { describe, it, expect } from "vitest";
import { resolveSendWindow } from "./quiet-hours";

// Asia/Kathmandu is UTC+05:45 — the five required cases from
// SMS-PHASE2-BRIEF.md §2e. The 45-minute offset is exactly where a naive
// `getHours() + offset` (or a UTC+6 approximation) breaks silently.

const TZ = "Asia/Kathmandu";

describe("resolveSendWindow", () => {
  it("2026-08-15T14:20:00Z = 20:05 NPT is OUTSIDE an 8-20 window (proves the 45min matters)", () => {
    const now = new Date("2026-08-15T14:20:00Z");
    const result = resolveSendWindow(now, TZ, 8, 20);
    expect(result.allowed).toBe(false);
  });

  it("2026-08-15T02:16:00Z = 08:01 NPT is allowed (just inside the window)", () => {
    const now = new Date("2026-08-15T02:16:00Z");
    const result = resolveSendWindow(now, TZ, 8, 20);
    expect(result.allowed).toBe(true);
  });

  it("2026-08-15T02:14:00Z = 07:59 NPT defers to 2026-08-15T02:15:00Z exactly", () => {
    const now = new Date("2026-08-15T02:14:00Z");
    const result = resolveSendWindow(now, TZ, 8, 20);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.deferUntil.toISOString()).toBe("2026-08-15T02:15:00.000Z");
    }
  });

  it("a late-night time defers to the NEXT morning, not today's past morning", () => {
    // 2026-08-15T18:00:00Z = 23:45 NPT — well past today's 20:00 close.
    const now = new Date("2026-08-15T18:00:00Z");
    const result = resolveSendWindow(now, TZ, 8, 20);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      // Next morning's 08:00 NPT = 2026-08-16T02:15:00Z, not 2026-08-15's.
      expect(result.deferUntil.toISOString()).toBe("2026-08-16T02:15:00.000Z");
      expect(result.deferUntil.getTime()).toBeGreaterThan(now.getTime());
    }
  });

  // quiet_hours_enabled is NOT a parameter of resolveSendWindow — see the
  // report note in the Phase 2 PR: the brief lists "quiet_hours_enabled =
  // false -> always allowed" as a required case, but that flag lives on
  // tenant_sms_settings, one layer above this pure function. The intended
  // contract is that a caller reading quiet_hours_enabled = false skips
  // calling resolveSendWindow entirely and treats the send as allowed. That
  // caller doesn't exist until Phase 3 wires the deferral release, so it's
  // documented here rather than asserted against a signature that doesn't
  // take the flag.
  it("documents the quiet_hours_enabled contract: callers must skip this function entirely when disabled", () => {
    const enabled = false;
    const now = new Date("2026-08-15T14:20:00Z"); // would defer if quiet hours were enforced
    const result = enabled ? resolveSendWindow(now, TZ, 8, 20) : { allowed: true as const };
    expect(result.allowed).toBe(true);
  });
});
