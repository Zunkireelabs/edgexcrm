# ADVANCED FILTERS — handover brief (Anish)

> **Owner from 2026-08-14: Anish.** Previous phases were executed by a Sonnet session against
> `docs/ADVANCED-FILTERS-BRIEF.md`. This file is the continuation brief: what is done, what is
> owed, and the exact next two phases.
>
> **Design context you must read first:** [`ADVANCED-FILTERS-PLAN.md`](./ADVANCED-FILTERS-PLAN.md)
> — all 10 phases, decisions D1–D5, and the risk register. The risk register is the most valuable
> page in this project; several of its entries describe bugs that are one careless refactor away.

---

## 1. Where the project actually is

Phases 0 → 3.5 are **merged to `stage` and promoted to `main`**. `git diff origin/main origin/stage --
src/lib/filters src/components/filters` is empty — the two branches are identical on this feature.
All four feature branches are merged and can be deleted.

| Phase | PR | Branch (merged) | On stage | On main |
|---|---|---|---|---|
| 0 — perf pre-work (partial index for the tags-`other` seq scan) | #367 | `feature/leads-tags-other-seqscan` | ✅ | ✅ |
| 1 — pure-TS filter engine core | #368 | `feature/filter-engine-core` | ✅ | ✅ |
| 2 — lead field registry + server-side `?f=` on the leads route | #369 | `feature/filter-engine-leads-route` | ✅ | ✅ |
| 3 — advanced filter bar UI + facet-count downgrade | #371 | `feature/filter-engine-ui` | ✅ | ✅ |
| 3.5 — wire `NEXT_PUBLIC_ADVANCED_FILTERS` into the image build | #372 | `feature/advanced-filters-stage-flag` | ✅ | ✅ |

**Flag state — verified in both branches:**

- `Dockerfile:27` `ARG NEXT_PUBLIC_ADVANCED_FILTERS`, `Dockerfile:37` `ENV …=$…`
- `.github/workflows/deploy-staging.yml:64` passes `NEXT_PUBLIC_ADVANCED_FILTERS=1`
- `.github/workflows/deploy.yml` (prod) passes **nothing** → the ARG resolves empty → the flag is
  `undefined` → prod renders the **legacy** toolbar.
- Read at `src/components/dashboard/leads-table.tsx:371`:
  `const advancedFiltersEnabled = process.env.NEXT_PUBLIC_ADVANCED_FILTERS === "1";`

So: **the code is on production, the feature is off on production.** Turning it on for prod is one
build-arg line in `deploy.yml` — but do not add it until §2 below is closed.

`NEXT_PUBLIC_*` is inlined at **build time**. Editing `.env.local` on the VPS or restarting the
container will not turn this on or off. It is a rebuild, always.

**What exists in code** (all on both branches):
`src/lib/filters/` — `types.ts`, `schema.ts`, `operators.ts`, `serialize.ts`, `pgrst.ts`,
`compile.ts` (exports `compileFilter` and `planFilter`), `tree-to-aggregate-params.ts`,
`legacy-leads-params.ts`, `registry/leads.ts` (23 field defs), `use-advanced-filters.ts`, plus test
files. `src/components/filters/` — the bar, chip row, field/operator/value pickers.

---

## 2. ⛔ BLOCKING — the Phase 3.5 verification gate was never done

PR #372 was merged with a body that still reads, verbatim:

> *"Draft — verification in progress, will update body before requesting review."*

The proof that phase required (`docs/ADVANCED-FILTERS-BRIEF.md`, "PHASE 3.5 → The verification this
unlocks") was never produced. **This is the outstanding gate before any prod flag flip, and it is
the first thing to do — before writing a line of new code.** Local dev has ~33 leads and physically
cannot prove the thing in question; stage's Admizz tenant has ~16.7k, which is why the flag was put
on stage at all.

Do this on **stage** (`dev-lead-crm.zunkireelabs.com`, DB `dymeudcddasqpomfpjvt`):

1. Leads → **+ Add filter → Assigned to**. Screenshot the counts.
2. For 2–3 counselors, compare each facet count against the DB directly:
   ```sql
   SELECT count(*) FROM leads
   WHERE tenant_id = '<admizz>' AND assigned_to = '<user_id>'
     AND deleted_at IS NULL AND converted_at IS NULL
     AND NOT (tags @> ARRAY['other']::text[]);
   ```
   They must match **exactly**. **A number ≤ 25 that looks like a page size is the failure signal** —
   it means the facet never moved server-side and the whole Phase-2 change is not doing what it
   claims. If you see that, stop and report it; do not start Phase 2b on top of it.
3. Apply the filter; confirm the row count and the chip agree.
4. Stack a second filter — counts must still render (the `treeToAggregateParams` path).
5. Build a tree it cannot express (an OR group, or `contains`) — counts must be **absent**
   (no badge), never a zero. A wrong count is worse than no count; that is decision D5.
6. Sanity-check that page-1 latency is not worse than the legacy toolbar on a 16.7k tenant.

> **Stage lead data is real customer PII** — 16,436 of Admizz's 16,684 leads carry a real phone
> number. Screenshots into our own PR are fine. Do not paste rows anywhere else and do not point any
> third-party service at that data.

Record the result wherever you'd normally record it (a comment on #372 is fine, or the Phase-2b PR
body). If it passes, the prod flag flip becomes a separate one-line PR — take it to Sadin, don't
bundle it into a feature PR.

