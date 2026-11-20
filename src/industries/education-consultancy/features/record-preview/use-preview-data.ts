"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TASK_CHANGED_EVENT } from "@/lib/tasks/task-events";
import type { TouchKind } from "./lib/labels";

export interface PreviewActivity {
  id: string;
  at: string;
  actor_id: string | null;
  actor_name: string | null;
  source: string | null;
  /** call | email | meeting | note, or an audit kind (stage, assigned, submission, consent, created, …). */
  kind: string;
  verb: string;
  object: string | null;
  snippet: string | null;
}

export interface PreviewPayload {
  tasks: { open_count: number; items: Array<{ id: string; title: string; due_date: string | null; assignee_id: string | null; assignee_name: string | null }> };
  notes: { count: number; latest: { content: string; author_id: string; author_name: string | null; created_at: string } | null };
  last_touch: { kind: TouchKind; who_id: string; who_name: string | null; at: string } | null;
  readiness: { ready: boolean; items: string[]; consent_signed_at: string | null; has_active_consent_template: boolean; fee_status: string | null };
  applications: { count: number; items: Array<{ id: string; university: string; program: string; status: string; stage_name: string | null; stage_color: string | null; terminal_type: string | null }> };
  activity: PreviewActivity[];
  intake: string | null;
  branch_name: string | null;
  source_name: string | null;
  assignee_name: string | null;
}

/**
 * Preview payload for one lead: cached per lead id for the panel's lifetime, stale responses ignored/aborted when the
 * user moves on, the next lead prefetched once the current one has loaded. `invalidate(id)` refetches after a write.
 */
export function usePreviewData(leadId: string, prefetchId: string | null, feed: "top" | "all") {
  const cache = useRef(new Map<string, PreviewPayload>());
  const inflight = useRef(new Map<string, AbortController>());
  const [, bump] = useState(0);
  const [error, setError] = useState(false);

  const key = (id: string, f: "top" | "all") => `${id}:${f}`;

  const load = useCallback(async (id: string, f: "top" | "all", opts?: { force?: boolean }) => {
    const k = key(id, f);
    if (!opts?.force && cache.current.has(k)) return;
    inflight.current.get(k)?.abort();
    const ac = new AbortController();
    inflight.current.set(k, ac);
    try {
      const res = await fetch(`/api/v1/leads/${id}/preview${f === "all" ? "?feed=all" : ""}`, { signal: ac.signal });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { data: PreviewPayload };
      cache.current.set(k, json.data);
      setError(false);
      bump((n) => n + 1);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(true);
    } finally {
      if (inflight.current.get(k) === ac) inflight.current.delete(k);
    }
  }, []);

  useEffect(() => {
    setError(false);
    void load(leadId, feed).then(() => {
      if (prefetchId) void load(prefetchId, "top");
    });
    const pending = inflight.current;
    return () => {
      // Moving on: drop the request for the lead we're leaving (a prefetch of the NEXT lead is left alone).
      pending.get(key(leadId, feed))?.abort();
    };
  }, [leadId, prefetchId, feed, load]);

  const invalidate = useCallback((id: string) => {
    cache.current.delete(key(id, "top"));
    cache.current.delete(key(id, "all"));
    bump((n) => n + 1);
    void load(id, feed, { force: true });
  }, [feed, load]);

  return {
    data: cache.current.get(key(leadId, "top")) ?? cache.current.get(key(leadId, "all")) ?? null,
    /** The 50-row feed for the Activity tab; null until it has loaded. */
    full: cache.current.get(key(leadId, "all")) ?? null,
    error,
    invalidate,
  };
}

/** Task edits made elsewhere (the /tasks/<id> drawer, email composer, Overview checkbox) refresh the open preview. */
export function useTaskChangedRefresh(leadId: string, invalidate: (id: string) => void) {
  useEffect(() => {
    const onTaskChanged = () => invalidate(leadId);
    window.addEventListener(TASK_CHANGED_EVENT, onTaskChanged);
    return () => window.removeEventListener(TASK_CHANGED_EVENT, onTaskChanged);
  }, [invalidate, leadId]);
}
