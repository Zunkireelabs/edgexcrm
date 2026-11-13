import { applicationFields } from "@/lib/filters/registry/applications";
import { decodeFilterTree, encodeFilterTree, FILTER_PARAM, isEmptyTree } from "@/lib/filters/serialize";
import { EMPTY_TREE, type CompileCtx, type FilterCondition, type FilterTree } from "@/lib/filters/types";
import { APPLICATION_SORTS, DEFAULT_APPLICATION_SORT, type ApplicationSort } from "./applications-query";
import { STUCK_DAYS, isFinishedStage } from "./card-metrics";
import type { BoardPlacement } from "./board-placement";
import type { ApplicationStage } from "@/types/database";

// URL <-> board state for the Applications toolbar (EDGEX-141 Phase 2).
// ?f= (filter tree)  ?q= (search)  ?sort=  ?tab= (all | mine | stuck)  ?pipeline=
// The URL is the single source of truth; the server decodes it for the query, the client for the chips.

export const APPLICATION_TABS = ["all", "mine", "stuck"] as const;
export type ApplicationTab = (typeof APPLICATION_TABS)[number];

export const SORT_LABELS: Record<ApplicationSort, string> = {
  stage: "Time in stage",
  newest: "Newest",
  updated: "Recently updated",
  university: "University A–Z",
  deadline: "Deadline soonest",
  stage_asc: "Time in stage (shortest)",
  created_asc: "Oldest",
  updated_asc: "Least recently updated",
  university_desc: "University Z–A",
  deadline_desc: "Deadline latest",
};

export function parseTab(v: string | null | undefined): ApplicationTab {
  return (APPLICATION_TABS as readonly string[]).includes(v ?? "") ? (v as ApplicationTab) : "all";
}

export function parseSort(v: string | null | undefined): ApplicationSort {
  return (APPLICATION_SORTS as readonly string[]).includes(v ?? "") ? (v as ApplicationSort) : DEFAULT_APPLICATION_SORT;
}

export interface DecodedApplicationParams {
  tree: FilterTree;
  q: string;
  sort: ApplicationSort;
  tab: ApplicationTab;
  /** Set when ?f= could not be read (or had unknown fields dropped): show a chip, never a 500. */
  filterError: string | null;
}

type ParamBag = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** Server + client decode. Unknown field keys are dropped; an unreadable ?f= resets to no filters. */
export function decodeApplicationParams(params: ParamBag, ctx: CompileCtx): DecodedApplicationParams {
  const registry = applicationFields(ctx);
  const raw = one(params[FILTER_PARAM]);
  let tree: FilterTree = EMPTY_TREE;
  let filterError: string | null = null;
  if (raw) {
    const decoded = decodeFilterTree(raw);
    if (!decoded.ok) {
      filterError = "That filter couldn't be read, so it was reset.";
    } else {
      const known = (c: FilterCondition) => registry[c.field] !== undefined;
      const t = decoded.tree;
      const hasUnknown = t.conditions.some((c) => !known(c)) || (t.groups ?? []).some((g) => g.conditions.some((c) => !known(c)));
      tree = hasUnknown
        ? {
            conjunction: t.conjunction,
            conditions: t.conditions.filter(known),
            groups: (t.groups ?? []).map((g) => ({ ...g, conditions: g.conditions.filter(known) })).filter((g) => g.conditions.length > 0),
          }
        : t;
      if (hasUnknown) filterError = "Some filters no longer exist and were removed.";
    }
  }
  return { tree, q: (one(params.q) ?? "").trim(), sort: parseSort(one(params.sort)), tab: parseTab(one(params.tab)), filterError };
}

// ── board <-> detail round trip (fix round 1, B3) ─────────────────────────────────

/** The only params a detail page may carry back to the board. */
export const BOARD_STATE_PARAMS = [FILTER_PARAM, "q", "sort", "tab", "pipeline"] as const;
/** Detail-page param holding the board path (with its query) to return to. */
export const BOARD_BACK_PARAM = "back";
const BOARD_PATH = "/applications";
const SAME_ORIGIN = "http://same-origin.invalid";

/** The board's query string restricted to BOARD_STATE_PARAMS (order kept, others dropped). */
export function boardStateQuery(current: string): string {
  const src = new URLSearchParams(current);
  const out = new URLSearchParams();
  for (const k of BOARD_STATE_PARAMS) {
    const v = src.get(k);
    if (v) out.set(k, v);
  }
  return out.toString();
}

