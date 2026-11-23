import type { SupabaseClient } from "@supabase/supabase-js";
import { EMPTY_TREE, type CompileCtx, type FilterTree } from "@/lib/filters/types";
import type { Application, ApplicationPipeline, ApplicationStage } from "@/types/database";
import {
  APPLICATION_LIGHT_SELECT,
  APPLICATION_SELECT,
  runApplicationsQuery,
  type ApplicationsScope,
  type ApplicationsTab,
} from "./applications-query";
import { decodeApplicationParams, finishedStageIdSet, type DecodedApplicationParams } from "./applications-url";
import { assembleBoardTotals, isUnfilteredLoad, type BoardTotals } from "./board-data";
import { assembleBoardPayload, buildBoardIndex, firstPageIds, slicePage, summarizeIndex, type BoardIndex, type BoardPayload, type IndexRow, type ListSummary } from "./board-index";
import { IMPLICIT_PIPELINE } from "./board-placement";
import { chunk, fetchBoardCounts } from "./board-counts";
import { resolvePipelineSelection } from "./pipeline-selection";
import { STUCK_DAYS } from "./card-metrics";

// Server side of the board (EDGEX-141 Phase 3). Both the /applications page and
// GET /api/v1/applications/board-page call loadBoardIndex with the URL state, so a "Show more"
// request recomputes exactly the index the page rendered from (the client never sends ids).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;
type ParamBag = Record<string, string | string[] | undefined>;

export interface BoardMeta {
  stages: ApplicationStage[];
  pipelines: ApplicationPipeline[];
}

/** Stages + active pipelines of the tenant (2 queries). */
export async function loadBoardMeta(supabase: Db, tenantId: string): Promise<BoardMeta> {
  const [stagesResult, pipelinesResult] = await Promise.all([
    supabase.from("application_stages").select("*").eq("tenant_id", tenantId).order("position", { ascending: true }),
    supabase.from("application_pipelines").select("*").eq("tenant_id", tenantId).eq("is_active", true).order("position", { ascending: true }),
  ]);
  return {
    stages: (stagesResult.data ?? []) as ApplicationStage[],
    pipelines: (pipelinesResult.data ?? []) as ApplicationPipeline[],
  };
}

export function stagesOfPipeline(stages: ApplicationStage[], pipelines: Pick<ApplicationPipeline, "id">[], pipelineId: string): ApplicationStage[] {
  if (pipelineId === IMPLICIT_PIPELINE) return stages.filter((s) => !s.pipeline_id || !pipelines.some((p) => p.id === s.pipeline_id));
  return stages.filter((s) => s.pipeline_id === pipelineId);
}

export interface LoadBoardIndexInput {
  supabase: Db;
  tenantId: string;
  userId: string;
  scope: ApplicationsScope;
  ctx: CompileCtx;
  params: ParamBag;
  meta: BoardMeta;
  /** The page needs the unfiltered rows too (tabs, "of T", totals, facets); the API doesn't. */
  withUnfiltered: boolean;
  /** Index row ceiling (defaults to INDEX_ROW_CEILING); tests lower it to prove `truncated`. */
  maxRows?: number;
}

export interface LoadedBoardIndex {
  decoded: DecodedApplicationParams;
  filterError: string | null;
  selectedPipelineId: string;
  pipelineStages: ApplicationStage[];
  index: BoardIndex;
  /** The filtered read hit the ceiling: "N" is a lower bound. */
  truncated: boolean;
  /** Unfiltered light rows of the scope; null when not asked for, or when that read failed. */
  unfilteredRows: IndexRow[] | null;
  /** The unfiltered read was asked for on a filtered load and failed (totals degrade, never 0). */
  unfilteredFailed: boolean;
  unfilteredTruncated: boolean;
  /** The filtered read itself failed (logged; the board renders empty). */
  queryError: string | null;
}

