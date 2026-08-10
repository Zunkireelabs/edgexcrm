"use client";

// URL-backed advanced-filter state — the only URL-backed filter state in the
// app today is use-workspace-filters.ts (industries/it-agency/features/
// project-board/hooks/); this hook follows its shape (useSearchParams +
// router.replace(..., { scroll: false })), but adds the Phase 1 wire format
// (base64url `?f=`) instead of one param per filter axis.
//
// A malformed or stale `?f=` must degrade with a toast, never crash — drop
// unknown field keys (a renamed/removed registry field) and keep the rest.
// MAX_ENCODED_LEN is enforced here too (client-side), not just server-side in
// decodeFilterTree, so a caller gets a real message ("save this as a view")
// instead of a silent write that the next page load then rejects.

import { useCallback, useEffect, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { toast } from "sonner";
import { decodeFilterTree, encodeFilterTree, FILTER_PARAM, isEmptyTree, MAX_ENCODED_LEN } from "./serialize";
import { EMPTY_TREE, type FieldRegistry, type FilterCondition, type FilterTree } from "./types";

export interface UseAdvancedFiltersResult {
  tree: FilterTree;
  setTree: (next: FilterTree) => void;
  clear: () => void;
  /** Raw `?f=` value currently on the URL, or null if absent. */
  encoded: string | null;
}

type Degrade = "invalid" | "unknown_field" | null;

function decodeAndDegrade(raw: string | null, registry: FieldRegistry): { tree: FilterTree; degrade: Degrade } {
  if (!raw) return { tree: EMPTY_TREE, degrade: null };

  const decoded = decodeFilterTree(raw);
  if (!decoded.ok) return { tree: EMPTY_TREE, degrade: "invalid" };

  const isKnown = (c: FilterCondition) => registry[c.field] !== undefined;
  const hasUnknown =
    decoded.tree.conditions.some((c) => !isKnown(c)) || (decoded.tree.groups ?? []).some((g) => g.conditions.some((c) => !isKnown(c)));
  if (!hasUnknown) return { tree: decoded.tree, degrade: null };

  return {
    degrade: "unknown_field",
    tree: {
      conjunction: decoded.tree.conjunction,
      conditions: decoded.tree.conditions.filter(isKnown),
      groups: (decoded.tree.groups ?? [])
        .map((g) => ({ ...g, conditions: g.conditions.filter(isKnown) }))
        .filter((g) => g.conditions.length > 0),
    },
  };
}

export function useAdvancedFilters(registry: FieldRegistry): UseAdvancedFiltersResult {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const raw = searchParams.get(FILTER_PARAM);

  // Pure — no side effects during render (the "cannot access/update refs
  // during render" rule applies to any mutable state, not just useRef; a
  // dedup-per-raw-value ref belongs in the effect below, not here).
  const { tree, degrade } = useMemo(() => decodeAndDegrade(raw, registry), [raw, registry]);

  useEffect(() => {
    if (degrade === "invalid") toast.error("Couldn't read that filter link — it was reset.");
    else if (degrade === "unknown_field") toast.error("Some filters referenced fields that no longer exist and were removed.");
    // Re-fires only when `raw` (or the degrade outcome) actually changes —
    // effects don't re-run on unrelated re-renders, so no manual dedup needed.
  }, [raw, degrade]);

  const setTree = useCallback(
    (next: FilterTree) => {
      const params = new URLSearchParams(searchParams.toString());

      if (isEmptyTree(next)) {
        params.delete(FILTER_PARAM);
      } else {
        const encoded = encodeFilterTree(next);
        if (encoded.length > MAX_ENCODED_LEN) {
          toast.error("This filter has too many values to fit in a link — save it as a view instead.");
          return;
        }
        params.set(FILTER_PARAM, encoded);
      }

      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  const clear = useCallback(() => setTree(EMPTY_TREE), [setTree]);

  return { tree, setTree, clear, encoded: raw };
}
