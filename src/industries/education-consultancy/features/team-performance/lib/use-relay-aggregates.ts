"use client";

import { useEffect, useState } from "react";
import { dateWindowToQuery, type DateWindowSelection } from "@/industries/_shared/features/insights/lib/use-date-window";
import type { RelayAggregateRow } from "./types";

// edu-team-relay and edu-branch-breakdown both need the same relay-aggregates
// payload for the same window — a module-level in-flight-request cache, keyed
// by the full URL (window+from+to), so mounting both on one dashboard doesn't
// fire the same tenant-scoped RPC twice, and switching the date-window filter
// doesn't serve stale data from a previous window's in-flight entry. Scoped to
// this one endpoint rather than touching the shared use-widget-data.ts (used
// by every other widget in the app).
const inFlight = new Map<string, Promise<RelayAggregateRow[]>>();

function fetchRelayAggregates(url: string): Promise<RelayAggregateRow[]> {
  let promise = inFlight.get(url);
  if (!promise) {
    promise = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j) => j.data as RelayAggregateRow[])
      .finally(() => {
        inFlight.delete(url);
      });
    inFlight.set(url, promise);
  }
  return promise;
}

export function useRelayAggregates(window: DateWindowSelection) {
  const [data, setData] = useState<RelayAggregateRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const url = `/api/v1/insights/education/relay-aggregates?${dateWindowToQuery(window)}`;

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!alive) return;
      setLoading(true);
      setError(false);
      try {
        const rows = await fetchRelayAggregates(url);
        if (alive) setData(rows);
      } catch {
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [url]);

  return { data, loading, error };
}
