# BRIEF — Leads Organise cockpit: server-side pagination (kill the multi-minute render)

**Owner:** Sonnet executor session
**Status:** Ready to build. Review-gated — stop at the review checkpoint, do NOT self-merge or apply migrations (see `feedback_sonnet_oversteps_review_gate`).
**Branch:** cut a fresh `feature/leads-organise-pagination` off `stage`.

---

## 1. Problem (measured, not theoretical)

The Leads Organise cockpit (`/leads-organise/[slug]`) renders the **entire** lead list server-side on every visit. Live dev-server timings on the Migration (QC) list (6,114 leads):

```
GET /leads-organise/migration-qc 200 in 13.1s  (render: 12.7s)   ← calm window
GET /leads-organise/migration-qc 200 in 2.2min  (render: 2.2min)  ← under poll contention
GET /leads-organise/migration-qc 200 in 4.8min  (render: 4.7min)  ← two stacked clicks
```

Because Node is single-threaded, while that render runs it **blocks the event loop**, so every other request (badge-counts poll, notifications poll, sidebar nav) queues behind it and also balloons to 30–53s. Net effect for the user: clicking any nav appears frozen for minutes. This is the entire "lag" — it is not the Mac, not the network (raw Supabase latency measured at ~30ms), not Turbopack compile (that's a separate ~2–5s first-visit cost).

## 2. Root cause

`src/app/(main)/(dashboard)/leads-organise/[slug]/page.tsx` (~line 88):

```ts
getLeads(tenantData.tenant.id, { ...scope, limit: 50000 })
```

- `getLeads` (`src/lib/supabase/queries.ts:70`) pages the DB in 1000-row chunks up to `limit` and returns **all** rows. For 6,114 leads that's ~7 sequential round-trips and 6,114 full `select("*")` rows (including `custom_fields` JSONB) serialized into the RSC → client payload.
- `<LeadsTable>` (`src/components/dashboard/leads-table.tsx`) then does **all** search / filter / sort / pagination **client-side over the full in-memory array** (`filtered` useMemo at line 225). It only ever shows 25 rows, but it receives and hydrates all 6,114.

So we pay a multi-minute server render + giant payload + heavy client hydration to display 25 rows.

## 3. The two design constraints that make this non-trivial

Do **not** "just paginate" — these will break if you do:

1. **Search / filter / sort are currently client-side over the whole set.** If the page only sends 25 rows, search/filter/sort must move **server-side** (or they'll only search the visible page). This is the real work.
2. **Bulk operations must work across the whole list, not just the visible page.** The cockpit's purpose is to select many leads and route/move them (`moveListDialog`, assign, reconcile). "Select all 6,114 and move to Qualified" must still work when only 25 are on screen. Use a **select-all-matching** pattern: when the user picks "select all," capture the *current filter criteria* (not 6,114 ids), and have the bulk endpoints operate **by filter on the server** (`UPDATE … WHERE list_id = $staging AND <filters>`), not by a client-supplied id array.

## 4. Required approach

### 4a. Server-side data layer
- Add a paginated query (either extend `getLeads` with `offset`/`page` + `pageSize` + `search`/filter/sort params, or add `getLeadsPage(...)`). Return `{ rows, totalCount }`. Use a single `.range(from, to)` + `count: "exact"` head query — **no** chunk loop.
- Push the filters that LeadsTable currently does in JS (`status`, `form_config_id`, `assigned_to`/unassigned, `intake_source`, `tags` contains, `prospect_industry`, created-date window, and the text search across first/last/email/phone/city) into the SQL query. Text search → `ilike` across the relevant columns (or a `tsvector` if you want to be thorough; `ilike` is acceptable for v1).
- Sort: translate the existing `sortField`/`sortDirection` options to `.order(...)`. Keep the secondary `.order("id")` for stable paging.

### 4b. Route shell
- `leads-organise/[slug]/page.tsx`: read `page`, `pageSize` (default 25 or 50), `search`, filter, sort from `searchParams`. Fetch only that page. Pass `rows`, `totalCount`, and the current query state to `<LeadsTable>`. Remove the `limit: 50000` call entirely.
- Keep `getImportSourceReconciliation` (single RPC, cheap) as-is.

### 4c. LeadsTable (staging / server-driven mode)
- Add a `serverPaginated` mode (gate on the existing `isStagingView` prop, or a new explicit prop). In that mode:
  - Do **not** filter/sort/paginate client-side — render `rows` as given.
  - Drive search/filter/sort/page changes by updating the URL (`router.push` with new `searchParams`) so the server returns the next page. Debounce the search input (~300ms).
  - Pagination control shows `totalCount`-derived page numbers from the server, not `localLeads.length`.
- **Bulk select:** add an explicit "Select all N matching" affordance distinct from "select the 25 on this page." When "all matching" is active, the bulk action sends the **filter criteria + a select-all flag**, and the server-side bulk endpoints (move-to-list, assign, etc.) operate by `WHERE` clause. Keep the existing per-row checkbox behavior for the visible page.
  - Audit the bulk endpoints the cockpit calls (move list, assign, branch-assign) — each needs a "operate by filter when selectAllMatching=true" path, still tenant-scoped, still requiring the staging `list_id` filter so it can't touch the whole tenant (see `scopedClient` rule in CLAUDE.md).
  - **SECURITY — how select-all-matching MUST be implemented (non-negotiable):** do NOT accept a client-built `WHERE` / raw filter object and trust it. The server must **re-derive the matching id set (or build the UPDATE predicate) using the exact same filter→SQL builder that drives the paginated page query** — single source of truth — so "all matching" can never be widened by a forged request. The predicate is ALWAYS force-anchored with `tenant_id = auth.tenantId` (via `scopedClient`) **and** `list_id = <the staging list id resolved server-side from the slug>`. An **empty/absent filter must mean "all leads in this staging list," never "all leads in the tenant."** Reject the request if the resolved `list_id` is not a staging list the caller can access. Add a regression check: empty filter + wrong/missing list_id must NOT mutate other lists.
  - **Interaction with the just-shipped combined route+assign feature (commit `d8064b0`, already on stage):** `handleBulkMove` and the new assign-in-move path in `leads-table.tsx` currently send **explicit id arrays chunked at 100**. Under select-all-matching they must switch to the filter+flag contract above when "all N matching" is active (keep the id-array path for the visible-page checkbox selection). Update these handlers as part of this work — don't leave a half-paginated cockpit where "select all" silently only moves the 25 loaded rows.

> Non-staging consumers of `<LeadsTable>` (regular leads page, other lists) keep today's client-side behavior unchanged — they default to `limit: 1000` and render in ~1–2s, which is acceptable. Only the cockpit changes. Verify you haven't regressed them.

## 5. Why not the quick stopgap (drop limit 50000 → 1000)

Tempting, but **wrong for this page**: the cockpit is a *reconciliation/QC* surface. Capping at 1000 means you can't see or act on 5,114 of the 6,114 leads — a correctness regression, not just a cosmetic one. If you need an emergency hotfix before the full build lands, a cap is acceptable **only** with a visible "showing 1000 of 6,114 — pagination coming" banner so no one assumes the list is complete. The real fix is §4.

## 6. Out of scope (do not expand)
- Do not refactor the regular `/leads` page or other lead-lists to server pagination in this PR. One page, contained blast radius.
- Do not touch the polling hooks — see §8.

## 7. Verification (must pass before review handoff)
- `npm run build` clean + `npx eslint --max-warnings 50` clean (build-clean alone has red-deployed before — see `feedback_run_ci_lint_before_merge`).
- Local `npm run dev` as `hello@admizz.org` (pw `edgexdev123`) on the **stage** DB:
  - Open Migration (QC). **Server log must show `render` in the low hundreds of ms, not seconds/minutes.** Capture the log line.
  - Navigate between Migration (QC), Existing Leads (edgeX), and other nav items — each responds in < 1s; badge-counts/notifications polls stay sub-second (no event-loop starvation).
  - Search / each filter / each sort column returns correct results from the **whole** list, not just the loaded page.
  - "Select all N matching" → move-to-list moves the full filtered set (verify count moved == filtered count), and is tenant + staging-list scoped (cannot affect other lists/tenants).
  - Pagination: last page, page size change, empty-result filter all behave.
- Confirm regular `/leads` and the other lead-lists are visually + behaviorally unchanged.

## 8. Note on already-applied local changes (do not duplicate / do not revert blindly)
While diagnosing, the Opus session added an **in-flight guard** to the two polling hooks so a 30s poll can't stack a second request before the first returns:
- `src/hooks/use-badge-counts.ts`
- `src/components/dashboard/notifications-dropdown.tsx` (adds `useRef` import)

These are a legitimate independent bug-fix (helps prod too) and are currently **uncommitted in the working tree**. Either fold them into this PR or split them into their own small commit — but keep them; they reduce poll pileup that compounded the render-blocking. Don't let the pagination work clobber them.

---

**Deliverable back to Opus for review:** the diff, the before/after dev-server `render:` timings for Migration (QC), and confirmation of the select-all-matching bulk path being filter-scoped. Stop at review.
