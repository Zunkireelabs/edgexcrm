"use client";

import { useState, useEffect, useCallback } from "react";
import type { SendWindow } from "../lib/send-window";
import type { OutreachChannel } from "../lib/channel";

export interface SequenceStep {
  id: string;
  step_order: number;
  delay_days: number;
  send_time?: string | null;
  subject_template: string;
  body_template: string;
  draft_source: "template" | "ai";
  ai_instructions: string | null;
}

export interface Sequence {
  id: string;
  name: string;
  description: string | null;
  status: string;
  /** Which channel this sequence sends on (migration 274); fixed at creation. Absent on pre-274 rows = email. */
  channel?: OutreachChannel;
  created_at: string;
  // OUTREACH-PHASE2-BRIEF.md §4/§6 — sequence-level auto-send flag. Defaults
  // false everywhere it_agency already has sequences; only a tenant whose
  // industry manifest registers Outreach with the flag surfaced in the
  // editor (currently education_consultancy) can ever set this true.
  auto_send: boolean;
  // What a lead's reply does to their enrollment (migration 257).
  on_reply: "pause" | "end" | "continue";
  // When steps may go out (migration 260); null = as soon as due.
  send_window: SendWindow | null;
  email_sequence_steps: SequenceStep[];
}

export function useSequences(channel?: OutreachChannel) {
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(channel ? `/api/v1/outreach/sequences?channel=${channel}` : "/api/v1/outreach/sequences");
      if (res.ok) {
        const json = await res.json();
        setSequences(json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [channel]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { sequences, loading, refresh };
}
