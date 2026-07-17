"use client";

import { useState, useEffect, useCallback } from "react";

export interface ConnectedInbox {
  id: string;
  email: string;
  display_name: string | null;
  provider: string;
  created_at: string;
  health: "ok" | "error";
  last_synced_at: string | null;
  last_error: string | null;
}

export function useConnectedInboxes() {
  const [inboxes, setInboxes] = useState<ConnectedInbox[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/email/inboxes");
      if (res.ok) {
        const json = await res.json();
        setInboxes(json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { inboxes, loading, refresh };
}
