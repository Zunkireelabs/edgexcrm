// The built-in view tabs (EDGEX-116): All leads · My leads · Applications.
//
// Each tab is just a baseline — a filter tree built from the EXISTING registry fields (`assignees`,
// `stage`) plus the default sort. No tab owns its own predicate, so a tab can never drift from the
// filter engine. "Needs follow-up" is deliberately NOT here: its definition belongs to the
// EDGEX-87 work (EDGEX-121) and will be one more entry in this list once it lands (see
// FOLLOW_UP_TAB_EXTENSION_POINT below).

import type { FilterTree } from "@/lib/filters/types";
import { DEFAULT_SORT, canonicalTreeSignature, sortSignature, viewSignature, type SortState, type ViewState } from "./view-state";

export interface ViewDef {
  id: string;
  label: string;
  tree: FilterTree;
  sort: SortState;
  /** Show a lazily loaded count pill on the tab (counted through the scope-aware list endpoint). */
  showCount: boolean;
}

export interface BuiltinViewInputs {
  /** The tree meaning "this scope, no extra filters" (empty, or the locked Stage tab's chip). */
  scopeTree: FilterTree;
  currentUserId: string;
  /** Registry fields the tenant can actually filter by (so a tab never points at a hidden field). */
  fieldKeys: ReadonlySet<string>;
  /** The tenant's Applications lead list, or null when it has none (tab is then hidden). */
  applicationsListId: string | null;
}

/**
 * EXTENSION POINT — "Needs follow-up" (EDGEX-121).
 * Once EDGEX-87 defines "quiet / needs follow-up" in the filter engine (reusing the tenant's
 * followUpStaleDays threshold), add ONE entry to buildBuiltinViews below:
 *   { id: "needs-follow-up", label: "Needs follow-up", tree: <engine condition>, sort: DEFAULT_SORT, showCount: true }
 * Do NOT define a second "quiet" predicate here.
 */
export const FOLLOW_UP_TAB_EXTENSION_POINT = "needs-follow-up";

/** One-condition tree on a registry field (also what the lazy tab counts are asked under). */
export function singleValueTree(field: string, value: string): FilterTree {
  return { conjunction: "and", conditions: [{ id: `view-${field}`, field, op: "is_any_of", value: [value] }] };
}

export function buildBuiltinViews({ scopeTree, currentUserId, fieldKeys, applicationsListId }: BuiltinViewInputs): ViewDef[] {
  const views: ViewDef[] = [{ id: "all", label: "All leads", tree: scopeTree, sort: DEFAULT_SORT, showCount: false }];
  if (currentUserId && fieldKeys.has("assignees")) {
    views.push({ id: "mine", label: "My leads", tree: singleValueTree("assignees", currentUserId), sort: DEFAULT_SORT, showCount: false });
  }
  if (applicationsListId && fieldKeys.has("stage")) {
    views.push({ id: "applications", label: "Applications", tree: singleValueTree("stage", applicationsListId), sort: DEFAULT_SORT, showCount: true });
  }
  return views;
}

/**
 * The built-in tab whose filters + sort exactly equal the current state, if any. Until the user
 * picks or saves a view themselves, THIS is the active view — so a filter restored from the URL /
 * persistence that happens to be "Applications" shows the Applications tab as clean, instead of
 * "All leads + unsaved changes".
 */
export function matchBuiltinView(views: ViewDef[], current: ViewState): ViewDef | null {
  const signature = viewSignature(current);
  return views.find((v) => viewSignature({ tree: v.tree, sort: v.sort }) === signature) ?? null;
}

/**
 * A restored filter that equals a saved view's tree (default sort) reads as that saved view,
 * so it isn't flagged "Unsaved changes" after a reload.
 */
export function matchSavedView(
  saved: { id: string; tree: FilterTree }[],
  current: ViewState,
): { id: string; tree: FilterTree; sort: SortState } | null {
  if (sortSignature(current.sort) !== sortSignature(DEFAULT_SORT)) return null;
  const signature = canonicalTreeSignature(current.tree);
  const hit = saved.find((f) => canonicalTreeSignature(f.tree) === signature);
  return hit ? { id: hit.id, tree: hit.tree, sort: DEFAULT_SORT } : null;
}
