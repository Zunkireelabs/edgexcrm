# Brief: Track A — Server-Side Pagination for the Leads Table (Speed)

**Owner:** Executor (Sonnet) · **Reviewer:** Architecture (Opus)
**Origin:** ADR-0001 / GCP-scalability plan, Track A. GCP-independent — ship this on the
current infra now. This is the change users will *feel*.
**Scope guardrail:** `education_consultancy` is the primary tenant; verify against **Admizz**
(6k+ leads) as the worst case. Universal leads table, so all industries benefit.

---

## Problem (root cause, evidence)

The dashboard leads page loads the **entire** lead set into one render:

- `src/app/(main)/(dashboard)/leads/page.tsx:130` → `getLeads(tenantId, { ...scope, limit: 50000 })`.
  Up to **50,000 rows** fetched server-side, then passed whole into the client component
  `<LeadsTable leads={leads} />` (page.tsx:222-223), which filters/sorts/paginates in-browser.
- `getLeads` (`src/lib/supabase/queries.ts:73-200`) even documents it:
  `// TEMPORARY: loads the whole list into the client; proper server-side pagination is the real roadmap fix.`
  It pages in 1000-row chunks (PostgREST max-rows) and concatenates.

**But the paginated primitive already exists** and is unused by the table:
`GET /api/v1/leads` (`src/app/(main)/api/v1/leads/route.ts:67-223`) already supports
`page` / `pageSize` (capped 100), `status`, `search`, `assigned_to`, `list`, `branch_id`,
`count: "exact"`, `.range()`, and returns `apiPaginated({ page, pageSize, total, totalPages })`.

**So Track A is not "build pagination" — it is "make the table consume the paginated API,
and bring the API to scope parity with the page."**

---

## The hard part: scope parity (DO NOT skip — this is where correctness lives)

The page's `getLeads` scope and the API GET filters are **not identical today**. Cutting the
table over to the API without reconciling these will silently show the wrong rows. Reconcile
before cutover:

| Concern | Page (`page.tsx` + `getLeads`) | API GET (`route.ts`) | Action |
|---|---|---|---|
| Master-view exclusion | Excludes `is_archive` **AND** `is_staging` lists (page.tsx:94) | Excludes only `is_archive` (route.ts:105) | **Add `is_staging` exclusion to the API** |
| Recycle bin | `scope.onlyDeleted` → shows soft-deleted (page.tsx:96) | No trash support | **Add `?view=trash`** → `deleted_at not null` |
| Archived list view | `tableViewMode="archived"` | none | **Add archived handling** |
| Shared-pool list | Own-scope holder sees whole branch (page.tsx:102-105) | Handled (route.ts:145-150) | Verify parity |
| Own-scope widening | collaborators + shared-branch, 300-cap, inline `assigned_to` OR `id.in(...)` — **undici-safe** | Same shape (route.ts:151-166) | Verify parity; **keep the 300-cap + inline filter; never `.in("id", 500+)`** |
| Branch/team scope | `scope.branchId` incl. unassigned branch leads | `auth.branchMemberIds` (route.ts:167-169) | Verify unassigned-branch-lead parity |
| Sort | `created_at desc, id desc` | `last_activity_at desc` | Pick one canonical sort; keep stable tiebreak on `id` for keyset |

> The undici-overflow guards (300-UUID cap, inline `assigned_to` filters instead of
> `.in("id", [...])`) are load-bearing hotfixes. Preserve them exactly. See memory
> `counselor_empty_leads_undici_overflow`.

---

## Implementation

1. **Bring `GET /api/v1/leads` to full parity** with the page's scope: add `is_staging`
   exclusion, `?view=trash|archived|normal`, and confirm shared-pool / own-widen / branch
   paths match `getLeads`. Add a `sort`/stable order. Keep `pageSize` cap at 100.
2. **Convert `<LeadsTable>` to server-driven paging.** Options (recommend B):
   - A: keep it a client component; on mount + on filter/sort/page change, `fetch` the
     paginated API and render only the current page.
   - **B (recommended):** URL-driven — page/search/status/assignee/sort in `searchParams`;
     the server component fetches only the current page (reuse the API's query logic via a
     shared function, or call `getLeads` with a real `limit`/`range`) and passes one page +
     `total`/`totalPages` to the table. Cleaner caching, shareable URLs, no giant client bundle.
3. **Move filter/sort/search server-side.** Whatever the table does in-browser today
   (status filter, search box, column sort, assignee filter) must become API params. Audit
   `src/components/dashboard/leads-table.tsx` for every in-memory `.filter()`/`.sort()` and
   map each to a query param the API already supports (or add it).
4. **Remove the `limit: 50000` load.** After cutover, `page.tsx:130` must fetch only the
   visible page. The 50k full-load is the thing being deleted.
5. **Keep Kanban out of scope for v1.** The list-Kanban view (page.tsx:186-214) legitimately
   needs all leads in a list to build columns; per-column pagination is a separate follow-up.
   Note it; don't change it here.
6. **Default page size:** 25–50 rows. Add pagination controls (Prev/Next + total count) to
   the table footer.

## Files
- `src/app/(main)/api/v1/leads/route.ts` — scope parity + view modes + sort (GET handler only).
- `src/app/(main)/(dashboard)/leads/page.tsx` — stop the 50k load; feed one page.
- `src/components/dashboard/leads-table.tsx` — consume paged data; server-driven filter/sort/search + pager UI.
- Possibly a shared scope helper so the page and API don't drift again (extract the scope→query mapping).

## Explicitly NOT in scope
- No infra/GCP changes. No Supabase schema changes expected (indexes already added via mig 073;
  confirm an index supports the chosen sort + `tenant_id` + `list_id`, add one if `EXPLAIN` shows a seq scan).
- No Kanban pagination. No changes to lead create/update (POST handler untouched).

## Verification (must do all)
1. **Correctness/parity, real session (not service-role):** as an Admizz **admin**, **branch
   manager**, and **counselor**, open All Leads + each funnel list + trash + archived. Confirm
   the exact same lead set appears as before this change (spot-count against current prod/stage).
   This is the tenant-isolation-sensitive step — verify under a logged-in JWT.
2. **Speed:** on the 6k+ lead Admizz tenant, confirm the leads page fetches ~1 page (25–50 rows)
   not 6k; verify network payload + render time drop sharply. No `UND_ERR_HEADERS_OVERFLOW`.
3. **Filters/sort/search/pager** all work server-side and return correct counts (`total`,
   `totalPages`).
4. `npm run build` clean + `npx eslint --max-warnings 50` clean.
5. Counselor with >440 assigned leads (the undici case) still loads — guards intact.

## Review gate
Stop at a report; do **not** self-merge to stage or apply anything. Opus re-runs the parity
checks under a real session before promotion (see memory `sonnet_oversteps_review_gate`).
