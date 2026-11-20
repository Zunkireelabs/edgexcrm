// Pure "active view" bookkeeping for the leads toolbar (EDGEX-116).
//
// Today the filter tree lives in the URL (`?f=`) and a saved filter is COPIED into it on
// apply, so nothing remembers which view the user is looking at. The toolbar needs that to
// show "Unsaved changes · Discard · Save as view". A view is a baseline {id, tree, sort};
// the current state is "dirty" when its canonical signature differs from the baseline's.
//
// No React, no I/O: everything here is unit-testable (view-state.test.ts).

import type { FilterCondition, FilterLeafGroup, FilterTree } from "@/lib/filters/types";

export type SortDirection = "asc" | "desc";

export interface SortState {
  /** UI sort key (leads-table's SortField), not the API key. */
  field: string;
  direction: SortDirection;
}

export interface ViewBaseline {
  /** "all", "mine", "applications", a saved-filter id, … */
  id: string;
  tree: FilterTree;
  sort: SortState;
}

export interface ViewState {
  tree: FilterTree;
  sort: SortState;
}

/** Default sort of /leads today (leads-table.tsx: "activity" / "desc"). */
export const DEFAULT_SORT: SortState = { field: "activity", direction: "desc" };

// --- canonical form --------------------------------------------------------------------
// Condition ids are random per client and round-trip through the URL, so they must never
// make two identical filters look different. Multi-select values and condition order are
// likewise not meaning — [A,B] is [B,A], and chip order is cosmetic.

function canonicalValue(value: FilterCondition["value"]): unknown {
  if (Array.isArray(value)) {
    // [number, number] / [string, string] are RANGES: order is meaning. Only multi-select
    // string lists are sets. A 2-element string array is ambiguous, so the operator decides.
    return value;
  }
  return value ?? null;
}

function canonicalCondition(c: FilterCondition): unknown {
  const isSet = c.op === "is_any_of" || c.op === "is_none_of" || c.op === "has_all";
  const value = isSet && Array.isArray(c.value) ? [...(c.value as string[])].sort() : canonicalValue(c.value);
  return [c.field, c.op, value];
}

function canonicalConditions(conditions: FilterCondition[]): string[] {
  return conditions.map((c) => JSON.stringify(canonicalCondition(c))).sort();
}

function canonicalLeafGroup(g: FilterLeafGroup): unknown {
  return [g.conjunction, canonicalConditions(g.conditions)];
}

/** Stable string for a tree that ignores ids and ordering. Empty groups are dropped. */
export function canonicalTreeSignature(tree: FilterTree): string {
  const groups = (tree.groups ?? [])
    .filter((g) => g.conditions.length > 0)
    .map((g) => JSON.stringify(canonicalLeafGroup(g)))
    .sort();
  return JSON.stringify([tree.conjunction, canonicalConditions(tree.conditions), groups]);
}

export function sortSignature(sort: SortState): string {
  return `${sort.field}:${sort.direction}`;
}

export function viewSignature(state: ViewState): string {
  return `${canonicalTreeSignature(state.tree)}|${sortSignature(state.sort)}`;
}

// --- dirty / discard -------------------------------------------------------------------

export function isViewDirty(baseline: ViewBaseline, current: ViewState): boolean {
  return viewSignature(baseline) !== viewSignature(current);
}

export function isSortDirty(baseline: ViewBaseline, current: ViewState): boolean {
  return sortSignature(baseline.sort) !== sortSignature(current.sort);
}

function cloneTree(tree: FilterTree): FilterTree {
  return JSON.parse(JSON.stringify(tree)) as FilterTree;
}

/**
 * What Discard restores. Deep-cloned so later edits to the live tree can never mutate the
 * baseline (that would make Discard "restore" the edits).
 */
export function discardToBaseline(baseline: ViewBaseline): ViewState {
  return { tree: cloneTree(baseline.tree), sort: { ...baseline.sort } };
}

/** The baseline a saved view becomes once the user saves: current state, new id. */
export function baselineFromState(id: string, state: ViewState): ViewBaseline {
  return { id, tree: cloneTree(state.tree), sort: { ...state.sort } };
}
