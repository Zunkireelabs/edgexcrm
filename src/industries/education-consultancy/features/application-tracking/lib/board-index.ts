import type { ApplicationStage } from "@/types/database";
import { appsOnPipeline, resolveBoardPlacement } from "./board-placement";
import { sortApplications, type ApplicationSort } from "./applications-query";
import { STUCK_DAYS, isFinishedStage } from "./card-metrics";
import type { BoardRow } from "./board-data";

// The filtered board INDEX (EDGEX-141 Phase 3, B2): every filtered application of the selected
// pipeline, placed and sorted, as light rows. Its numbers are the per-column counts, the header's
// "N" and each column's card order; cards themselves are fetched a page at a time (board-load.ts).
// Pure: the page and the board-page API both build it, so they always agree on offsets.

export const COLUMN_PAGE_SIZE = 25;
export const LIST_PAGE_SIZE = 50;

/** A light index row with the sort keys (APPLICATION_LIGHT_SELECT). */
export type IndexRow = BoardRow & {
  pipeline_id: string | null;
  created_at: string;
  updated_at: string;
  university_name: string;
  application_deadline: string | null;
};

export interface BoardIndex {
  /** The selected pipeline's filtered apps, sorted (the list view's order). */
  flat: IndexRow[];
  /** stage id -> that column's filtered apps, sorted. Every stage of the pipeline has an entry. */
  byStage: Record<string, IndexRow[]>;
  /** stage id -> filtered apps in that column stuck STUCK_DAYS+ (active stages only). */
  stuckByStage: Record<string, number>;
}

export function buildBoardIndex(input: {
  rows: IndexRow[];
  stages: ApplicationStage[];
  pipelines: Parameters<typeof resolveBoardPlacement>[2];
  selectedPipelineId: string;
  pipelineStages: ApplicationStage[];
  sort: ApplicationSort;
  nowMs: number;
}): BoardIndex {
  const { rows, stages, pipelines, selectedPipelineId, pipelineStages, sort, nowMs } = input;
  const { placements } = resolveBoardPlacement(rows, stages, pipelines);
  const flat = sortApplications(appsOnPipeline(rows, placements, selectedPipelineId), sort);
  const byStage: Record<string, IndexRow[]> = {};
  const stuckByStage: Record<string, number> = {};
  const finished = new Set(pipelineStages.filter((s) => isFinishedStage(s)).map((s) => s.id));
  for (const s of pipelineStages) {
    byStage[s.id] = [];
    stuckByStage[s.id] = 0;
  }
  const cutoff = nowMs - STUCK_DAYS * 86_400_000;
  for (const r of flat) {
    const sid = placements.get(r.id)?.stageId;
    if (!sid || !byStage[sid]) continue;
    byStage[sid].push(r);
    if (!finished.has(sid) && new Date(r.stage_changed_at).getTime() <= cutoff) stuckByStage[sid] += 1;
  }
  return { flat, byStage, stuckByStage };
}

export interface PageSlice<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

export function slicePage<T>(all: T[], offset: number, limit: number): PageSlice<T> {
  const start = Math.max(0, offset);
  const items = all.slice(start, start + limit);
  return { items, total: all.length, hasMore: start + items.length < all.length };
}

// ── what the page sends the client ─────────────────────────────────────────────

export interface BoardColumnPayload<C> {
  /** The column's loaded cards (first page on load; finished columns load when expanded). */
  cards: C[];
  /** Filtered count of the whole column. */
  total: number;
  /** Filtered count stuck STUCK_DAYS+ (the column footer fact). */
  stuck: number;
}

export interface BoardPayload<C> {
  columns: Record<string, BoardColumnPayload<C>>;
  /** Filtered count on the selected pipeline (header "N"). */
  total: number;
  /** The index read hit its ceiling: show "N+" rather than a wrong exact number. */
  truncated: boolean;
}

/**
 * Ids of the first page of every column that renders expanded by default: active stages.
 * Finished stages start collapsed (board-prefs) and load their first page when expanded.
 */
export function firstPageIds(index: BoardIndex, stages: Pick<ApplicationStage, "id" | "is_terminal" | "terminal_type">[]): string[] {
  const ids: string[] = [];
  for (const s of stages) {
    if (isFinishedStage(s)) continue;
    for (const r of (index.byStage[s.id] ?? []).slice(0, COLUMN_PAGE_SIZE)) ids.push(r.id);
  }
  return ids;
}

export function assembleBoardPayload<C extends { id: string }>(
  index: BoardIndex,
  stages: Pick<ApplicationStage, "id">[],
  cards: C[],
  truncated: boolean,
): BoardPayload<C> {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const columns: Record<string, BoardColumnPayload<C>> = {};
  for (const s of stages) {
    const col = index.byStage[s.id] ?? [];
    columns[s.id] = {
      cards: col.slice(0, COLUMN_PAGE_SIZE).map((r) => byId.get(r.id)).filter((c): c is C => !!c),
      total: col.length,
      stuck: index.stuckByStage[s.id] ?? 0,
    };
  }
  return { columns, total: index.flat.length, truncated };
}
