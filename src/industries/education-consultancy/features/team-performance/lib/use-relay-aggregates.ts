"use client";

import { useEffect, useState } from "react";
import type { RelayAggregateRow } from "./types";

const URL = "/api/v1/insights/education/relay-aggregates?window=today";

// edu-team-relay and edu-branch-breakdown both need the same relay-aggregates
// payload — a module-level in-flight-request cache so mounting both on one
// dashboard doesn't fire the same tenant-scoped RPC twice. Scoped to this one
// endpoint rather than touching the shared use-widget-data.ts (used by every
// other widget in the app).
let inFlight: Promise<RelayAggregateRow[]> | null = null;

async function fetchRelayAggregates(): Promise<RelayAggregateRow[]> {
  if (!inFlight) {
    inFlight = fetch(URL)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j) => j.data as RelayAggregateRow[])
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export function useRelayAggregates() {
  const [data, setData] = useState<RelayAggregateRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    // Mount-only effect (deps []) — initial state above already matches
    // loading=true/error=false, no need to reset them here.
    fetchRelayAggregates()
      .then((rows) => {
        if (alive) setData(rows);
      })
      .catch(() => {
        if (alive) setError(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { data, loading, error };
}
