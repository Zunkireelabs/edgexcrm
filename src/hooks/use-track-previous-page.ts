"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export const PREVIOUS_PAGE_KEY = "edgex:pre-lead-page";

// Matches the lead DETAIL route (/leads/<uuid>) specifically — not /leads or
// /leads-organise, which are real origins worth remembering.
const LEAD_DETAIL_RE = /^\/leads\/[0-9a-f-]{36}(?:\/|$)/i;

/**
 * Remembers the last non-lead-detail page the user was on, in sessionStorage,
 * so the Lead Detail page's back button can return to the actual page the
 * user came from (All Leads, Pipeline, Applications, Check-in, etc.) instead
 * of blindly calling router.back(), which can land somewhere unexpected —
 * or nowhere — depending on browser history. Mounted once in DashboardShell,
 * so every entry point into a lead's detail page is covered automatically,
 * with no per-link wiring needed.
 */
export function useTrackPreviousPage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname || LEAD_DETAIL_RE.test(pathname)) return;
    const query = searchParams.toString();
    const href = query ? `${pathname}?${query}` : pathname;
    try {
      sessionStorage.setItem(PREVIOUS_PAGE_KEY, href);
    } catch {
      // sessionStorage unavailable (private mode, etc.) — back button falls
      // back to the default destination.
    }
  }, [pathname, searchParams]);
}