export async function loadBoardIndex(input: LoadBoardIndexInput): Promise<LoadedBoardIndex> {
  const { supabase, tenantId, userId, scope, ctx, params, meta } = input;
  const decoded = decodeApplicationParams(params, ctx);
  let filterError = decoded.filterError;
  const unfiltered = isUnfilteredLoad(decoded);

  const tab: ApplicationsTab =
    decoded.tab === "mine"
      ? { mineUserId: userId }
      : decoded.tab === "stuck"
        ? { stuck: { cutoffIso: new Date(ctx.now.getTime() - STUCK_DAYS * 86_400_000).toISOString(), finishedStageIds: [...finishedStageIdSet(meta.stages)] } }
        : {};
  const read = (tree: FilterTree, q: string, t: ApplicationsTab) =>
    runApplicationsQuery({ supabase, tenantId, scope, tree, q, tab: t, ctx, mode: "rows", select: APPLICATION_LIGHT_SELECT, sort: decoded.sort, maxRows: input.maxRows });

  // Unfiltered load: ONE read serves both roles (M3). Filtered load: the two reads run in parallel.
  const [filteredFirst, unfilteredResult] = await Promise.all([
    read(decoded.tree, decoded.q, tab),
    unfiltered || !input.withUnfiltered ? null : read(EMPTY_TREE, "", {}),
  ]);
  let filteredResult = filteredFirst;
  if (!filteredResult.ok) {
    // A tree the planner rejects (e.g. Counsellor inside an OR) becomes a chip message, never a 500.
    filterError = filteredResult.error;
    filteredResult = await read(EMPTY_TREE, decoded.q, tab);
  }

  let queryError: string | null = null;
  let rows: IndexRow[] = [];
  let truncated = false;
  if (filteredResult.ok && filteredResult.mode === "rows") {
    rows = filteredResult.rows as unknown as IndexRow[];
    truncated = filteredResult.truncated;
  } else {
    queryError = filteredResult.ok ? "mode" : filteredResult.error;
    console.error("[applications/board] applications query failed", { tenantId, error: queryError });
  }

  let unfilteredRows: IndexRow[] | null = null;
  let unfilteredFailed = false;
  let unfilteredTruncated = false;
  if (input.withUnfiltered) {
    if (unfiltered) {
      unfilteredRows = rows;
      unfilteredTruncated = truncated;
    } else if (unfilteredResult && unfilteredResult.ok && unfilteredResult.mode === "rows") {
      unfilteredRows = unfilteredResult.rows as unknown as IndexRow[];
      unfilteredTruncated = unfilteredResult.truncated;
    } else {
      // Never silent zeros: log it; the totals then degrade (tab badges hide) instead of reading 0.
      console.error("[applications/board] unfiltered count query failed", {
        tenantId, error: unfilteredResult && !unfilteredResult.ok ? unfilteredResult.error : "mode",
      });
      unfilteredFailed = true;
    }
  }

  const selectedPipelineId = resolvePipelineSelection(typeof params.pipeline === "string" ? params.pipeline : null, meta.pipelines);
  const pipelineStages = stagesOfPipeline(meta.stages, meta.pipelines, selectedPipelineId);
  const index = buildBoardIndex({
    rows, stages: meta.stages, pipelines: meta.pipelines, selectedPipelineId, pipelineStages, sort: decoded.sort, nowMs: ctx.now.getTime(),
  });

  return { decoded, filterError, selectedPipelineId, pipelineStages, index, truncated, unfilteredRows, unfilteredFailed, unfilteredTruncated, queryError };
}

/** 100 uuids ≈ 3.7 KB of `id=in.(…)`: well under the ~8 KB URL budget. */
export const CARD_CHUNK = 100;

/**
 * Full card rows for these ids (in this order), with doc + open-task counts. Ids come from the
 * server-built index only, never from the client. Tenant + soft-delete filters stay on as a guard.
 */
