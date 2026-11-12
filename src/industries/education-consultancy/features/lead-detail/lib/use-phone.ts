"use client";

import { useEffect, useState } from "react";

/**
 * The phone breakpoint of the education lead detail (EDGEX-156): 430px and below. Same threshold the page already uses for the
 * icon-only quick actions and the 74px highlight cards; between 431 and 767px the stacked layout keeps the desktop tab row.
 */
export const PHONE_MAX = 430;
export const PHONE_QUERY = `(max-width: ${PHONE_MAX}px)`;

/** True at phone width. Starts false (server render and first paint) and follows the media query. */
export function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return phone;
}
