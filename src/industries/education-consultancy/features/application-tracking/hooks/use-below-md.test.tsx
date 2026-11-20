// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { BELOW_MD_QUERY, useBelowMd } from "./use-below-md";

type Listener = () => void;

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  const mq = {
    matches: initial,
    media: "",
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  };
  const matchMedia = vi.fn((q: string) => {
    mq.media = q;
    return mq;
  });
  Object.defineProperty(window, "matchMedia", { value: matchMedia, configurable: true, writable: true });
  return {
    matchMedia,
    listeners,
    set(next: boolean) {
      mq.matches = next;
      listeners.forEach((l) => l());
    },
  };
}

afterEach(() => cleanup());

describe("useBelowMd", () => {
  it("queries max-width 767px (Tailwind md - 1), not lead detail's 430px", () => {
    expect(BELOW_MD_QUERY).toBe("(max-width: 767px)");
  });

  it("is false on the server render", () => {
    function Probe() {
      return <span>{String(useBelowMd())}</span>;
    }
    expect(renderToStaticMarkup(<Probe />)).toBe("<span>false</span>");
  });

  it("follows the media query and unsubscribes on unmount", () => {
    const mm = stubMatchMedia(true);
    const { result, unmount } = renderHook(() => useBelowMd());
    expect(mm.matchMedia).toHaveBeenCalledWith("(max-width: 767px)");
    expect(result.current).toBe(true);
    act(() => mm.set(false));
    expect(result.current).toBe(false);
    act(() => mm.set(true));
    expect(result.current).toBe(true);
    unmount();
    expect(mm.listeners.size).toBe(0);
  });

  it("stays false at md and up", () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useBelowMd());
    expect(result.current).toBe(false);
  });
});
