"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PipelineLead } from "@/types/database";

export const KANBAN_PAGE_SIZE = 20;

export interface KanbanColumnState {
  cards: PipelineLead[];
  loaded: number;
  total: number;
  page: number;
  isLoadingMore: boolean;
}

export type KanbanColumnsState = Record<string, KanbanColumnState>;

export interface KanbanColumnDef {
  key: string;
  /** Base /api/v1/leads query params for this column (list/status/funnel + every
   * active filter). `null` means "don't fetch this column" — e.g. a global status
   * filter that doesn't match this column's own status (KANBAN-PAGINATION-BRIEF §3.4). */
  params: URLSearchParams | null;
}

/**
 * Append a load-more page to a column's existing cards, deduping by id — pulled out as
 * a pure function (no React) so "load-more appends without duplicating" is directly
 * unit-testable. A dupe can arrive if a card's sort key shifts between page N's fetch
 * and page N+1's (e.g. a realtime update nudges `updated_at` mid-scroll).
 */
export function mergeColumnPage(existing: PipelineLead[], incoming: PipelineLead[]): PipelineLead[] {
  const existingIds = new Set(existing.map((c) => c.id));
  return [...existing, ...incoming.filter((c) => !existingIds.has(c.id))];
}

function seedColumn(seed: { cards: PipelineLead[]; total: number } | undefined): KanbanColumnState {
  return {
    cards: seed?.cards ?? [],
    loaded: seed?.cards.length ?? 0,
    total: seed?.total ?? 0,
    page: 1,
    isLoadingMore: false,
  };
}

/**
 * Per-column lazy-loading state machine shared by KanbanBoard (both the lead-lists
 * Kanban view and the classic single-pipeline board, since pipeline-column-pagination
 * Phase 2 unified them) and FunnelKanbanBoard — KANBAN-PAGINATION-BRIEF §2-4. Page 1
 * of every column is SSR-seeded
 * (server-rendered props); this hook re-fetches page 1 (with an exact count) for every
 * column, in parallel, whenever `filterSignature` changes, and exposes `loadMore` for the
 * Load-more button / Phase 2 infinite-scroll sentinel.
 */
export function useKanbanColumns(
  columnDefs: KanbanColumnDef[],
  filterSignature: string,
  initial: Record<string, { cards: PipelineLead[]; total: number }>,
) {
  const [columns, setColumns] = useState<KanbanColumnsState>(() => {
    const out: KanbanColumnsState = {};
    for (const { key } of columnDefs) out[key] = seedColumn(initial[key]);
    return out;
  });

  const isFirstRef = useRef(true);
  const prevSigRef = useRef(filterSignature);
  const abortRef = useRef<AbortController | null>(null);
  // Phase 2 (infinite scroll): one in-flight load-more request per column, cancelled
  // on unmount or a filter change — the sentinel can fire again before a slow request
  // resolves, and a stale response must never land after the user has moved on.
  const loadMoreAbortRef = useRef<Record<string, AbortController>>({});

  useEffect(() => {
    const inFlight = loadMoreAbortRef.current;
    return () => {
      for (const controller of Object.values(inFlight)) controller.abort();
    };
  }, []);

  useEffect(() => {
    // A filter change invalidates every in-flight load-more — its page/column may no
    // longer even exist under the new filter set.
    for (const controller of Object.values(loadMoreAbortRef.current)) controller.abort();
    loadMoreAbortRef.current = {};
  }, [filterSignature]);

  useEffect(() => {
    if (isFirstRef.current) {
      // Page 1 is already SSR-seeded via `initial` — skip the redundant fetch on mount.
      isFirstRef.current = false;
      prevSigRef.current = filterSignature;
      return;
    }
    if (filterSignature === prevSigRef.current) return;
    prevSigRef.current = filterSignature;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    Promise.all(
      columnDefs.map(async ({ key, params }) => {
        if (!params) return [key, seedColumn(undefined)] as const;
        const p = new URLSearchParams(params);
        p.set("page", "1");
        p.set("pageSize", String(KANBAN_PAGE_SIZE));
        p.set("count", "1");
        const res = await fetch(`/api/v1/leads?${p.toString()}`, { signal: controller.signal });
        const body = (await res.json()) as { data?: PipelineLead[]; meta?: { total: number } };
        const cards = body.data ?? [];
        return [key, { cards, loaded: cards.length, total: body.meta?.total ?? 0, page: 1, isLoadingMore: false }] as const;
      }),
    )
      .then((results) => {
        if (controller.signal.aborted) return;
        setColumns((prev) => {
          const next = { ...prev };
          for (const [key, state] of results) next[key] = state;
          return next;
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error("[useKanbanColumns] filter refetch failed", err);
      });

    return () => controller.abort();
  }, [filterSignature, columnDefs]);

  const loadMore = useCallback((key: string, baseParams: URLSearchParams | null) => {
    if (!baseParams) return;
    // isLoadingMore below is the no-double-fire guard the Load-more button AND the
    // Phase 2 IntersectionObserver sentinel both rely on — a second call while one is
    // already in flight for this column is a no-op.
    if (loadMoreAbortRef.current[key]) return;

    setColumns((prev) => {
      const col = prev[key];
      if (!col || col.isLoadingMore || col.loaded >= col.total) return prev;
      const nextPage = col.page + 1;

      const p = new URLSearchParams(baseParams);
      p.set("page", String(nextPage));
      p.set("pageSize", String(KANBAN_PAGE_SIZE));
      p.set("count", "0");

      const controller = new AbortController();
      loadMoreAbortRef.current[key] = controller;

      fetch(`/api/v1/leads?${p.toString()}`, { signal: controller.signal })
        .then((res) => res.json())
        .then((body: { data?: PipelineLead[] }) => {
          if (controller.signal.aborted) return;
          delete loadMoreAbortRef.current[key];
          const newCards = body.data ?? [];
          setColumns((cur) => {
            const c = cur[key];
            if (!c) return cur;
            const merged = mergeColumnPage(c.cards, newCards);
            return { ...cur, [key]: { ...c, cards: merged, loaded: merged.length, page: nextPage, isLoadingMore: false } };
          });
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          delete loadMoreAbortRef.current[key];
          setColumns((cur) => {
            const c = cur[key];
            if (!c) return cur;
            return { ...cur, [key]: { ...c, isLoadingMore: false } };
          });
        });

      return { ...prev, [key]: { ...col, isLoadingMore: true } };
    });
  }, []);

  return { columns, setColumns, loadMore };
}
