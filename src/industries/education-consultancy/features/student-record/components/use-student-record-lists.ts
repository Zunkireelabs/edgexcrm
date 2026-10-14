"use client";

import { useCallback, useEffect, useState } from "react";
import type { Lead } from "@/types/database";
import { onStudentRecordChanged } from "./student-record-events";
import { storedListsToState, type StoredLists, type StudentRecordLists } from "./student-record-lists";

export type StudentRecordListsStatus = "loading" | "ready" | "error";

const EMPTY: StudentRecordLists = { workExperience: [], references: [], testScores: [] };

/**
 * The lead's stored work experience, references and test scores, loaded from /api/v1/leads/[id]/student-record.
 * Reloads when another component saves them (see student-record-events.ts). While loading — or if it fails — the lists are empty and
 * `status` says so, so a screen can hold off editing instead of presenting an empty list that is really "not loaded".
 */
export function useStudentRecordLists(lead: Lead, enabled = true) {
  const [lists, setLists] = useState<StudentRecordLists>(EMPTY);
  const [status, setStatus] = useState<StudentRecordListsStatus>("loading");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/leads/${lead.id}/student-record`);
      if (!res.ok) throw new Error("load failed");
      const json = await res.json();
      setLists(storedListsToState((json?.data ?? {}) as StoredLists, lead));
      setStatus("ready");
    } catch {
      setStatus("error");
    }
    // `lead` is read only to merge the five legacy score columns; the lead id is what decides when to reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  useEffect(() => {
    if (!enabled) return;
    load();
  }, [enabled, load]);

  useEffect(() => (enabled ? onStudentRecordChanged(lead.id, load) : undefined), [enabled, lead.id, load]);

  return { lists, status, reload: load, setLists };
}
