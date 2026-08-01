/**
 * Pure /api/v1/leads query-param builder for a Kanban column, shared by list-kanban-
 * board.tsx's toolbar filter state and its tests — KANBAN-PAGINATION-BRIEF §3.4:
 * "thread every active filter into each column request." Kept side-effect-free (no
 * React) so it's unit-testable without a DOM/component-test harness, which this repo
 * doesn't have (vitest here runs `environment: "node"`, `.test.ts` only).
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
  listSlug: string;
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

/** Every active filter, as /api/v1/leads query params, for one column's status. */
export function buildKanbanColumnParams(state: KanbanFilterState, statusSlug: string): URLSearchParams {
  const params = new URLSearchParams();
  params.set("list", state.listSlug);
  params.set("status", statusSlug);
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
 * A column's request, or `null` to skip fetching it — the global "Status" filter and
 * a column's own identity are the same axis (both filter on `status`); a mismatched
 * global filter just skips that column's fetch rather than sending two contradictory
 * `status` values (KANBAN-PAGINATION-BRIEF §3.4).
 */
export function resolveKanbanColumnParams(
  state: KanbanFilterState,
  statusFilter: string,
  stageSlug: string,
): URLSearchParams | null {
  if (statusFilter !== "all" && statusFilter !== stageSlug) return null;
  return buildKanbanColumnParams(state, stageSlug);
}
