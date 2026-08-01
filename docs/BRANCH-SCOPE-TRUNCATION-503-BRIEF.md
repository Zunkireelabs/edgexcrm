# BRIEF — Branch-scope: fix the /leads 503, the silent 1,000-row truncation, and the three divergent visibility definitions

**Branch:** `fix/branch-scope-visibility` off latest `origin/stage`
**Migration:** none required (reuses `leads_visible_to_user`, migration 179)
**Stop at review.** Do not push, do not open a PR, do not merge, do not touch prod.

---

## 0. Why this exists

Measured on the deployed stage build 2026-08-01 as real logged-in users. Two defects with one
root cause, plus a consistency problem they expose.

**Sizing rule applies:** the fix must not scale with rows/users/lists. A bigger cap is not a fix.
An empty-collection guard is masking. Report round-trip **counts** and rows touched.

---

## 1. Defect A — `/leads` returns 503 for branch managers

Branch manager `bijay.dahal@admizz.org` (branch `09bd9491-…`, KTM):

```
GET /api/v1/leads?count=1&pageSize=5   ->  HTTP 503
{"error":{"code":"SERVICE_UNAVAILABLE","message":"Failed to fetch leads"}}
```

`route.ts:344` builds `.or(assigned_to.in.(17 ids),id.in.(1855 ids))` → ~68 KB query string →
undici `UND_ERR_HEADERS_OVERFLOW`. The page is dead, not slow.

- **Stage:** 1,855 shared ids → over the ~16 KB ceiling → 503 today.
- **Prod:** ~403 shared ids ≈ 14.9 KB → under the ceiling → works today, with roughly
  **40 shared leads of margin** before Admizz branch managers get a dead page. This is a
  live prod time-bomb, not a stage-only issue.

## 2. Defect B — silent 1,000-row truncation of shared leads

The same block fetches shared ids with no `.range()`:

```ts
// route.ts:337-342
const { data: sharedRows } = await supabase
  .from("lead_branches").select("lead_id")
  .eq("tenant_id", auth.tenantId).eq("branch_id", scope.branchId);
```

PostgREST caps it. Verified against stage:

```
GET /rest/v1/lead_branches?select=lead_id&tenant_id=eq.…&branch_id=eq.09bd9491-…
content-range: 0-999/1855          <-- 855 rows dropped, no error
```

**Magnitude, stated against the right denominator.** 855 dropped *rows* is NOT 855 lost *leads*:
1,835 of the 1,855 shared rows point at leads also reachable via `assigned_to ∈ branchMembers`,
so truncation doesn't lose them. Leads reachable **only** via the shared path — the genuinely
at-risk set — are **20** for KTM (10 on the default view). Two were actually missing in the call
measured. Small today; grows silently with `lead_branches`; wrong at any size.

Observed symptom (branch manager, default view, deployed stage):

| source | facet (live) | SQL truth |
|---|---|---|
| api | 2 | 3 |
| manual_entry | 10 | 11 |
| **sum** | **93** | **95** |

The facet still *works* for this user (it goes through the RPC, no giant URL) — it just
undercounts. So today the branch manager sees a dead page and, where a number does render,
a quietly wrong one.

## 3. The consistency problem these expose

Three different predicates all claim to mean "leads this branch manager can see":

| # | Location | Predicate | Bijay |
|---|---|---|---|
| 1 | `/leads` route.ts:334-353 | members **OR** shared | 2,516 |
| 2 | `leads_visible_to_user('branch')` (mig 179:67-73) — used by dashboard/insights/pipeline counts | members **OR** unassigned-in-branch **OR** shared | 2,516 |
| 3 | `getLeadsForPipeline` queries.ts:620-631 | members **OR** unassigned-in-branch (**no shared**) | — |

They coincide on stage today by accident, not by construction. #3 in particular drops shared
leads entirely, so the pipeline board and /leads can disagree for the same user.

---

## 4. The fix — one definition, computed in Postgres

**Delete the id arrays. Route branch scope through `leads_visible_to_user`, exactly as own-scope
already does.** That kills the 68 KB URL and the 1,000-row cap in one move, and collapses
definitions #1 and #3 onto #2 — which the dashboard already uses and which I verified matches SQL
exactly (2,516 = 2,516).

No migration: `leads_visible_to_user(p_tenant, p_user, 'branch', p_branch_id, …)` exists and
`RETURNS SETOF leads`, so `.select()`, `.range()`, `!inner` embeds and `count: 'exact'` all work
over it — already proven by the own-scope path.

### 4.1 `src/app/(main)/api/v1/leads/route.ts`

**(a) Route branch scope through the RPC.** At the base-query selection (~line 292), branch scope
must use the **RLS-context client** (`userClient`), because the function gates on `auth.uid()`:

```ts
const useVisibilityRpc = !useSharedPool && ((scope.restrictToSelf && scope.userId) || !!scope.branchId);
let query = useVisibilityRpc
  ? visibleLeadsBase(userClient, auth.tenantId, scope, countOpts).select(selectColumns)
  : supabase.from("leads").select(selectColumns, countOpts).eq("tenant_id", auth.tenantId);
```

`visibleLeadsBase` already handles `scope.branchId` (visibility-query.ts:47-53) — no change needed there.

**(b) Delete the whole `else if (scope.branchId)` block** (route.ts:334-353): the `lead_branches`
fetch, `sharedLeadIds`, the `.or(...)`, and the `scopeIdsAnyAssignedTo` / `scopeIdsAnyLeadId`
assignments. Keep the `useSharedPool` and `restrictToSelf` branches untouched.