export async function fetchCards(supabase: Db, tenantId: string, ids: string[]): Promise<Application[]> {
  if (ids.length === 0) return [];
  const results = await Promise.all(
    chunk(ids, CARD_CHUNK).map((part) =>
      supabase.from("applications").select(APPLICATION_SELECT).eq("tenant_id", tenantId).in("id", part).is("deleted_at", null),
    ),
  );
  const byId = new Map<string, Application>();
  for (const r of results) {
    if (r.error) console.error("[applications/board] card read failed", { tenantId, error: r.error.message });
    for (const row of (r.data ?? []) as unknown as Application[]) byId.set(row.id, row);
  }
  const rows = ids.map((id) => byId.get(id)).filter((a): a is Application => !!a);
  const { docsByApplication, openTasksByLead } = await fetchBoardCounts(supabase, tenantId, rows);
  return rows.map((a) => ({ ...a, doc_count: docsByApplication.get(a.id) ?? 0, open_task_count: openTasksByLead.get(a.lead_id) ?? 0 }));
}

// ── the two entry points (page + API), so tests drive exactly what ships ──────────────────────────

export interface LoadBoardPageResult {
  board: BoardPayload<Application>;
  totals: BoardTotals;
  filterError: string | null;
  selectedPipelineId: string;
  loaded: LoadedBoardIndex;
}

/** Everything /applications renders: board columns (first pages) + the unfiltered totals. */
export async function loadBoardPage(input: Omit<LoadBoardIndexInput, "withUnfiltered">): Promise<LoadBoardPageResult> {
  const loaded = await loadBoardIndex({ ...input, withUnfiltered: true });
  const cards = await fetchCards(input.supabase, input.tenantId, firstPageIds(loaded.index, loaded.pipelineStages));
  const board = assembleBoardPayload(loaded.index, loaded.pipelineStages, cards, loaded.truncated);
  const totals = assembleBoardTotals({
    lightRows: loaded.unfilteredFailed ? null : loaded.unfilteredRows,
    mainRows: loaded.index.flat,
    stages: input.meta.stages,
    pipelines: input.meta.pipelines,
    selectedPipelineId: loaded.selectedPipelineId,
    userId: input.userId,
    nowMs: input.ctx.now.getTime(),
  });
  return { board, totals: { ...totals, truncated: loaded.unfilteredTruncated }, filterError: loaded.filterError, selectedPipelineId: loaded.selectedPipelineId, loaded };
}

export type LoadBoardSliceResult =
  | {
      ok: true;
      cards: Application[];
      total: number;
      hasMore: boolean;
      truncated: boolean;
      filterError: string | null;
      /** List mode only (no stage): the footer over the whole filtered index. */
      summary: ListSummary | null;
    }
  | { ok: false; status: 400 | 500; message: string };

/** One page of one column (stage) or of the flat list (no stage), for GET /api/v1/applications/board-page. */
export async function loadBoardSlice(
  input: Omit<LoadBoardIndexInput, "withUnfiltered"> & { stage: string | null; offset: number; limit: number },
): Promise<LoadBoardSliceResult> {
  const loaded = await loadBoardIndex({ ...input, withUnfiltered: false });
  if (loaded.queryError) return { ok: false, status: 500, message: "Failed to fetch applications" };
  let pool: IndexRow[];
  if (input.stage) {
    if (!loaded.pipelineStages.some((s) => s.id === input.stage)) return { ok: false, status: 400, message: "stage is not a stage of this pipeline" };
    pool = loaded.index.byStage[input.stage] ?? [];
  } else {
    pool = loaded.index.flat;
  }
  const page = slicePage(pool, input.offset, input.limit);
  let cards = await fetchCards(input.supabase, input.tenantId, page.items.map((r) => r.id));
  // List rows show the column the board places them in (a no-pipeline app sits in Default's start stage).
  if (!input.stage) cards = cards.map((c) => ({ ...c, placed_stage_id: loaded.index.placedStage?.[c.id] ?? c.stage_id }));
  const summary = input.stage ? null : summarizeIndex(loaded.index, { tz: input.ctx.tz, nowMs: input.ctx.now.getTime() });
  return { ok: true, cards, total: page.total, hasMore: page.hasMore, truncated: loaded.truncated, filterError: loaded.filterError, summary };
}