---

## 3. PHASE 2b — collapse the remaining predicate mirrors

**Branch:** `feature/filter-engine-mirrors` from latest `origin/stage`
**Migration:** none. **Visible surface: NONE** — this is a pure refactor behind unchanged behaviour.

### Read this before you start: the plan overstates this phase

`ADVANCED-FILTERS-PLAN.md` says Phase 2b points `getLeads`/`getLeadsPage` at `compileFilter`. Having
read the current code, **that is not quite right, and following it literally would introduce the
exact bug the risk register warns about.** What `queries.ts` actually contains:

`src/lib/supabase/queries.ts:99-130` (`getLeads`) and `:304-332` (`getLeadsPage`) hold an
`applyFilters` closure whose entire contents are **scope** predicates — `converted_at is null`,
`deleted_at` / `onlyDeleted`, `pipelineIds`, `listId` / `listIds` / `excludeListIds`,
`excludeOtherType`, and (in `getLeadsPage`) the Kanban column identity `status`. There are **no user
filters and no search chain there at all.**

Scope predicates must **never** move into the compiler. Two risk-register entries say so directly:

- *"Compiler replaces the visibility base"* → the compiler takes a builder and returns one; it never
  calls `.from()` or `.rpc()`.
- *"Empty pipeline allow-list stops failing closed"* → `pipelineAccess.ids === []` must yield **zero**
  rows. An "optimize away the empty `.in()`" refactor leaks the whole tenant. This has already caused
  a real production incident (15 Admizz users saw 0 leads); see memory
  `project_empty_pipeline_allowlist_zero_leads`.

So Phase 2b is **not** "route queries.ts through compileFilter". It is the two items below.

### 2b.1 — One `search` implementation (the actual win)

The `.or()` ilike search chain is written more than once, with different sanitizing:

| Where | Line | State |
|---|---|---|
| `src/app/(main)/api/v1/leads/route.ts` | — | ✅ already through the compiler (`search` FieldDef, `registry/leads.ts:117`) |
| `src/lib/ai/tools/universal/search-leads.ts` | 121-131 | per-token `.or()` groups, `display_id` special case |
| `src/app/(main)/api/v1/integrations/crm/leads/route.ts` | 65-66 | **unsanitized** — `search` is interpolated straight into the PostgREST filter string |

`integrations/crm/leads/route.ts:65` is the one that matters beyond tidiness. A `search` value
containing `,` `)` or `.` escapes the value position and injects a predicate into the filter string.
That is the top entry in the risk register ("PostgREST filter-string injection"), and this route is
reachable with an **integration API key** (`crm_live_…`), i.e. by a third party.

Route both call sites through the registry's `search` FieldDef via `compileFilter`. Keep
`search-leads.ts`'s multi-token AND semantics — each token must match somewhere — and keep the
`display_id` exact-match branch; if the registry can't express those, extend the **registry**, not
the call sites. Add a fuzz case to `pgrst.test.ts` for the injection strings (`"a,tenant_id.neq.x"`,
unicode, a 200-char value) if one isn't already there.

**Treat 2b.1 as shippable on its own.** If 2b.2 turns out to be bigger than it looks, ship 2b.1 and
open a follow-up — the injection fix should not wait behind a tidiness refactor.

### 2b.2 — One list-scope helper

This triplet is copy-pasted three times, character for character:

```ts
q.or(`list_id.is.null,list_id.not.in.(${ids.join(",")})`)
```

at `queries.ts:125`, `queries.ts:325`, and `search-leads.ts:99`. Extract one exported helper
(`applyListScope(q, scope)` in `queries.ts` or a small `src/lib/leads/scope.ts` — your call, keep it
next to the thing it scopes) and call it from all three. This is a **scope** helper, deliberately
outside `src/lib/filters/`. Note `excludeListIds` is joined into a filter string too — if those ids
ever stop being UUIDs from our own DB, the same injection reasoning applies.

### Gate

`npm run test` must pass **unmodified** — in particular the whole existing
`src/app/(main)/api/v1/leads/route.test.ts` suite. That suite is the regression harness for real
production semantics; if one existing test needs editing to go green, the refactor is wrong, not the
test. Also `npm run build` and `npx eslint --max-warnings 50`.

