/**
 * One implementation of the "exclude these lists, but keep NULL list_id"
 * predicate — copy-pasted three times before this (queries.ts:125,
 * queries.ts:325, search-leads.ts:99). Deliberately outside src/lib/filters/:
 * this is a scope predicate (which lists a caller is even allowed to see),
 * not a user-facing filter, and compileFilter() must never absorb scope.
 *
 * `ids` are always our own lead_lists.id uuids resolved server-side, never
 * client input — if that ever stops holding, this needs the same escaping
 * pgrst.ts uses for user-supplied values.
 */
export function excludeListIds<Q extends { or(filters: string): Q }>(q: Q, ids: string[]): Q {
  return q.or(`list_id.is.null,list_id.not.in.(${ids.join(",")})`);
}
