"use client";

import { useEffect, useState } from "react";
import { NavCountPill } from "@/components/dashboard/nav-primitives";

/**
 * Self-contained nav badge for the /orca/review item — deliberately isolated
 * from useBadgeCounts (which is fetched from the dashboard shell regardless
 * of role) since this count is owner/admin-only; keeping it in its own
 * component means non-admins never issue the request at all.
 */
export function ReviewNavBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/v1/agent-outputs/pending-count");
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setCount(json.data?.count ?? 0);
      } catch {
        // Non-fatal — silently ignore network errors
      }
    }
    load();
    const interval = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (count === 0) return null;

  return <NavCountPill>{count > 9 ? "9+" : count}</NavCountPill>;
}
