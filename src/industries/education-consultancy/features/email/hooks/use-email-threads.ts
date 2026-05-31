"use client";

import { useState, useEffect, useCallback } from "react";

export interface Email {
  id: string;
  direction: "outbound" | "inbound";
  from_email: string;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string;
  body_html: string;
  sent_at: string | null;
  received_at: string | null;
  sender_user_id: string | null;
  in_reply_to: string | null;
  rfc_references: string[];
  rfc_message_id: string | null;
  gmail_message_id: string;
}

export interface EmailThread {
  id: string;
  connected_email_account_id: string;
  gmail_thread_id: string;
  lead_id: string | null;
  contact_id: string | null;
  subject: string;
  last_message_at: string;
  message_count: number;
  emails: Email[];
  created_at: string;
  updated_at: string;
}

export function useEmailThreads(leadId: string) {
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!leadId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/email/threads?lead_id=${encodeURIComponent(leadId)}`);
      if (res.ok) {
        const json = await res.json();
        // Sort embedded messages oldest→newest per thread
        const sorted: EmailThread[] = (json.data ?? []).map((t: EmailThread) => ({
          ...t,
          emails: [...t.emails].sort((a, b) => {
            const aTime = a.sent_at ?? a.received_at ?? "";
            const bTime = b.sent_at ?? b.received_at ?? "";
            return aTime.localeCompare(bTime);
          }),
        }));
        setThreads(sorted);
      }
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { threads, setThreads, loading, refresh };
}
