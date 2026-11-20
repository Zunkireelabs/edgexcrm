"use client";

import { useEffect, useState } from "react";

/**
 * The Applications phone breakpoint (EDGEX-141 Phase 5): below Tailwind's `md` (768px), the same
 * breakpoint the dashboard shell uses for its drawer. Layout-only differences use `max-md:` / `md:`
 * classes; this hook is only for behaviour (sheet vs popover, no drag, rows vs table).
 * Lead detail keeps its own 430px hook (lead-detail/lib/use-phone.ts).
 */
export const BELOW_MD_QUERY = "(max-width: 767px)";

/** Synchronous read for client-only code paths (never during SSR or the hydration render). */
export function matchesBelowMd(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(BELOW_MD_QUERY).matches;
}

/** True below 768px. Starts false (server render and first paint) and follows the media query. */
export function useBelowMd(): boolean {
  const [below, setBelow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(BELOW_MD_QUERY);
    const update = () => setBelow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return below;
}
