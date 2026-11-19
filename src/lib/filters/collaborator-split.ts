// Splits the Collaborators "is any of" condition out of a filter tree, for callers whose lead
// query runs over the leads_visible_to_user() RPC (branch managers, counselors).
//
// Why: over an RPC base, PostgREST cannot filter on an EMBEDDED table — the filter is resolved
// against the RPC's own `pgrst_call` alias (42703 "column pgrst_call.user_id does not exist"), so
// the Collaborators embed filter 503s the whole list for those roles. The condition is therefore
// applied in SQL instead (leads_visible_to_user_with_collaborators(), migration 255), and the
// route compiles only what is left in the tree.
//
// Only a condition at the TOP level of an AND tree can be lifted out without changing what the
// tree means (same rule as treeForFacetOption in facet-tree.ts). Anything else — an OR tree, the
// condition inside an OR sub-group, two such conditions — is returned untouched.
//
// No imports from the rest of the app beyond ./types — same invariant as the other files in this
// directory.

import type { FilterCondition, FilterTree } from "./types";

export const COLLABORATORS_FIELD = "collaborators";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CollaboratorSplit {
  /** The selected collaborator user ids, or null when nothing could be lifted out. */
  collaboratorIds: string[] | null;
  /** The tree to compile: the input tree minus the lifted condition (the same object when nothing was lifted). */
  rest: FilterTree;
}

function liftableIds(cond: FilterCondition): string[] | null {
  if (cond.field !== COLLABORATORS_FIELD || cond.op !== "is_any_of") return null;
  if (!Array.isArray(cond.value) || cond.value.length === 0) return null;
  const ids = cond.value.map((v) => (typeof v === "string" ? v.trim() : ""));
  // A value that isn't a real uuid can't be passed to a uuid[] argument (22P02). Leave it in the
  // tree so the existing validation/compile path handles it exactly as before.
  return ids.every((v) => UUID_RE.test(v)) ? ids : null;
}

export function splitCollaboratorAnyOf(tree: FilterTree): CollaboratorSplit {
  const untouched: CollaboratorSplit = { collaboratorIds: null, rest: tree };
  if (tree.conjunction !== "and") return untouched;

  const matches = tree.conditions.filter((c) => c.field === COLLABORATORS_FIELD && c.op === "is_any_of");
  // Two ANDed any-of conditions mean "has someone from set A AND someone from set B" — one array
  // argument can't express that, so don't guess.
  if (matches.length !== 1) return untouched;

  const ids = liftableIds(matches[0]);
  if (!ids) return untouched;

  return {
    collaboratorIds: ids,
    rest: { ...tree, conditions: tree.conditions.filter((c) => c !== matches[0]) },
  };
}

// ── Collaborators "is none of" (migration 282) ──────────────────────────────────────────────────────
//
// "is none of" — leads where NONE of the picked people is a collaborator — cannot be a PostgREST
// embedded-resource filter (it would mean "has SOME collaborator who isn't X"), and an embedded filter over
// an RPC base 503s anyway. So, like "is any of" above, it is lifted out of the tree and applied in SQL
// (leads_visible_to_user_with_collaborator_filter / leads_for_tenant_with_collaborator_filter, migration 282),
// for EVERY role — owner/admin included, because there is no embed form of it at all.
//
// Lift rule (anything else is returned UNTOUCHED, so planFilter still rejects it with its normal 422 —
// an explicit "not supported", never a silently-wrong result):
//   * top-level AND tree only (same rule as splitCollaboratorAnyOf);
//   * exactly ONE collaborators "is_none_of" condition, all values real uuids, at least one;
//   * AND at most ONE collaborators "is_any_of" (lifted with it, as the include list) — a second one would stay
//     behind as an embedded filter over the RPC base and 503, so then nothing is lifted at all. "is_empty" and
//     "is_not_empty" are fine: both read the plain collaborator_count column (no embed), so they stay in the tree.
//
// When this returns excludeIds, the CALLER must run the SQL path for the whole request.

export interface CollaboratorExclusionSplit {
  /** Collaborators to exclude (never empty when non-null), or null when nothing was lifted. */
  excludeIds: string[] | null;
  /** Optional "is any of" include list lifted together with the exclusion. */
  includeIds: string[] | null;
  /** The tree to compile: the input minus the lifted condition(s) (same object when nothing was lifted). */
  rest: FilterTree;
}

function allUuids(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ids = value.map((v) => (typeof v === "string" ? v.trim() : ""));
  return ids.every((v) => UUID_RE.test(v)) ? ids : null;
}

export function splitCollaboratorNoneOf(tree: FilterTree): CollaboratorExclusionSplit {
  const untouched: CollaboratorExclusionSplit = { excludeIds: null, includeIds: null, rest: tree };
  if (tree.conjunction !== "and") return untouched;

  const collab = tree.conditions.filter((c) => c.field === COLLABORATORS_FIELD);
  const noneOf = collab.filter((c) => c.op === "is_none_of");
  if (noneOf.length !== 1) return untouched;

  const anyOf = collab.filter((c) => c.op === "is_any_of");
  if (anyOf.length > 1) return untouched;
  // Anything else on the field besides none_of / one any_of / is_empty / is_not_empty would stay behind as an embed filter.
  if (collab.some((c) => c.op !== "is_none_of" && c.op !== "is_any_of" && c.op !== "is_empty" && c.op !== "is_not_empty")) {
    return untouched;
  }

  const excludeIds = allUuids(noneOf[0].value);
  if (!excludeIds) return untouched;

  let includeIds: string[] | null = null;
  if (anyOf.length === 1) {
    includeIds = allUuids(anyOf[0].value);
    // A malformed/empty any_of can't be lifted — and must not be left behind as an embed over the RPC base.
    if (!includeIds) return untouched;
  }

  const lifted = new Set<FilterCondition>([noneOf[0], ...(anyOf.length === 1 ? [anyOf[0]] : [])]);
  return { excludeIds, includeIds, rest: { ...tree, conditions: tree.conditions.filter((c) => !lifted.has(c)) } };
}
