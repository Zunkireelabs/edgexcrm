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

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { toast } from "sonner";
import { decodeFilterTree, encodeFilterTree, FILTER_PARAM, isEmptyTree, MAX_ENCODED_LEN } from "./serialize";
import { EMPTY_TREE, type FieldRegistry, type FilterCondition, type FilterTree } from "./types";

const STORAGE_PREFIX = "edgex:advanced-filters:";

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

// sessionStorage, not localStorage — deliberately: this should survive
// clicking around the app in one visit (Dashboard -> back to Leads), NOT
// persist indefinitely across browser restarts days later, which would
// silently pre-filter a list the user has long since forgotten setting.
// Wrapped — private browsing / storage-disabled must degrade to
// "no persistence", never throw and break the filter bar.
function readPersisted(key: string): string | null {
  try {
    return sessionStorage.getItem(STORAGE_PREFIX + key);
  } catch {
    return null;
  }
}

function writePersisted(key: string, encoded: string | null): void {
  try {
    if (encoded === null) sessionStorage.removeItem(STORAGE_PREFIX + key);
    else sessionStorage.setItem(STORAGE_PREFIX + key, encoded);
  } catch {
    // storage full / disabled — filters still work for this session via the URL
  }
}

/**
 * @param persistKey Scopes cross-navigation persistence (e.g.
 *   `${tenantId}:${userId}:${listSlug}`) — omit/null to opt out entirely
 *   (e.g. the SMS blast composer, which manages its own tree via useState,
 *   never calls this hook at all). When set: every setTree call is saved to
 *   sessionStorage under this key (survives in-app navigation, clears when
 *   the tab closes — deliberately not indefinite), and if the page ever
 *   loads with NO `?f=` in
 *   the URL at all, the last saved filter is restored automatically — once
 *   per mount only (see restoredRef below), so an explicit "Clear all"
 *   doesn't get silently un-done by the very save it just triggered. An
 *   explicit filter link (bookmarked/shared `?f=...`) always wins over a
 *   saved one — restore only ever fires when the URL is completely bare.
 */
export function useAdvancedFilters(registry: FieldRegistry, persistKey?: string | null): UseAdvancedFiltersResult {
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
        if (persistKey) writePersisted(persistKey, null);
      } else {
        const encoded = encodeFilterTree(next);
        if (encoded.length > MAX_ENCODED_LEN) {
          toast.error("This filter has too many values to fit in a link — save it as a view instead.");
          return;
        }
        params.set(FILTER_PARAM, encoded);
        // Saved unconditionally alongside every real change (not just on
        // unmount/interval) so storage is never stale relative to the URL —
        // whichever navigation path brings the user back, it reflects the
        // last thing they actually set, including an explicit clear above.
        if (persistKey) writePersisted(persistKey, encoded);
      }

      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname, persistKey]
  );

  // Restore-from-storage: fires at most ONCE, the first time persistKey is
  // actually truthy — not just once at mount. Depending on persistKey (not
  // []) matters because restoredRef is only ever set INSIDE the truthy
  // branch below: if persistKey were still null on the very first render
  // (e.g. tenantId/currentUserId not resolved yet), a mount-only effect
  // would return early without ever setting the ref, then never get another
  // chance to try again once persistKey arrived — permanently, silently
  // disabling restoration for that page visit. Not reachable today (the
  // one real call site, leads/page.tsx, resolves tenantId/currentUserId
  // before this component ever mounts), kept as a guard against that
  // becoming true under a future loading-state refactor. A ref (not state)
  // still ensures this can never re-arm mid-session and re-fire after a
  // later explicit clear, once it HAS successfully run once.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !persistKey) return;
    restoredRef.current = true;
    if (raw) return; // an explicit URL filter always wins over a saved one

    const saved = readPersisted(persistKey);
    if (!saved) return;

    const { tree: savedTree, degrade: savedDegrade } = decodeAndDegrade(saved, registry);
    if (savedDegrade === "invalid" || isEmptyTree(savedTree)) {
      writePersisted(persistKey, null); // stale/corrupt — don't keep re-checking it
      return;
    }
    setTree(savedTree);
    // Deliberately keyed on persistKey ONLY, not raw/registry/setTree too —
    // restoredRef is what actually enforces "only once"; re-running this
    // effect on every raw/registry/setTree identity change (which happens on
    // nearly every render) would fight that guard for no benefit, since a
    // fresh closure over their current values is captured either way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistKey]);

  const clear = useCallback(() => setTree(EMPTY_TREE), [setTree]);

  return { tree, setTree, clear, encoded: raw };
}
