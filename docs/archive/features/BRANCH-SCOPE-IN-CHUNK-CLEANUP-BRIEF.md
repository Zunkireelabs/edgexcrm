# BRIEF — Defensive cleanup: chunk the remaining branch-scope `.in("id", ids)` calls

**Priority:** LOW / defensive. **Not reachable with current data** — total `lead_branches` rows across all tenants = 8 (max 5 per branch), so `leadIdsForBranch()` returns a tiny array today. This only matters once a tenant shares 500+ leads to a single branch. Do it on the normal cycle (branch off `stage`), not as a hotfix. **No migration.**

## Context
This is the leftover from the undici-overflow hotfix (PR #57, shipped 2026-06-28). That fix removed the large `.in("id", …)` for the **counselor / own-scope** path everywhere, and chunked the **branch-scope** path in the SSR `getLeads` / `getLeadsForPipeline`. Three **API-route** branch-scope spots were left un-chunked and still do `.in("id", leadIdsForBranch(...))`, which would overflow Node/undici's ~16 KB URL limit (`UND_ERR_HEADERS_OVERFLOW`) if the branch set ever exceeds ~440 ids.

## The three spots to fix
1. `src/app/(main)/api/v1/leads/route.ts` ~L153-155 — team-scope (`scope.branchId`): `.in("id", leadIdsForBranch(...))`.
2. `src/app/(main)/api/v1/leads/route.ts` ~L162-163 — admin branch-focus (`?branch_id=` switcher): `.in("id", leadIdsForBranch(...))`.
3. `src/app/(main)/api/v1/lead-lists/route.ts` ~L88-92 — per-list count query, branch scope: `.in("id", leadIdsForBranch(...))`.

## Fix
Match the pattern already used in `queries.ts` (≤250-id chunks, merge, dedupe). Best: extract a small shared helper so all callers are consistent — e.g. in `src/lib/leads/branch-membership.ts`:

```ts
// Run a leads query filtered to a (possibly large) id set without overflowing the URL.
// Splits ids into ≤250-id batches, runs them concurrently, merges + dedupes by id.
export async function fetchLeadsByIdChunked<T extends { id: string }>(
  buildForChunk: (chunk: string[]) => PromiseLike<{ data: T[] | null }>,
  ids: string[],
  chunkSize = 250,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize));
  const results = await Promise.all(chunks.map((c) => buildForChunk(c)));
  const seen = new Set<string>(); const out: T[] = [];
  for (const { data } of results) for (const row of data ?? []) if (!seen.has(row.id)) { seen.add(row.id); out.push(row); }
  return out;
}
```

Then in each of the three spots, when `ids.length > 250` use the chunked helper; otherwise keep the single `.in("id", ids)`. Preserve the existing sentinel for the empty-set case (`.in("id", ["000…000"])`) so an empty branch yields 0 rows, not all rows. Keep ordering/limit consistent with each route's current behavior.

(Optional: collapse the inline chunk loops already in `queries.ts` `getLeads`/`getLeadsForPipeline` onto the same helper to remove duplication — nice-to-have, not required.)

## Verify (stop at review — do NOT merge/deploy)
- `npm run build` + `npx eslint --max-warnings 50` clean.
- Functional: a team-scope / branch-focus view still returns exactly the branch's leads (no leak, no dupes). With current data the sets are tiny so behavior is unchanged; to exercise the chunk path, temporarily lower `chunkSize` to e.g. 2 in a local test and confirm a >2-id branch still returns all its leads once.
- Report diff. Opus reviews. Ship stage → main on the normal cycle (no urgency).
