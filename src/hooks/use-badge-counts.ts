"use client";

import { useState, useEffect, useCallback } from "react";

interface BadgeCounts {
  unread_notifications: number;
  new_leads: number;
}

const DEFAULT_COUNTS: BadgeCounts = { unread_notifications: 0, new_leads: 0 };

export function useBadgeCounts() {
  const [counts, setCounts] = useState<BadgeCounts>(DEFAULT_COUNTS);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/badge-counts");
      if (!res.ok) return;
      const json = await res.json();
      setCounts(json.data ?? DEFAULT_COUNTS);
    } catch {
      // Non-fatal — silently ignore network errors
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll every 30 seconds (same cadence as notifications dropdown)
  useEffect(() => {
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { counts, refresh };
}
