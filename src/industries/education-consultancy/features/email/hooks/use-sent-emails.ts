"use client";

import { useState, useEffect, useCallback } from "react";

export interface SentEmail {
  id: string;
  thread_id: string;
  direction: string;
  from_email: string;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string;
  body_html: string;
  sent_at: string;
  sender_user_id: string;
  email_threads: { id: string; lead_id: string | null; contact_id: string | null };
}

export function useSentEmails(leadId: string) {
  const [emails, setEmails] = useState<SentEmail[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/email/threads?lead_id=${encodeURIComponent(leadId)}`);
      if (res.ok) {
        const json = await res.json();
        setEmails(json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { emails, setEmails, loading, refresh };
}
