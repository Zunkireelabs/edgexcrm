/**
 * Pure /api/v1/leads query-param builder for a Kanban column, shared by KanbanBoard's
 * toolbar filter state and its tests — KANBAN-PAGINATION-BRIEF §3.4: "thread every
 * active filter into each column request." Kept side-effect-free (no React) so it's
 * unit-testable without a DOM/component-test harness, which this repo doesn't have
 * (vitest here runs `environment: "node"`, `.test.ts` only).
 *
 * Generalized (pipeline-column-pagination Phase 2) to cover BOTH Kanban flavors that
 * share KanbanBoard: list-Kanban's columns are (list, status) — one status slug within
 * one list; the classic single-pipeline board's columns are one stage_id (Phase 1's
 * `?stage=` filter), no list at all. `listSlug` on KanbanFilterState is therefore
 * optional, and the per-column identity (previously a bare `statusSlug` string) is now
 * a small `{ status?, stage? }` object so a column can identify itself either way.
 */

export type SortField = "created" | "updated" | "name" | "email";
export type SortDirection = "asc" | "desc";

export const SORT_FIELD_TO_API: Record<SortField, string> = {
  created: "created_at",
  updated: "updated_at",
  name: "first_name",
  email: "email",
};

export interface KanbanFilterState {
  /** Omitted for the classic single-pipeline board (mode "stage") — its leads aren't
   * scoped to a lead_lists row at all. */
  listSlug?: string;
  sortField: SortField;
  sortDirection: SortDirection;
  debouncedSearch: string;
  counselorFilter: string[];
  collaboratorFilter: string[];
  sourceFilter: string[];
  tagFilter: string;
  formFilter: string;
  createdFilter: string;
  industryFilter: string;
}

/** A column's identity, as far as /api/v1/leads is concerned — exactly one of these
 * is set per column, matching the board's `mode`. */
export interface KanbanColumnIdentity {
  /** list-Kanban: the stage's `status` slug (compared against lead.status, within
   * `state.listSlug`). */
  status?: string;
  /** Classic pipeline board: the stage's id (compared against lead.stage_id via the
   * Phase 1 `?stage=` filter) — exact, unlike `status` which is only a slug match. */
  stage?: string;
}

/** Every active filter, as /api/v1/leads query params, for one column. */
export function buildKanbanColumnParams(state: KanbanFilterState, identity: KanbanColumnIdentity): URLSearchParams {
  const params = new URLSearchParams();
  if (state.listSlug) params.set("list", state.listSlug);
  if (identity.status) params.set("status", identity.status);
  if (identity.stage) params.set("stage", identity.stage);
  params.set("sort", SORT_FIELD_TO_API[state.sortField]);
  params.set("order", state.sortDirection === "asc" ? "asc" : "desc");
  if (state.debouncedSearch) params.set("search", state.debouncedSearch);
  if (state.counselorFilter.length > 0) params.set("assignees", state.counselorFilter.join(","));
  if (state.collaboratorFilter.length > 0) params.set("collaborators", state.collaboratorFilter.join(","));
  if (state.sourceFilter.length > 0) params.set("source", state.sourceFilter.join(","));
  if (state.tagFilter !== "all") params.set("tag", state.tagFilter);
  if (state.formFilter !== "all") params.set("form", state.formFilter);
  if (state.createdFilter !== "all") params.set("created", state.createdFilter);
  if (state.industryFilter !== "all") params.set("industry", state.industryFilter);
  return params;
}

/**
 * A column's request, or `null` to skip fetching it — the global "Status" toolbar
 * filter and a column's own identity are the same axis (both ultimately mean "this
 * lead's status/stage slug"), so a mismatched global filter just skips that column's
 * fetch rather than sending two contradictory values (KANBAN-PAGINATION-BRIEF §3.4).
 * `columnSlug` is always the stage's own slug in both modes (list-Kanban's status
 * slug IS the stage slug within that list; the classic board's Status dropdown is
 * built from the same stage slugs) — only `identity` (what's actually sent to the
 * API) differs by mode.
 */
export function resolveKanbanColumnParams(
  state: KanbanFilterState,
  statusFilter: string,
  columnSlug: string,
  identity: KanbanColumnIdentity,
): URLSearchParams | null {
  if (statusFilter !== "all" && statusFilter !== columnSlug) return null;
  return buildKanbanColumnParams(state, identity);
}
