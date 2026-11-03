# BRIEF — Kanban per-column lazy loading (Phase 1 + Phase 2)

**Branch:** `feat/kanban-column-pagination` off latest `origin/stage` **after #342 has merged**
**Migration:** none required
**Stop at review.** Do not push, do not open a PR, do not merge, do not touch prod.

---

## 0. The problem

`/leads` in Kanban view loads the entire lead set in one query:

```ts
// src/app/(main)/(dashboard)/leads/page.tsx:177,184
const wantsFullLoad = canShowKanban || canShowFunnelKanban;
… wantsFullLoad ? getLeads(tenant, { ...scope, limit: 50000 }) : getLeadsPage(tenant, scope, 1, 25)
```

Table view paginates; Kanban does not. Both boards receive the whole array and group it
client-side (`groupByList` in `funnel-kanban-board.tsx:57`).

**This is safe today only by accident.** Kanban triggers on a *normal* list, and Admizz's normal
lists are tiny (Pre-qualified 3, Prospects 47, Applications 56) because **16,120 of 16,709 leads
are parked in staging lists**. The staging cleanup moves those leads into Pre-qualified /
Qualified / Prospects — the exact lists Kanban full-loads. **This must ship before that cleanup,
not after.** At 50,000 leads a single board render is ~50 MB of JSON into the browser.

**Sizing rule:** the per-render cost must not grow with list size. A cap is not a fix.

---

## 1. Decision: per-column lazy loading (not a cap)

Approved by Sadin. This is what HubSpot, Trello, Jira and Linear all do: **the column header
shows the true total from the database, while cards load incrementally per column.**

A cap ("showing 20 of 340") is wrong for a board specifically. A table is for *scanning*, so
pagination matches the task. A board is for *manipulating* — you drag a card from one column to
another — and if the card you need is one of the 320 not loaded, the board cannot do its only
job. Salesforce caps its Kanban and users experience it as broken. A cap also doesn't remove the
"load a fixed number regardless of what's there" pattern; it renames it.

---

## 2. Two things already exist — use them, don't rebuild

**(a) `/api/v1/leads` already serves exactly what each column needs.** No new cards endpoint.

| board | column identity | request |
|---|---|---|
| `ListKanbanView` | a status within a list | `?list=<slug>&status=<status>&page=N&pageSize=20` |
| `FunnelKanbanBoard` | a list within a funnel | `?list=<slug>&page=N&pageSize=20` |

Its default sort (`created_at DESC`, `id DESC` tiebreaker) is already the current card order and
is drift-free — proven by a 345-page walk over 8,620 rows with zero dupes and zero gaps. It also
carries the whole visibility/scope predicate, including the branch-scope fix from #342.

**(b) Per-column counts already exist** in `lead_aggregates` (migration 194) — dimension
`list_status` (the `(list_id, status)` pair, written for exactly this) for ListKanbanView, and
`list` for FunnelKanbanBoard. Verified against SQL: 0 mismatches across all 153 stages. The page
is a Server Component, so pass these down as props — **no new counts endpoint either.**

So the header half of the HubSpot pattern is already built and already correct. Only the card
fetch is missing.

---

## 3. Phase 1 — "Load more" per column

1. **Stop the full load.** Delete `wantsFullLoad`; Kanban takes the `getLeadsPage`-style path.
   Server-render **page 1 only (20 cards) per column** plus that column's exact count from
   `lead_aggregates`. Do the per-column first pages in one `Promise.all`, and state the resulting
   round-trip count in your report.
2. **Column state becomes `{ cards, loaded, total, page }`** instead of a slice of one big array.
   `groupByList` stops being the source of truth for membership; it only seeds page 1.
3. **"Load more" button** at the bottom of any column where `loaded < total`, labelled with the
   remainder (e.g. *Load 20 more (320 remaining)*). Fetches the next page and appends. Header
   count always shows `total`, never `loaded`.
