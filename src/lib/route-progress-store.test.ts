import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  finish,
  getSnapshot,
  reset,
  routeChanged,
  skeletonMounted,
  skeletonUnmounted,
  start,
  subscribe,
} from "./route-progress-store";

const ms = (n: number) => vi.advanceTimersByTime(n);

beforeEach(() => {
  vi.useFakeTimers();
  reset();
});
afterEach(() => {
  reset();
  vi.useRealTimers();
});

describe("route-progress-store", () => {
  it("starts idle at 0%", () => {
    expect(getSnapshot()).toEqual({ status: "idle", progress: 0 });
  });

  it("start() trickles up but never past 90 on its own", () => {
    start();
    expect(getSnapshot().status).toBe("loading");
    ms(500);
    const early = getSnapshot().progress;
    expect(early).toBeGreaterThan(0);
    ms(8000);
    expect(getSnapshot().progress).toBeGreaterThan(early);
    expect(getSnapshot().progress).toBeLessThanOrEqual(90);
  });

  it("start() is idempotent while loading — the percentage carries on, it never jumps back", () => {
    start();
    ms(1500);
    const before = getSnapshot().progress;
    start();
    expect(getSnapshot().progress).toBe(before);
  });

  it("finish() jumps to 100, lingers, then goes idle", () => {
    start();
    ms(300);
    finish();
    expect(getSnapshot()).toEqual({ status: "done", progress: 100 });
    ms(300);
    expect(getSnapshot()).toEqual({ status: "idle", progress: 0 });
  });

  it("finish() does nothing when not loading", () => {
    finish();
    expect(getSnapshot().status).toBe("idle");
  });

  it("reduced motion shows 90% immediately and does not trickle", () => {
    start({ reducedMotion: true });
    expect(getSnapshot().progress).toBe(90);
    ms(3000);
    expect(getSnapshot().progress).toBe(90);
  });

  describe("with a loading screen (loading.tsx)", () => {
    it("a loading screen appearing starts the indicator by itself (programmatic navigation / direct load)", () => {
      skeletonMounted();
      expect(getSnapshot().status).toBe("loading");
    });

    it("completes when the loading screen is replaced by the real page", () => {
      start();
      skeletonMounted();
      ms(1000);
      expect(getSnapshot().status).toBe("loading");
      skeletonUnmounted();
      ms(200);
      expect(getSnapshot().status).toBe("done");
      ms(300);
      expect(getSnapshot().status).toBe("idle");
    });

    it("an outer → inner loading-screen handoff (unmount then mount in the same commit) does not finish early", () => {
      start();
      skeletonMounted();
      skeletonUnmounted();
      skeletonMounted();
      ms(500);
      expect(getSnapshot().status).toBe("loading");
      skeletonUnmounted();
      ms(200);
      expect(getSnapshot().status).toBe("done");
    });

    it("the URL changing does NOT finish it while a loading screen is up (the URL changes when the skeleton appears)", () => {
      start();
      skeletonMounted();
      routeChanged();
      ms(2000);
      expect(getSnapshot().status).toBe("loading");
    });

    it("keeps waiting past 10s while a loading screen is up, but not forever (60s)", () => {
      start();
      skeletonMounted();
      ms(15_000);
      expect(getSnapshot().status).toBe("loading");
      ms(50_000);
      expect(getSnapshot().status).toBe("idle");
    });
  });

  describe("without a loading screen", () => {
    it("a route change finishes it (cached / instant render)", () => {
      start();
      ms(300);
      routeChanged();
      ms(150);
      expect(getSnapshot().status).toBe("done");
    });

    it("gives up after 10s if nothing ever happens, instead of sticking", () => {
      start();
      ms(10_500);
      expect(getSnapshot().status).toBe("idle");
    });

    it("routeChanged() when nothing is loading is a no-op", () => {
      routeChanged();
      ms(500);
      expect(getSnapshot().status).toBe("idle");
    });
  });

  it("notifies subscribers on change and returns a stable snapshot when nothing changed", () => {
    const listener = vi.fn();
    const off = subscribe(listener);
    const a = getSnapshot();
    expect(getSnapshot()).toBe(a);
    start();
    expect(listener).toHaveBeenCalled();
    off();
    const calls = listener.mock.calls.length;
    ms(500);
    expect(listener.mock.calls.length).toBe(calls);
  });
});
