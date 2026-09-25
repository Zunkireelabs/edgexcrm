"use client";

import { useEffect, useState } from "react";
import { PREVIOUS_PAGE_KEY } from "./use-track-previous-page";
import { DEFAULT_LEADS_BACK_DESTINATION, labelForPath } from "@/lib/leads/back-navigation";

export interface BackDestination {
  href: string;
  label: string;
}

/**
 * Reads the page the user was actually on before opening this lead (recorded
 * by useTrackPreviousPage, mounted app-wide in DashboardShell), so the Lead
 * Detail page's back button can show where it's going ("← Applications")
 * and navigate there directly — falling back to All Leads when nothing was
 * recorded (direct link, new tab, refresh, sessionStorage unavailable).
 *
 * Deliberately reads sessionStorage in an effect, not a lazy useState
 * initializer: this component is SSR'd (no `window`/sessionStorage on the
 * server), so the initial render must produce the same "All Leads" default
 * on both server and client to avoid a hydration mismatch. The effect update
 * happens one tick after mount, client-only, which is exactly what avoids
 * that mismatch — the generic "no setState in effects" lint rule doesn't
 * apply to this "sync from a client-only external store after mount" case.
 */
export function useLeadBackDestination(): BackDestination {
  const [destination, setDestination] = useState<BackDestination>(DEFAULT_LEADS_BACK_DESTINATION);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(PREVIOUS_PAGE_KEY);
      if (stored) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-time client-only sessionStorage read, see doc comment above
        setDestination({ href: stored, label: labelForPath(stored) });
      }
    } catch {
      // sessionStorage unavailable — keep the default.
    }
  }, []);

  return destination;
}
