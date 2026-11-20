import type { ApplicationStage } from "@/types/database";
import { appsOnPipeline, resolveBoardPlacement } from "./board-placement";
import { sortApplications, type ApplicationSort } from "./applications-query";
import { STUCK_DAYS, daysInStage, isFinishedStage } from "./card-metrics";
import type { BoardRow } from "./board-data";

// The filtered board INDEX (EDGEX-141 Phase 3, B2): every filtered application of the selected
// pipeline, placed and sorted, as light rows. Its numbers are the per-column counts, the header's
// "N" and each column's card order; cards themselves are fetched a page at a time (board-load.ts).
// Pure: the page and the board-page API both build it, so they always agree on offsets.

export const COLUMN_PAGE_SIZE = 25;
/** Largest page a board COLUMN may ask for ("Show more" asks for COLUMN_PAGE_SIZE). */
export const LIST_PAGE_SIZE = 50;
/** List view (Phase 4): "Rows per page" choices; the API allows up to the last one in list mode only. */
export const LIST_PAGE_SIZES = [25, 50, 100] as const;
export const LIST_MAX_PAGE_SIZE = 100;
export const DEFAULT_LIST_PAGE_SIZE = 25;
/** "due in 14d" in the list footer, and the amber deadline cell. */
export const DEADLINE_SOON_DAYS = 14;

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
  /** app id -> the column it is placed in (may differ from its raw stage_id: no-pipeline apps). */
  placedStage?: Record<string, string>;
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
  const placedStage: Record<string, string> = {};
  for (const r of flat) {
    const sid = placements.get(r.id)?.stageId;
    if (!sid || !byStage[sid]) continue;
    placedStage[r.id] = sid;
    byStage[sid].push(r);
    if (!finished.has(sid) && new Date(r.stage_changed_at).getTime() <= cutoff) stuckByStage[sid] += 1;
  }
  return { flat, byStage, stuckByStage, placedStage };
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

// ── list footer (Phase 4): summaries over the FILTERED index, never a new query ─────────────────

export interface ListSummary {
  applications: number;
  universities: number;
  /** Stages of the pipeline holding at least one filtered application. */
  stages: number;
  /** Median whole days in the current stage; null when there are no rows. */
  medianDaysInStage: number | null;
  /** Distinct effective counsellors (application assignee, else the lead's). */
  counsellors: number;
  /** Deadlines from today through today + DEADLINE_SOON_DAYS, in the tenant's timezone. */
  dueSoon: number;
}

/** YYYY-MM-DD of `ms` in `tz` (falls back to UTC for an unknown zone). */
export function ymdInTz(ms: number, tz: string): string {
  const fmt = (zone: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  try {
    return fmt(tz);
  } catch {
    return fmt("UTC");
  }
}

/** Calendar days from `todayYmd` to the deadline's date (negative = past). Null for no / unreadable deadline. */
export function daysUntilDeadline(deadline: string | null | undefined, todayYmd: string): number | null {
  if (!deadline) return null;
  const d = Date.parse(`${deadline.slice(0, 10)}T00:00:00Z`);
  const t = Date.parse(`${todayYmd}T00:00:00Z`);
  if (Number.isNaN(d) || Number.isNaN(t)) return null;
  return Math.round((d - t) / 86_400_000);
}

export type DeadlineTone = "none" | "neutral" | "soon" | "past";

export function deadlineTone(deadline: string | null | undefined, todayYmd: string): DeadlineTone {
  const days = daysUntilDeadline(deadline, todayYmd);
  if (days === null) return "none";
  if (days < 0) return "past";
  if (days <= DEADLINE_SOON_DAYS) return "soon";
  return "neutral";
}

export function summarizeIndex(index: BoardIndex, opts: { tz: string; nowMs: number }): ListSummary {
  const today = ymdInTz(opts.nowMs, opts.tz);
  const universities = new Set<string>();
  const counsellors = new Set<string>();
  const days: number[] = [];
  let dueSoon = 0;
  for (const r of index.flat) {
    const uni = (r.university_name ?? "").trim().toLowerCase();
    if (uni) universities.add(uni);
    const c = r.assigned_to ?? r.leads?.assigned_to ?? null;
    if (c) counsellors.add(c);
    days.push(daysInStage(r.stage_changed_at, opts.nowMs));
    if (deadlineTone(r.application_deadline, today) === "soon") dueSoon += 1;
  }
  days.sort((a, b) => a - b);
  const mid = days.length >> 1;
  const median = days.length === 0 ? null : days.length % 2 ? days[mid] : Math.floor((days[mid - 1] + days[mid]) / 2);
  return {
    applications: index.flat.length,
    universities: universities.size,
    stages: Object.values(index.byStage).filter((col) => col.length > 0).length,
    medianDaysInStage: median,
    counsellors: counsellors.size,
    dueSoon,
  };
}