/** /applications/<id>, with ?back=<board path + state> when the board has any state to restore. */
export function applicationDetailHref(appId: string, boardQuery: string): string {
  const qs = boardStateQuery(boardQuery);
  const path = `${BOARD_PATH}/${encodeURIComponent(appId)}`;
  return qs ? `${path}?${BOARD_BACK_PARAM}=${encodeURIComponent(`${BOARD_PATH}?${qs}`)}` : path;
}

/**
 * The detail page's in-app back link. Only a same-origin path to the board itself is honoured
 * (no scheme, no //host, no backslash tricks, no other path), and only BOARD_STATE_PARAMS survive.
 * Anything else falls back to the plain board.
 */
export function boardBackHref(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return BOARD_PATH;
  let url: URL;
  try {
    url = new URL(raw, SAME_ORIGIN);
  } catch {
    return BOARD_PATH;
  }
  if (url.origin !== SAME_ORIGIN || url.pathname !== BOARD_PATH) return BOARD_PATH;
  const qs = boardStateQuery(url.search);
  return qs ? `${BOARD_PATH}?${qs}` : BOARD_PATH;
}

/** Set (or delete when value is null/default) one param on a query string. */
export function withParam(current: string, key: string, value: string | null): string {
  const p = new URLSearchParams(current);
  if (value === null || value === "") p.delete(key);
  else p.set(key, value);
  return p.toString();
}

export function dropStageCondition(tree: FilterTree): FilterTree {
  return {
    ...tree,
    conditions: tree.conditions.filter((c) => c.field !== "stage"),
    groups: (tree.groups ?? []).map((g) => ({ ...g, conditions: g.conditions.filter((c) => c.field !== "stage") })).filter((g) => g.conditions.length > 0),
  };
}

/**
 * Query string after switching pipeline: sets ?pipeline=, keeps every chip except Stage
 * (stages belong to one pipeline, so a Stage chip would match nothing on the new board).
 */
export function withPipelineSwitch(current: string, pipelineId: string): string {
  const p = new URLSearchParams(current);
  p.set("pipeline", pipelineId);
  const raw = p.get(FILTER_PARAM);
  if (raw) {
    const decoded = decodeFilterTree(raw);
    if (decoded.ok) {
      const next = dropStageCondition(decoded.tree);
      if (isEmptyTree(next)) p.delete(FILTER_PARAM);
      else p.set(FILTER_PARAM, encodeFilterTree(next));
    }
  }
  return p.toString();
}

// ── counts (pure) ──────────────────────────────────────────────────────────────

export interface LightApplication {
  id: string;
  stage_id: string;
  stage_changed_at: string;
  assigned_to: string | null;
  intake_term?: string | null;
  countries?: string[] | null;
  offer_type?: string | null;
  leads?: { assigned_to?: string | null } | null;
}

export interface TabCounts {
  all: number;
  mine: number;
  stuck: number;
}

/**
 * Header total and tab counts for the SELECTED pipeline, with no chips/search applied
 * (mockup state 2: tabs read 201 / 34 / 17 while the header says "20 of 201").
 */
export function computeTabCounts(
  apps: LightApplication[],
  placements: Map<string, BoardPlacement>,
  pipelineId: string,
  finishedStageIds: ReadonlySet<string>,
  userId: string,
  nowMs: number,
): TabCounts {
  const cutoff = nowMs - STUCK_DAYS * 86_400_000;
  const counts: TabCounts = { all: 0, mine: 0, stuck: 0 };
  for (const a of apps) {
    if (placements.get(a.id)?.pipelineId !== pipelineId) continue;
    counts.all += 1;
    if ((a.assigned_to ?? a.leads?.assigned_to ?? null) === userId) counts.mine += 1;
    if (new Date(a.stage_changed_at).getTime() < cutoff && !finishedStageIds.has(a.stage_id)) counts.stuck += 1;
  }
  return counts;
}

export function finishedStageIdSet(stages: Pick<ApplicationStage, "id" | "is_terminal" | "terminal_type">[]): Set<string> {
  return new Set(stages.filter((s) => isFinishedStage(s)).map((s) => s.id));
}
