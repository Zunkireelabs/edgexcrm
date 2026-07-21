"use client";

import { useState, useEffect, useCallback } from "react";

export interface CadenceStepItem {
  step_order: number;
  state: "pending" | "sent" | "skipped" | "projected";
  subject: string;
  due_at?: string;
  sent_at?: string | null;
  draft_id?: string;
  sent_activity_id?: string | null;
  body_html?: string;
  projected_due_at?: string;
}

export interface CadenceData {
  enrollment: {
    id: string;
    status: "active" | "paused" | "completed" | "unenrolled";
    current_step_order: number;
    assigned_to: string | null;
  };
  sequence: { id: string; name: string; total_steps: number };
  timeline: CadenceStepItem[];
}

/** Fetches the composed cadence timeline for one enrollment; null enrollmentId is a no-op. */
export function useCadence(enrollmentId: string | null) {
  const [data, setData] = useState<CadenceData | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enrollmentId) {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/outreach/enrollments/${enrollmentId}/cadence`);
      if (res.ok) {
        const json = await res.json();
        setData(json.data ?? null);
      } else {
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  }, [enrollmentId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, refresh };
}
