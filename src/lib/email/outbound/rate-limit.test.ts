import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { acquireResendRateLimitSlot, _resetResendRateLimitForTests } from "./rate-limit";

// Pure timer-driven behavior — no DB, no network. Proves the limiter actually
// paces calls instead of letting them all through immediately (which is
// exactly what let 5 concurrent sendQueuedEmailBatch workers burst past
// Resend's real 10/sec cap and get "Too many requests" on a live blast).

describe("acquireResendRateLimitSlot", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetResendRateLimitForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets the first 8 calls through immediately (the configured per-second budget)", async () => {
    const resolved: number[] = [];
    for (let i = 0; i < 8; i++) {
       
      await acquireResendRateLimitSlot();
      resolved.push(i);
    }
    expect(resolved).toHaveLength(8);
  });

  it("makes the 9th call in the same window wait instead of firing immediately", async () => {
    for (let i = 0; i < 8; i++) {
       
      await acquireResendRateLimitSlot();
    }

    let ninthResolved = false;
    acquireResendRateLimitSlot().then(() => {
      ninthResolved = true;
    });

    // Still within the same 1s window — must NOT have resolved yet. This is
    // the actual bug this file fixes: today there is no pacing at all, so a
    // 9th (and 10th, 11th...) call fires immediately and Resend 429s it.
    await vi.advanceTimersByTimeAsync(500);
    expect(ninthResolved).toBe(false);

    // Past the 1s window from the first call — now it should have resolved.
    await vi.advanceTimersByTimeAsync(600);
    expect(ninthResolved).toBe(true);
  });

  it("spreads 24 calls across roughly 3 seconds instead of firing them all at once", async () => {
    let resolvedCount = 0;
    for (let i = 0; i < 24; i++) {
      acquireResendRateLimitSlot().then(() => {
        resolvedCount += 1;
      });
    }

    // Nothing has advanced yet — only the first window's worth should be through.
    await vi.advanceTimersByTimeAsync(0);
    expect(resolvedCount).toBe(8);

    await vi.advanceTimersByTimeAsync(1005);
    expect(resolvedCount).toBe(16);

    await vi.advanceTimersByTimeAsync(1005);
    expect(resolvedCount).toBe(24);
  });
});
