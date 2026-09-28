"use client";

import { useSearchParams } from "next/navigation";
import { DATE_WINDOW_PRESETS, isDateWindowKey, type DateWindowKey } from "./date-window";

export interface DateWindowSelection {
  key: DateWindowKey;
  label: string;
  from?: string;
  to?: string;
}

/**
 * Reads the active date-window selection from `?window=&from=&to=` — the
 * client-side counterpart to resolveDateWindow (which routes call server-side
 * with the same params). Defaults to "today" when absent, matching the
 * routes' own default.
 */
export function useDateWindow(): DateWindowSelection {
  const searchParams = useSearchParams();
  const rawKey = searchParams.get("window") ?? "today";
  const key = isDateWindowKey(rawKey) ? rawKey : "today";
  const preset = DATE_WINDOW_PRESETS.find((p) => p.key === key)!;

  if (key === "custom") {
    const from = searchParams.get("from") ?? undefined;
    const to = searchParams.get("to") ?? undefined;
    return { key, label: preset.label, from, to };
  }

  return { key, label: preset.label };
}

/** Builds the `?window=&from=&to=` query string for a given selection. */
export function dateWindowToQuery(selection: DateWindowSelection): string {
  const params = new URLSearchParams();
  params.set("window", selection.key);
  if (selection.key === "custom") {
    if (selection.from) params.set("from", selection.from);
    if (selection.to) params.set("to", selection.to);
  }
  return params.toString();
}