**(c) Facet must follow the page.** In the `facets=source` block, branch scope becomes
`p_scope='branch'` + `p_branch_id`, not `'ids_any'`:

```ts
const facetScope = !useSharedPool && scope.restrictToSelf && scope.userId ? "own"
                 : scope.branchId && !useSharedPool ? "branch"
                 : "all";
```

Pass `branchId` through to `getSourceFacet`; drop `idsAnyAssignedTo`/`idsAnyLeadId` from the call.
Add `branchId` to `SourceFacetParams` and map it to `p_branch_id` in `aggregates.ts`.
**Leave migration 194's `ids_any` SQL in place** — just stop calling it from this route. Page and
facet must resolve to the identical predicate; that equality is the whole point of #341.

### 4.2 `src/lib/supabase/queries.ts` — `getLeadsForPipeline` (~620-631)

Replace the hand-rolled `.or(assigned_to.in.(…),and(assigned_to.is.null,branch_id.eq.…))` with the
same `visibleLeadsBase(...)` RPC base so the pipeline board matches /leads. Audit `getLeads` in the
same file for the same pattern and convert it too.

### 4.3 Out of scope — flag, do not fix here

`src/lib/ai/tools/universal/lib/lead-visibility.ts` carries **the same two defects plus a third**:
unbounded `lead_branches` select (line 181), the same `.or(...)` construction (212-219), and an
explicit `rawExtra.slice(0, 300)` / `COLLABORATOR_ID_CAP = 300` (line 172-177) — which is the
known counselor 300-cap visibility bug, still live in the AI path. **Do not fix it in this PR.**
Report it and it gets its own brief.

---

## 5. ⚠️ The gate — this fix WIDENS the predicate

Definition #2 adds `assigned_to IS NULL AND branch_id = p_branch_id`, which #1 lacks. It is a
strict superset: **no lead disappears, some may appear.**

Measured on stage: **net widening = 0.** Every unassigned-with-`branch_id` lead (20 for KTM, 0
tenant-wide otherwise) is already in `lead_branches`, so it was already visible.

**You must re-run this on PROD before the promotion and report the number:**

```sql
SELECT count(*) FROM leads l
WHERE l.tenant_id = '<admizz>' AND l.deleted_at IS NULL
  AND l.assigned_to IS NULL AND l.branch_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM lead_branches lb
                  WHERE lb.lead_id=l.id AND lb.branch_id=l.branch_id AND lb.tenant_id=l.tenant_id);
```

- `0` → zero visibility change, proceed.
- `> 0` → **stop and report.** That many leads would newly become visible to branch managers.
  That is a product decision for Sadin, not something to absorb silently.

---

## 6. Verification — required, on the deployed build as real users

Tests are not evidence here: the #340 facet bug passed 1,071 tests, the RPC checks, and the
equivalence suite. Auth is `@supabase/ssr` cookie-based; Bearer tokens 401. Build the cookie:
POST `{SUPABASE_URL}/auth/v1/token?grant_type=password` → cookie value =
`"base64-" + base64(<whole session JSON>)`, name `sb-dymeudcddasqpomfpjvt-auth-token`, split into
`.0`/`.1` at 3180 chars.

Stage creds: owner `hello@admizz.org` / `edgexdev123` · branch mgr `bijay.dahal@admizz.org` /
`Bijay#@123` · counselor `janakpur@admizz.org` / `edgexdev123`.
(Supabase auth rate-limits rapid successive logins — space them out or reuse one session.)

Report an explicit number for every row:

| # | Check | Expected |
|---|---|---|
| 1 | Branch mgr `GET /api/v1/leads?count=1` | **HTTP 200**, `meta.total = 2516` |
| 2 | Branch mgr facet sum / options | **95 / 15** (was 93/15) — the 2 truncated leads return |
| 3 | Facet sum + null-source count == page total, per view | holds |
| 4 | **Pagination**: walk every page at `pageSize=25` to the end | union of ids == 2,516 distinct, **zero dupes, zero gaps**; `totalPages` consistent; last page not empty |
| 5 | Pagination under a filter (`?status=new`, `?list=prospects`) | same invariant |
| 6 | Owner + counselor `/leads`, unchanged | owner total unchanged; counselor 2 |
| 7 | Dashboard / insights / pipeline totals vs SQL, all 3 roles | owner 16,687 · counselor 2 · branch mgr 2,516 |
| 8 | Pipeline board (§4.2) for branch mgr vs /leads | same lead set |
| 9 | Cross-tenant probe (Zunkiree user against Admizz ids) | 0 rows |
| 10 | Round-trip count for a branch-manager `/leads` request, before vs after | must **drop** (the `lead_branches` fetch disappears); state both numbers |
| 11 | `EXPLAIN ANALYZE` the RPC for branch scope at page 1 and a deep page | no seq-scan blowup; report ms |

Also confirm no remaining `.or(` built from an unbounded id array in `route.ts` / `queries.ts`,
and no `lead_branches` select without a bound in the paths you touched.

**Gates:** `npm run build` exit 0 · `npx eslint --max-warnings 50` ≤ 45 warnings / 0 errors ·
`npm run test` all passing (baseline 1,072 across 103 files). Add tests: branch scope routes to
the RPC and never constructs `.or(`; facet and page resolve to the same predicate; a >1,000-row
shared set is not truncated.

---

## 7. Deliverable

A report with: the diff, every number from §6, the §5 prod widening figure, the round-trip
before/after, and anything you chose not to do and why. **Stop there.** Sadin decides the merge.
