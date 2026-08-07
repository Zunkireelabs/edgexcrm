"use client";

// Single place option lists for select/multiselect/uuid/relation fields come
// from, so the field picker + value editor never fire a request per dropdown
// open. Phase 3's only consumer (leads-table.tsx) supplies every list it
// needs via `optionOverrides` — the leads-table already computes them (sources,
// counselors, forms, tags, industries) for the legacy FilterMenu, so Phase 3
// reuses those exact arrays rather than re-fetching. A field with a static
// `field.options` on its FieldDef (the registry-declared, non-dynamic case)
// never consults this hook at all.
//
// `optionOverrides` is the reason this hook has no fetch logic yet: every
// surface built so far (leads table) can supply its lists synchronously from
// already-loaded data. A real async loader (e.g. for a field with no natural
// host-side list) is additive — a `loading` flag already exists on the return
// shape for exactly that, unused until a caller needs it.

import { useCallback } from "react";
import type { FieldDef } from "@/lib/filters/types";
import type { FilterOption, OptionLoaderKey } from "./types";

export interface UseFilterOptionsResult {
  getOptions: (field: FieldDef) => FilterOption[];
  isLoading: (key: OptionLoaderKey) => boolean;
}

export function useFilterOptions(optionOverrides?: Partial<Record<OptionLoaderKey, FilterOption[]>>): UseFilterOptionsResult {
  const getOptions = useCallback(
    (field: FieldDef): FilterOption[] => {
      if (field.options && field.options.length > 0) return field.options;
      return optionOverrides?.[field.key] ?? [];
    },
    [optionOverrides]
  );

  // No field currently has an async-only source in Phase 3 — every one is
  // either static (`field.options`) or host-supplied (`optionOverrides`).
  const isLoading = useCallback((key: OptionLoaderKey) => (void key, false), []);

  return { getOptions, isLoading };
}