PR to `stage`. **Stop at the review gate** — post the PR link and the test output; do not merge.

---

## 4. PHASE 4 — Kanban adopts the shared filter state

**Branch:** `feature/filter-engine-kanban` from latest `origin/stage`, **after 2b merges**
**Migration:** none. **Visible surface: YES** — flag-gated, so both states need a screenshot.

`src/components/pipeline/KanbanBoard.tsx` (936 lines) declares the same eight leads filters that
`leads-table.tsx` declares — the ~350 lines of duplication that motivated the whole project.
Verified anchors on current `origin/stage`:

- `:34` — `import { FilterMenu, FilterChips, type FilterDef } from "@/components/ui/filter-menu"`
- `:138-149` — twelve `useState` calls: `searchQuery`, `debouncedSearch`, `counselorFilter`,
  `sourceFilter`, `collaboratorFilter`, `tagFilter`, `statusFilter`, `formFilter`, `createdFilter`,
  `industryFilter`, `sortField`, `sortDirection`
- `:178` — `const filterState: KanbanFilterState = useMemo(…)`
- `:594` — `const filterDefs: FilterDef[] = [` — the duplicated definitions
- `:787` / `:874` — the `<FilterMenu>` and `<FilterChips>` render sites

Target: `KanbanFilterState` (`src/components/pipeline/kanban-column-params.ts:26`) collapses to
`{ listSlug?, sortField, sortDirection, search, encodedFilter }`. The per-filter `useState` block and
`filterDefs` are deleted; the board reads the tree from the URL through the same
`useAdvancedFilters` hook the table uses.

**The acceptance criterion is continuity:** set a filter on the table, switch to Kanban, and the
filter survives — because both read the same `?f=` from the URL. If it doesn't survive, the phase
isn't done regardless of what the diff deleted.

Constraints:

- Keep `buildKanbanColumnParams` / `resolveKanbanColumnParams` and their existing test file green.
  Column identity (`listSlug`, `status`, `stage_id`) is **scope**, not a user filter — it stays where
  it is. `kanban-column-params.test.ts` passing unmodified is the signal you kept that line intact.
- Flag off ⇒ **pixel-identical to today**, same as Phase 3. That's the gate, and it's what makes this
  revertible without a deploy.
- Per-column lazy loading (PR #343) must still work — don't regress the 50,000-row full-load fix.

Screenshots required in the PR: the board with the flag off, the board with the flag on, and the
table→Kanban filter-survives transition. Per project convention, "unit tests are green" is **not**
verification for a UI phase — a screenshot from a running app is.

PR to `stage`. **Stop at the review gate.**

---

## 5. Still unbuilt after that

From `ADVANCED-FILTERS-PLAN.md` §Phases — don't start these without checking in first, several have
open design questions:

| # | Phase | Note |
|---|---|---|
| 5 | Saved views (`saved_views` + RLS + `/api/v1/saved-views`, `?view=<uuid>`) | Smaller than planned — `treeToAggregateParams()` already landed early in Phase 3. Watch the `scopedClient.delete()` risk-register entry: every mutation must chain `.eq("id", viewId)` or it wipes the tenant's views. Migration number to be taken at PR time. |
| 6 | Custom fields (`custom_field_definitions` + backfill) | Deletes the page-scoped key discovery in `leads-table.tsx` — today the available field list changes depending on which page you're on. |
| 7 | Applications registry; delete `applications-filter-menu.tsx` | Success criterion: if this needs **any** edit to `compile.ts`/`pgrst.ts`, stop — the abstraction is wrong. |
| 8 | Retire `FilterMenu` across remaining surfaces; drop the flag | One PR per surface. |
| 9 | SQL-side `p_filter jsonb` for exact counts on OR trees | **Only if D5 telemetry justifies it.** The fall-backs are pino-logged for exactly this decision — read the logs first. |

---

## 6. Non-negotiables (all phases)

- Branch from **latest `origin/stage`**; rebase again right before merge. Squash-merge to `stage`.
- `stage` is branch-protected and **requires 1 approval** — you cannot self-merge. Neither can Claude.
- **Never merge to `main`.** Never apply anything to the prod DB (`pirhnklvtjjpuvbvibxf`).
- Stop at the review gate on every phase. Post the PR link and the gate output; someone else merges.
- The Vercel PR check always fails and is non-blocking — judge CI on GitHub Actions
  Lint / Type Check / Build / Test only.
- Migration numbers: `ls supabase/migrations/ | sort | tail` at PR time, after rebasing. The repo
  already carries duplicate `110/197/198` — don't add a fourth.
- Full process: `docs/dev-collab/DEV-WORKFLOW-AND-DEPLOYMENT.md`.
