"use client";

import { useState, useEffect } from "react";
import type { BrandedBrand } from "@/lib/email/template/branded-message";

/** The tenant's second, no-reply sender with what the pop-up needs to draw the branded frame and the Preview. */
export interface NoReplySenderInfo {
  email: string;
  display_name: string;
  brand: BrandedBrand;
}

export interface CompanySender {
  email: string;
  display_name: string;
  /** Only present when an admin has set the no-reply address up (Settings → Email Sender Identity). */
  no_reply?: NoReplySenderInfo | null;
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
