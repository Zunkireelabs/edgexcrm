"use client";

import { useState, useEffect } from "react";

export interface CompanySender {
  email: string;
  display_name: string;
}

/**
 * The tenant's verified company sender, or null when there is none (or the
 * request failed). Failure just hides the option — it must never block the
 * dialog, which still works with a connected Gmail.
 */
export function useCompanySender() {
  const [companySender, setCompanySender] = useState<CompanySender | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/email/company-sender");
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) setCompanySender(json.data ?? null);
        }
      } catch {
        // leave null
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { companySender, loading };
}
