import { isEmptyTree } from "@/lib/filters/serialize";
import type { FilterTree } from "@/lib/filters/types";
import { normalizeDestinations } from "@/lib/leads/destination-normalize";
import type { ApplicationStage } from "@/types/database";
import { resolveBoardPlacement } from "./board-placement";
import { computeTabCounts, finishedStageIdSet, type ApplicationTab, type LightApplication, type TabCounts } from "./applications-url";

// The numbers around the board that must NOT follow the chips (EDGEX-141 Phase 2, fix round 1):
// tab counts, the header's "of T", per-stage totals, the pipeline button + menu counts, and the
// filter menu's option lists + per-option counts. All of them come from ONE unfiltered read of the
// same scope (the "light" rows) — or, on an unfiltered load, from the main rows themselves (M3).
// Pure: the page and the dev fixture both call it, so they can't drift.

/** Unfiltered counts per filter option, keyed by field key then option value. */
export interface BoardFacets {
  counsellor: Record<string, number>;
  stage: Record<string, number>;
  intake: Record<string, number>;
  /** Keyed by the normalised spelling shown in the picker. */
  country: Record<string, number>;
  offer_type: Record<string, number>;
}

export interface BoardTotals {
  /** null when the unfiltered read failed and the load was filtered: badges hide, never show 0. */
  tabCounts: TabCounts | null;
  /** Unfiltered application count per stage id (all pipelines). */
  stageTotals: Record<string, number>;
  /** Unfiltered count per pipeline id, with the Default placement rule (M1). */
  pipelineTotals: Record<string, number>;
  /** Unfiltered count of null-pipeline apps shown under Default. */
  noPipelineTotal: number;
  /** Unfiltered within the selected pipeline (all tabs). */
  facets: BoardFacets;
  /** True when the unfiltered read failed and the numbers above fell back to the filtered rows. */
  degraded: boolean;
}

/** No chips, no search, All tab: the main query already IS the unfiltered read (M3). */
export function isUnfilteredLoad(p: { tree: FilterTree; q: string; tab: ApplicationTab }): boolean {
  return isEmptyTree(p.tree) && p.q.trim() === "" && p.tab === "all";
}

/** A light row as placement needs it (APPLICATION_LIGHT_SELECT, or a full main-query row). */
export type BoardRow = LightApplication & { pipeline_id: string | null };

export interface AssembleBoardTotalsInput {
  /** The unfiltered rows of the scope, or null when that read failed. */
  lightRows: BoardRow[] | null;
  /** The filtered rows (fallback source when lightRows is null). */
  mainRows: BoardRow[];
  stages: ApplicationStage[];
  pipelines: Parameters<typeof resolveBoardPlacement>[2];
  selectedPipelineId: string;
  userId: string;
  nowMs: number;
}

export function assembleBoardTotals(input: AssembleBoardTotalsInput): BoardTotals {
  const { stages, pipelines, selectedPipelineId, userId, nowMs } = input;
  const degraded = input.lightRows === null;
  const rows = input.lightRows ?? input.mainRows;
  const { placements, countByPipeline, noPipelineCount } = resolveBoardPlacement(rows, stages, pipelines);

  const stageTotals: Record<string, number> = {};
  const facets: BoardFacets = { counsellor: {}, stage: {}, intake: {}, country: {}, offer_type: {} };
  const bump = (m: Record<string, number>, k: string) => {
    m[k] = (m[k] ?? 0) + 1;
  };
  const countryRows: string[][] = [];
  for (const a of rows) {
    const placed = placements.get(a.id);
    if (placed?.stageId) bump(stageTotals, placed.stageId);
    if (placed?.pipelineId !== selectedPipelineId) continue;
    if (placed.stageId) bump(facets.stage, placed.stageId);
    const counsellor = a.assigned_to ?? a.leads?.assigned_to ?? null;
    if (counsellor) bump(facets.counsellor, counsellor);
    if (a.intake_term) bump(facets.intake, a.intake_term);
    if (a.offer_type) bump(facets.offer_type, a.offer_type);
    countryRows.push(a.countries ?? []);
  }
  // One spelling per country across the board (same rule the picker used before), counted once per app.
  const canonical = new Map(normalizeDestinations(countryRows.flat()).map((c) => [c.toLowerCase(), c]));
  for (const list of countryRows) {
    for (const c of normalizeDestinations(list)) {
      const label = canonical.get(c.toLowerCase());
      if (label) bump(facets.country, label);
    }
  }

  return {
    tabCounts: degraded
      ? null
      : computeTabCounts(rows, placements, selectedPipelineId, finishedStageIdSet(stages), userId, nowMs),
    stageTotals,
    pipelineTotals: Object.fromEntries(countByPipeline),
    noPipelineTotal: noPipelineCount,
    facets,
    degraded,
  };
}
