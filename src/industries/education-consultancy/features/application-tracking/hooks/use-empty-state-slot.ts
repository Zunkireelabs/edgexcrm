"use client";

import { useCallback, useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

/** Width of the band the empty state occupies (its text column is max 340px). */
const BAND_PX = 360;
const GAP_PX = 16;

/**
 * Where the board's empty state may sit (fix round 2, A2): below every column that overlaps its
 * centre band, and above the board's horizontal scrollbar. The caller centres the state inside this
 * box, so it never covers a column or the scrollbar at any viewport size; if the box is shorter than
 * the state, the box scrolls rather than overlapping.
 */
export function useEmptyStateSlot(containerRef: RefObject<HTMLElement | null>, active: boolean): CSSProperties {
  const [slot, setSlot] = useState<{ top: number; bottom: number }>({ top: 0, bottom: 0 });

  const measure = useCallback(() => {
    const box = containerRef.current;
    if (!box) return;
    const c = box.getBoundingClientRect();
    const bandL = c.left + (c.width - BAND_PX) / 2;
    const bandR = bandL + BAND_PX;
    let top = 0;
    box.querySelectorAll<HTMLElement>("[data-testid=board-column],[data-testid=slim-column],[data-board-chrome]").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= bandL || r.left >= bandR) return;
      top = Math.max(top, r.bottom - c.top + GAP_PX);
    });
    const board = box.querySelector<HTMLElement>("[data-testid=applications-board]");
    const scrollbar = board ? Math.max(0, board.offsetHeight - board.clientHeight) : 0;
    const bottom = scrollbar + (board ? Math.max(0, c.bottom - board.getBoundingClientRect().bottom) : 0) + 4;
    setSlot((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
  }, [containerRef]);

  useLayoutEffect(() => {
    if (!active) return;
    const box = containerRef.current;
    if (!box) return;
    // The board mounts its columns a tick after hydration (prefs live in localStorage).
    const t = setTimeout(measure, 0);
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    const mo = new MutationObserver(measure);
    mo.observe(box, { childList: true, subtree: true });
    // Horizontal board scroll moves columns in/out of the band (scroll doesn't bubble: capture it).
    box.addEventListener("scroll", measure, { capture: true, passive: true });
    return () => {
      clearTimeout(t);
      ro.disconnect();
      mo.disconnect();
      box.removeEventListener("scroll", measure, { capture: true });
    };
  }, [active, containerRef, measure]);

  return { top: slot.top, bottom: slot.bottom, justifyContent: "safe center" };
}
