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
