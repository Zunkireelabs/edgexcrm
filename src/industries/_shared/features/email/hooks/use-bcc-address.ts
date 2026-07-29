"use client";

import { useState, useEffect, useCallback } from "react";

export function useBccAddress() {
  const [address, setAddress] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/email/bcc-address");
      if (res.status === 404) {
        setEnabled(false);
        setAddress(null);
        return;
      }
      if (res.ok) {
        const json = await res.json();
        setEnabled(true);
        setAddress(json.data?.address ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const regenerate = useCallback(async (): Promise<boolean> => {
    const res = await fetch("/api/v1/email/bcc-address", { method: "POST" });
    if (!res.ok) return false;
    const json = await res.json();
    setAddress(json.data?.address ?? null);
    return true;
  }, []);

  return { address, enabled, loading, refresh, regenerate };
}