4. **⚠️ Thread every active filter into each column request.** The board currently receives an
   array the page already filtered. Once columns fetch independently, each request must carry the
   same active filters (search, assignees, tag, source, industry, form, created, collaborators)
   or **filters silently stop working on the board** — a correctness regression, not a cosmetic
   one. Reuse the table's `buildFetchParams` shape rather than re-deriving it.
5. **Drag-and-drop into a partially-loaded column:** optimistically insert the card at the top,
   increment that column's `total`, decrement the source column's. This is Trello's behavior.
   Do not refetch the whole column on drop.
6. **Both boards** — `ListKanbanView` and `FunnelKanbanBoard`. `PipelineColumn` already has
   `overflow-y-auto`, so no layout change is needed.

## 4. Phase 2 — infinite scroll

Replace the button with an `IntersectionObserver` sentinel at the bottom of each column's scroll
container, fetching the next page when it comes into view. **Same API, same state shape — a UI
change only.** Requirements: one in-flight request per column (no double-fire), an
`AbortController` on unmount/filter-change, a visible loading row, and the button retained as the
fallback when the observer is unavailable or a fetch fails. Keep the two phases as **separate
commits** so Phase 2 can be reverted without losing Phase 1.

---

## 5. Out of scope

- The pipeline board's own 500-row cap (`getLeadsForPipeline`) — measured to miss 14 of 98
  visible leads for a branch manager. Related, separately queued, **do not fix here.**
- `leads-organise` — being deleted.
- Any migration. If you think you need one, stop and report instead.

---

## 6. Verification — on the deployed build, as real logged-in users

Tests are not sufficient: the #340 facet bug passed 1,071 tests and the equivalence suite. Auth is
`@supabase/ssr` cookie-based (Bearer 401s): POST
`{SUPABASE_URL}/auth/v1/token?grant_type=password`, cookie value =
`"base64-" + base64(<whole session JSON>)`, name `sb-dymeudcddasqpomfpjvt-auth-token`, split
`.0`/`.1` at 3180 chars. Stage: owner `hello@admizz.org` / `edgexdev123` · branch mgr
`bijay.dahal@admizz.org` / `Bijay#@123` · counselor `janakpur@admizz.org` / `edgexdev123`.
(Auth rate-limits rapid logins — reuse one session.)

Give a number for every row:

| # | Check | Expected |
|---|---|---|
| 1 | Rows fetched on first Kanban render, per column | **20** (not the list size) |
| 2 | Column header counts vs SQL, both boards | exact match |
| 3 | Load-more to the end of a column, then compare | union == header count, **0 dupes, 0 gaps** |
| 4 | A column with > 1,000 cards | loads fully via repeated fetches; **no 1,000-row cliff** |
| 5 | Filter applied → column counts and cards both reflect it | filters not silently dropped (§3.4) |
| 6 | Drag a card between columns | both totals adjust; card stays put; no full refetch |
| 7 | Drag into a column with unloaded cards | card appears at top, total +1 |
| 8 | Counselor + branch manager boards | scoped correctly; branch mgr **200, not 503** |
| 9 | Payload size of the Kanban page, before vs after | state both |
| 10 | Round-trips to render the board, before vs after | state both |
| 11 | Phase 2: scroll a long column to the bottom repeatedly | one request per page, no double-fire, no runaway loop |

Seed a large column if none exists (a filtered view of migration-qc's 8,620 is the easiest
realistic source) — **do not** report "fast for Admizz's 47-lead Prospects list" and call it done.

**Gates:** `npm run build` exit 0 · `npx eslint --max-warnings 50` ≤ 45 warnings / 0 errors ·
`npm run test` all passing (baseline 1,077 across 104 files). Add tests: first render requests
one page per column not the whole list; load-more appends without duplicating; header count comes
from the aggregate not from `cards.length`; active filters are present in the column request.

---

## 7. Deliverable

A report with the diff, every number from §6, the before/after payload and round-trip figures,
and anything skipped and why. Phase 1 and Phase 2 as separate commits. **Stop there.**
