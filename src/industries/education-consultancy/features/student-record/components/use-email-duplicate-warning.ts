"use client";

import { useCallback, useRef, useState } from "react";

interface EmailCheck {
  duplicate: boolean;
  count: number;
  /** Owners and admins only: which lead(s). Everyone else gets just the count. */
  leads?: { id: string; display_id: string | null; name: string | null }[];
}

/** The sentence shown under the Email box. Pure so it is easy to test. */
export function emailWarningText(c: EmailCheck | null): string | null {
  if (!c || !c.duplicate || c.count < 1) return null;
  if (c.leads && c.leads.length > 0) {
    const label = (l: { display_id: string | null; name: string | null }) => [l.display_id, l.name].filter(Boolean).join(" · ") || "another lead";
    const shown = c.leads.slice(0, 3).map(label).join(", ");
    const more = c.count > 3 ? ` and ${c.count - 3} more` : "";
    return `${c.count === 1 ? "Another lead already has" : "Other leads already have"} this email: ${shown}${more}.`;
  }
  return c.count === 1 ? "Another lead already has this email." : `${c.count} other leads already have this email.`;
}

/**
 * Edit profile: when the person leaves the Email box, ask whether another lead already has that email and keep a warning
 * to show under the box. Only ever a warning: it never blocks the save, and any failure just shows nothing.
 */
export function useEmailDuplicateWarning(leadId: string) {
  const [message, setMessage] = useState<string | null>(null);
  const latest = useRef(0);

  const clear = useCallback(() => {
    latest.current += 1; // anything still on its way is now out of date
    setMessage(null);
  }, []);

  const check = useCallback(async (email: string, savedEmail: string) => {
    const typed = email.trim();
    const ticket = ++latest.current;
    if (!typed || !typed.includes("@") || typed.toLowerCase() === savedEmail.trim().toLowerCase()) {
      setMessage(null);
      return;
    }
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/email-check?email=${encodeURIComponent(typed)}`);
      const body = res.ok ? ((await res.json()) as { data?: EmailCheck }) : null;
      if (ticket === latest.current) setMessage(emailWarningText(body?.data ?? null));
    } catch {
      if (ticket === latest.current) setMessage(null);
    }
  }, [leadId]);

  return { message, check, clear };
}
