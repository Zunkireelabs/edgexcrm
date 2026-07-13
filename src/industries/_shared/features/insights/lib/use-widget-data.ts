"use client";

import { useState, useEffect } from "react";

export function useWidgetData<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // HTTP status of the last response, so callers can distinguish e.g. a 403
  // (admin-only endpoint) from a real 500 and render a more specific state.
  const [status, setStatus] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!alive) return;
      setLoading(true);
      setError(false);
      setStatus(null);
      try {
        const r = await fetch(url);
        if (alive) setStatus(r.status);
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        if (alive) setData(j.data as T);
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

  return { data, loading, error, status };
}
