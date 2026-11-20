// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { PHONE_MAX, PHONE_QUERY, usePhone } from "./use-phone";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function stubMatchMedia(initial: boolean) {
  let listener: (() => void) | null = null;
  const mq = {
    matches: initial,
    addEventListener: (_: string, l: () => void) => { listener = l; },
    removeEventListener: () => { listener = null; },
  };
  vi.stubGlobal("matchMedia", (q: string) => { expect(q).toBe(PHONE_QUERY); return mq; });
  return { set: (v: boolean) => { mq.matches = v; listener?.(); } };
}

describe("usePhone", () => {
  it("the phone breakpoint is 430px", () => expect(PHONE_QUERY).toBe(`(max-width: ${PHONE_MAX}px)`));
  it("is false on desktop, true on a phone, and follows a resize", () => {
    const m = stubMatchMedia(false);
    const { result } = renderHook(() => usePhone());
    expect(result.current).toBe(false);
    act(() => m.set(true));
    expect(result.current).toBe(true);
    act(() => m.set(false));
    expect(result.current).toBe(false);
  });
  it("starts as a phone when the query already matches", () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => usePhone());
    expect(result.current).toBe(true);
  });
});
