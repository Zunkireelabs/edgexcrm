"use client";

import { useEffect, useState } from "react";
import type { ApplicationStage } from "@/types/database";

/**
 * The Status list for an Add Application form: only the statuses of the pipeline that matches the
 * selected Destination (falling back to the default pipeline while none is chosen), fetched from
 * GET /api/v1/application-stages?country=… — which uses the server's own country→pipeline resolver,
 * the same rule that decides the pipeline when the application is saved.
 *
 * Before this, the form listed every stage of every country pipeline (each name once per country), and
 * a status from another country's pipeline was silently replaced when the application was saved.
 *
 * `fallback` (the full list the page already has) is used only while loading or if the request fails, so
 * the form is never left without options; `loading` lets the caller disable the dropdown meanwhile.
 */
export function useApplicationStatusOptions(
  country: string | undefined,
  enabled: boolean,
  fallback: ApplicationStage[]
): { stages: ApplicationStage[]; loading: boolean } {
  const key = country ?? "";
  // The latest answer, tagged with the destination it was for. Loading = "no answer for the current
  // destination yet", so nothing has to be set synchronously and a slow, older answer (for a previous
  // destination) can never be mistaken for the current one.
  const [result, setResult] = useState<{ key: string; stages: ApplicationStage[] | null } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch(`/api/v1/application-stages?country=${encodeURIComponent(key)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("stages request failed"))))
      .then((json) => {
        if (!cancelled) setResult({ key, stages: (json.data ?? []) as ApplicationStage[] });
      })
      .catch(() => {
        if (!cancelled) setResult({ key, stages: null });
      });
    return () => {
      cancelled = true;
    };
  }, [key, enabled]);

  const settled = result !== null && result.key === key;
  const options = settled ? result.stages : null;
  return {
    stages: options && options.length > 0 ? options : fallback,
    loading: enabled && !settled,
  };
}
