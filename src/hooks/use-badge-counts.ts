"use client";

import { useState, useEffect, useCallback } from "react";

interface BadgeCounts {
  unread_notifications: number;
  unread_leads: number;
  unread_lead_ids: string[];
}

const DEFAULT_COUNTS: BadgeCounts = { unread_notifications: 0, unread_leads: 0, unread_lead_ids: [] };

async function fetchCounts(): Promise<BadgeCounts | null> {
  try {
    const res = await fetch("/api/v1/badge-counts");
    if (!res.ok) return null;
    const json = await res.json();
    return json.data ?? null;
  } catch {
    // Non-fatal — silently ignore network errors
    return null;
  }
}

export function useBadgeCounts() {
  const [counts, setCounts] = useState<BadgeCounts>(DEFAULT_COUNTS);

  // Exposed for callers that want to force a refresh (e.g. after opening a lead).
  const refresh = useCallback(async () => {
    const data = await fetchCounts();
    if (data) setCounts(data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const data = await fetchCounts();
      if (!cancelled && data) setCounts(data);
    };
    load();
    const interval = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { counts, refresh };
}
