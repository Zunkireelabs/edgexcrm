"use client";

import { useState, useEffect, useCallback } from "react";

export interface SequenceStep {
  id: string;
  step_order: number;
  delay_days: number;
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
  created_at: string;
  // OUTREACH-PHASE2-BRIEF.md §4/§6 — sequence-level auto-send flag. Defaults
  // false everywhere it_agency already has sequences; only a tenant whose
  // industry manifest registers Outreach with the flag surfaced in the
  // editor (currently education_consultancy) can ever set this true.
  auto_send: boolean;
  email_sequence_steps: SequenceStep[];
}

export function useSequences() {
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/outreach/sequences");
      if (res.ok) {
        const json = await res.json();
        setSequences(json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { sequences, loading, refresh };
}
