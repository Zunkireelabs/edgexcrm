"use client";

import { useEffect, useState } from "react";
import type { PulseEventsResponse, PulsePersonResponse, PulseResponse } from "../lib/types";

export interface WindowSelection {
  key: "24h" | "7d" | "30d" | "custom";
  from?: string;
  to?: string;
}

export function windowQuery(w: WindowSelection): string {
  const p = new URLSearchParams({ window: w.key });
  if (w.key === "custom" && w.from && w.to) {
    p.set("from", w.from);
    p.set("to", w.to);
  }
  return p.toString();
}

interface State<T> {
  data: T | null;
  loading: boolean;
  error: boolean;
}

/** GET a Pulse endpoint, re-fetching when the url changes. `url = null` means "don't fetch". */
export function usePulseFetch<T>(url: string | null, reloadKey = 0): State<T> & { reload: () => void } {
  const [state, setState] = useState<State<T>>({ data: null, loading: !!url, error: false });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!url) return;
    const ctl = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-change loading flag
    setState((s) => ({ ...s, loading: true, error: false }));
    fetch(url, { signal: ctl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j) => setState({ data: j.data as T, loading: false, error: false }))
      .catch((e) => {
        // Drop the previous window's data on error: stale numbers under an error banner would read as current.
        if (e?.name !== "AbortError") setState({ data: null, loading: false, error: true });
      });
    return () => ctl.abort();
  }, [url, reloadKey, tick]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}

export const usePulse = (w: WindowSelection, reloadKey = 0) =>
  usePulseFetch<PulseResponse>(w.key === "custom" && !(w.from && w.to) ? null : `/api/v1/pulse?${windowQuery(w)}`, reloadKey);

export const usePulseEvents = (qs: string | null) =>
  usePulseFetch<PulseEventsResponse>(qs ? `/api/v1/pulse/events?${qs}` : null);

export const usePulsePerson = (userId: string | null, w: WindowSelection) =>
  usePulseFetch<PulsePersonResponse>(userId ? `/api/v1/pulse/people/${userId}?${windowQuery(w)}` : null);
