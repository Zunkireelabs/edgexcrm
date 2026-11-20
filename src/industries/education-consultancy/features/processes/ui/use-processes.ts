"use client";

import { useEffect, useState } from "react";

interface State<T> {
  data: T | null;
  loading: boolean;
  error: boolean;
}

/** GET a Processes endpoint, re-fetching when the url or `tick` changes. */
export function useProcessesFetch<T>(url: string): State<T> & { reload: () => void } {
  const [state, setState] = useState<State<T>>({ data: null, loading: true, error: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
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
        if (e?.name !== "AbortError") setState({ data: null, loading: false, error: true });
      });
    return () => ctl.abort();
  }, [url, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}
