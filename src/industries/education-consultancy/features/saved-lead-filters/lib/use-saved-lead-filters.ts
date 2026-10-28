"use client";

import { useCallback, useState } from "react";
import type { FilterTree } from "@/lib/filters/types";

export interface SavedLeadFilter {
  id: string;
  name: string;
  filter_tree: FilterTree;
  created_at: string;
}

const ENDPOINT = "/api/v1/saved-lead-filters";

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const json = await res.json();
    const details = json?.error?.details as Record<string, string[]> | undefined;
    const first = details ? Object.values(details).flat()[0] : undefined;
    return first ?? json?.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function useSavedLeadFilters() {
  const [filters, setFilters] = useState<SavedLeadFilter[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(ENDPOINT);
      if (!res.ok) throw new Error(await readError(res, "Could not load saved filters"));
      const json = await res.json();
      setFilters((json.data ?? []) as SavedLeadFilter[]);
      setLoaded(true);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Could not load saved filters";
    } finally {
      setLoading(false);
    }
  }, []);

  /** Returns an error message, or null on success. */
  const save = useCallback(async (name: string, tree: FilterTree): Promise<string | null> => {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, filter_tree: tree }),
      });
      if (!res.ok) return await readError(res, "Could not save the filter");
      const json = await res.json();
      setFilters((prev) => [...prev, json.data as SavedLeadFilter]);
      return null;
    } catch {
      return "Could not save the filter";
    }
  }, []);

  const remove = useCallback(async (id: string): Promise<string | null> => {
    try {
      const res = await fetch(`${ENDPOINT}/${id}`, { method: "DELETE" });
      if (!res.ok) return await readError(res, "Could not delete the filter");
      setFilters((prev) => prev.filter((f) => f.id !== id));
      return null;
    } catch {
      return "Could not delete the filter";
    }
  }, []);

  return { filters, loading, loaded, load, save, remove };
}
