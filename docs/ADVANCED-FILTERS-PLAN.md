# Advanced Filters — global filter/view engine for EdgeX

## Context

Today EdgeX filtering is **enum-only and operator-less**. Every filter is "pick one or more values from a fixed list", implicitly `equals`/`in`. There is no `contains`, no `is empty`, no `>`/`<`, no date range, no AND/OR, no way to stack two conditions on the same field, and no way to save a filter.

The audit found the cost of that:

- **UI:** `FilterDef` (`src/components/ui/filter-menu.tsx:12`) is `{ id, label, options, value: string | string[], onChange: (v:any) => void }`. String values only, no operator concept. `leads-table.tsx` and `KanbanBoard.tsx` declare the **same 8 leads filters twice — ~350 duplicated lines**. `applications-filter-menu.tsx` is a deliberate ~215-line verbatim fork. ~10 more surfaces hand-roll their own bars (raw `<select>` in ORCA, native date inputs in timesheet/check-in). Sentinel values are inconsistent across the app (`"all"`, `"__all__"`, `""`, `"_all"`, `"active"`, `[]`, `"__none__"`).
- **Server:** the same predicate set is hand-maintained in **four places** — `getLeads`/`getLeadsPage` (`src/lib/supabase/queries.ts`, whose docstring at L259 literally says the semantics are "copied … not reimplemented"), the ~145-line inline chain in `api/v1/leads/route.ts:307-451`, the `lead_aggregates()` SQL RPC (mig 194), and `src/lib/ai/tools/universal/search-leads.ts`. They have **already drifted** (`?stage=` is missing from facets, documented at `route.ts:462`). The `.or()` ilike search chain is written 4× with 3 different sanitizers — and, when this plan was written, **none at all** at `integrations/crm/leads/route.ts:65`. (That gap was closed out-of-band on 2026-09-02 by #476/#479: all six sites now go through `buildIlikeOrFilter()`. The duplication remains; the injection risk does not.)
- **Metadata:** `columns-registry.tsx` is a *rendering* registry — `renderTd: (lead) => JSX`, no `type`, no operators, no DB-column mapping. Adding a filter axis today means editing 5 files plus a migration.
- **Nothing is saved.** No saved views, no segments. Filter state is ephemeral everywhere except Projects/Tasks.

**Outcome wanted:** one dynamic filter component (Notion / Twenty-CRM standard — the reference screenshots show field search → operator dropdown → value, chip row with "+ Add filter", "Save as new view") backed by **one** filter engine, adaptable to any table / kanban / board, reusable by every entity. Leads first.

**The real thesis:** the value is not the popover. It is **collapsing four hand-maintained predicate mirrors into one compiler**, and making the ~22 legacy query params a thin adapter *into* that compiler — so there is exactly one implementation of "what does `source = X` mean" from day one.

---

## Architecture

```
                        ┌───────────────────────────┐
                        │   FilterTree (the AST)    │  depth-2, zod-validated
                        │  {conjunction, conditions,│  base64url in ?f=
                        │   groups?}                │  or stored in saved_views
                        └─────────────┬─────────────┘
             ┌────────────────────────┼────────────────────────┐
             │                        │                        │
   ┌─────────▼─────────┐   ┌──────────▼──────────┐   ┌─────────▼──────────┐
   │  Field Registry   │   │      Compiler       │   │  useAdvancedFilters│
   │  FieldDef[]       │──►│ compileFilter(tree, │   │  URL-backed hook   │
   │  key/label/type/  │   │   registry, builder)│   │  (modelled on      │
   │  source/operators │   │  → PostgREST calls  │   │  use-workspace-    │
   └───────────────────┘   └──────────┬──────────┘   │   filters.ts)      │
                                      │              └────────────────────┘
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
             /api/v1/leads      getLeadsPage()      search-leads.ts
             (route.ts)         (queries.ts)        (AI tool)
                    │                 │                 │
                    └────────► chains ONTO ◄────────────┘
                          visibleLeadsBase()   ← never replaced
                          (RPC branch | service branch)
```

**Critical invariant:** the compiler receives a builder and returns a builder. It never calls `.from()`, `.select()` or `.rpc()`. Tenant scoping, `leads_visible_to_user` RPC scoping, pipeline/list allow-lists and shared-pool logic stay exactly where they are.

---

## Decisions

| # | Decision | Why |
|---|---|---|
| **D1** | **Depth-2 AST** — root group + one level of sub-groups | Matches Notion and Twenty. Depth is a *TypeScript type* (two interfaces), not a runtime guard — compiler gets exhaustiveness free, no recursion, no stack-depth DoS on a query string. |
| **D2** | **Transport = GET only.** `?f=<base64url(json)>` capped at 4096 chars · `?view=<uuid>` (server-expands, uncapped) · legacy params still accepted | Keeps URLs shareable/bookmarkable and reuses the existing `router.replace` pattern. Dodges the undici ~16KB ceiling that already caused the 300-id counselor bug. POST `/query` was rejected: kills shareability, needs a second auth path, forks the Kanban N-column fan-out. |
| **D3** | **Legacy params compile through the same tree** via `legacyLeadsParamsToTree()` | This is what actually kills the duplication — without it we'd have 5 mirrors, not 4. It is also self-verifying: the existing `route.test.ts` suite becomes a full-fidelity regression harness for the compiler against real production semantics. |
| **D4** | **Field registry is new, pure data, isomorphic** — it does *not* rewrite `columns-registry.tsx` | That file holds JSX and can't be imported server-side. Registry ships standalone; columns join later via an additive `fieldKey?` back-reference. No big-bang. |
| **D5** | **Facet counts: graceful downgrade, not removal.** `treeToAggregateParams(tree)` maps any tree that is expressible in the existing `lead_aggregates()` vocabulary (pure AND, known fields) back to legacy params → **counts stay exact, exactly as today**. Only genuinely new shapes (OR groups, `contains`, `is empty`, custom fields) return `counts: null` and render options without a badge. Falls-back are pino-logged so we know if Phase 9 is ever warranted. | Client asked for counts for stats — a blanket "hide when advanced" is a felt regression. This preserves counts for ~all of today's usage at the cost of one pure, testable function, with zero new SQL and zero new drift surface. |
| **D6** | **Zero new npm dependencies.** No `react-day-picker`; native `<input type="date">` + relative presets. `scroll-area` and a `combobox` composition come from the already-installed `radix-ui@^1.4.3` + `cmdk@^1.1.1`. `zod@^4.4.3` is already a prod dep. | Deliberate de-risk for a Docker-built Next 16 app. |
| **D7** | **v1 = the full Notion/Twenty bar** — operators, stacked conditions, AND/OR, saved views (with columns), custom fields — but **Leads only**, flag-gated, delivered as sequenced independently-revertible PRs. | The reference screenshots include "Save as new view"; a filter widget without views isn't the standard the product is aiming at. Sequencing, not scope-cutting, is how this stays safe. |

---

## The contract

### Filter AST — `src/lib/filters/types.ts` (new)

```ts
export type FilterFieldType =
  | "text" | "number" | "date" | "boolean"
  | "select" | "multiselect" | "uuid" | "tags" | "relation";

export type FilterOperator =
  | "is" | "is_not" | "is_empty" | "is_not_empty"              // universal
  | "contains" | "not_contains" | "starts_with" | "ends_with"  // text
  | "is_any_of" | "is_none_of" | "has_all"                     // sets / arrays
  | "gt" | "gte" | "lt" | "lte" | "between"                    // number
  | "before" | "after" | "on" | "date_between"                 // date
  | "within_last" | "within_next"                              // relative date "7d"|"30d"|"3m"|"1y"
  | "is_true" | "is_false";

export interface FilterCondition {
  id: string;      // stable client key, round-trips through the URL
  field: string;   // REGISTRY key, never a DB column — resolution happens only in the compiler
  op: FilterOperator;
  value?: string | number | boolean | string[] | [number, number] | [string, string];
}

export interface FilterLeafGroup { conjunction: "and" | "or"; conditions: FilterCondition[] }
export interface FilterGroup {
  conjunction: "and" | "or";
  conditions: FilterCondition[];
  groups?: FilterLeafGroup[];   // depth stops here — enforced by the TYPE
}
export type FilterTree = FilterGroup;
```

Zod (`src/lib/filters/schema.ts`) is a **discriminated union on `op`**, so each operator's value shape is validated precisely. Caps: `z.array(...).min(1).max(200)` per list, ≤25 conditions total, `MAX_ENCODED_LEN = 4096`. `src/lib/api/validation.ts` cannot express this — every one of its validators *passes* on an absent or wrong-typed value.

### Field registry — `src/lib/filters/registry/leads.ts` (new)

`FieldSource` is the discriminant that keeps every documented trap out of generic operator code:

```ts
type FieldSource =
  | { kind: "column";       column: string }
  | { kind: "columns";      columns: string[]; fullNamePairs?: boolean }   // the search field
  | { kind: "array_column"; column: string }                               // tags, destinations
  | { kind: "jsonb";        column: "custom_fields"; path: string }
  | { kind: "promoted";     column: string; jsonb: { column: "custom_fields"; path: string } }
  | { kind: "embed";        relation: string; column: string; embedSelect: string }
  | { kind: "virtual";      compile: (c: FilterCondition, ctx: CompileCtx) => string };
```

- `"promoted"` handles the **dual-read trap** (`columns-registry.tsx:1083`): legacy education rows keep `custom_fields.field_of_study` / `.countries` while new rows have real `field_of_study` / `destinations` columns. Positive ops OR the two legs; negative ops AND the two negated legs (De Morgan). One code path, not a per-field remembering exercise.
- `"virtual"` handles the **key ≠ column trap**: `status`→`stage_id ?? status`, `source`→`form_config_id ?? intake_source`, `location`→`city + country`, `created`→`created_at`.
- Derived pseudo-columns (`data_completeness`, `next_task`, `assigned_role`) get `filterable: false` and render greyed with a tooltip.
- `sortColumns` absorbs `SORT_COLUMNS` (`route.ts:102-108`); the unknown-sort→422 behaviour and its test at `route.test.ts:510-516` are preserved verbatim.
- `visibleTo?: (p: ResolvedPermissions) => boolean` — a field hidden in the UI is also **422'd server-side**, not just omitted.

### Compiler — `src/lib/filters/compile.ts` + `pgrst.ts` (new)

Three security rules, in order:

1. **Column names never derive from input.** `registry[cond.field]` must exist and be `filterable`, else 422. Every column string is a `FieldSource` literal. Allow-listing by construction — no code path can splice an attacker string into the column position.
2. **Operators allow-listed** per field type before compilation.
3. **Values always escaped, never "sanitized by deletion."** `pgVal()` quotes and escapes; `pgLike()` escapes `\ % _` in user input *before* adding our own wildcards. This fixes a live bug: the current `search.replace(/[,().]/g, "")` silently mangles `o'brien@x.co.uk`.

Pure-AND trees use **native builder calls** (`.eq/.in/.gte/.contains`) — the fast path that keeps `idx_leads_tenant_created_active` usable. Only OR groups fall back to constructed filter strings.

**The negation rule — the #1 correctness trap, and it is deliberate:** in SQL `col <> 'x'` is NULL (excludes the row) when `col IS NULL`, so a naive "status is not Contacted" silently hides every lead with no status. **Every negative operator compiles to `or(C.is.null, <negation>)`.** Notion, Airtable and Twenty all behave this way. Dedicated vitest describe block covers every negative op × every type.

### UI — `src/components/filters/**` (new)

```
AdvancedFilterBar                      advanced-filter-bar.tsx
├── FilterChipRow → FilterChip         (click a chip → edit in place)
├── ConjunctionToggle ("Where/and/or")
└── AddFilterButton ("+ Add filter")
    └── FilterFieldPicker  (Command + grouped items, searchable — screenshot 1)
        └── FilterConditionEditor
            ├── FilterOperatorPicker   (screenshot 2)
            └── FilterValueEditor      → text | number | date | select | multi-select | boolean
```

`MultiSelectValueEditor` **wraps the existing `FilterOptionList`** from `filter-dropdown.tsx` — that component is genuinely good and is the one piece of today's filter UI worth keeping verbatim.

One component serves table + kanban + board because the host supplies only `{ entity, fields, value, onChange }` plus three cosmetic flags (`density`, `showChips`, `allowGroups`). What each surface *does* with the tree lives in the surface: the table sets `params.set("f", encoded)`; `kanban-column-params.ts` sets it once and fans it into every column request. **Column identity (`statusFilter`/`columnSlug`) is a scope param, not a filter, and must never enter the tree** — that skip logic in `resolveKanbanColumnParams` is unchanged.

### Persistence — `saved_views` (migration 200)

Modelled on `dashboards` (mig 048), which is the proven precedent. Sharing shape = **`granted_position_ids UUID[]`**, not `lead_lists`' `access JSONB` union: the `UUID[]` RLS policy is production-proven and reads in one glance, whereas a JSONB `->>'mode'` extraction inside a per-row RLS predicate is slower and much easier to get subtly wrong.

Columns: `tenant_id, entity, name, description, filter_tree JSONB, sort_key, sort_direction, visible_columns TEXT[], visibility ('private'|'shared'), granted_position_ids UUID[], is_default, sort_order, created_by, timestamps`. Unique on `(tenant_id, entity, lower(name))` and a partial unique on `is_default`.

**A view is not an authorization boundary** — it stores a filter, and that filter still compiles under the caller's own scope. A counselor opening an admin's shared view sees only their own leads. That property gets an explicit test.

---

## Phases

Each phase is one PR to `stage`, independently shippable and independently revertible. Migration numbers are re-checked at PR time (`ls supabase/migrations/ | sort | tail`) — the repo already has duplicate `110/197/198`; do not add to them. **200/201/202 are currently free.**

| # | Phase | Ships | Migration | Rollback |
|---|---|---|---|---|
| **0** | **Perf pre-work** | Kill the unconditional `.not("tags","cs",'{"other"}')` at `route.ts:314` — a negated GIN predicate forcing a **seq scan on every leads request** (exact count measures 432ms on a 16.9k-row tenant). Partial index and/or a generated `is_contact` boolean. `EXPLAIN ANALYZE` baselines captured. | `200_*` | revert PR; index is additive |
| **1** | **Core library** — pure TS, nothing imports it | `src/lib/filters/{types,schema,operators,serialize,pgrst,compile,legacy-leads-params}.ts` + ~120 vitest tests | — | delete the directory |
| **2** | **Server `?f=`** — behaviour-preserving | Lead registry; `route.ts` builds a tree from `f` else `legacyLeadsParamsToTree()`, and `compileFilter` **replaces the 145-line inline chain**. Scope/visibility/allow-list logic untouched. **Gate: the entire existing `route.test.ts` suite must pass unmodified.** | — | revert PR; no data change |
| **2b** | **Kill mirrors 1 & 4** | Point `getLeads`/`getLeadsPage` (`queries.ts`) and `search-leads.ts` at `compileFilter`. The 4× duplicated ilike search chain (incl. `integrations/crm/leads/route.ts:65`, sanitized since #476) collapses to one `search` FieldDef. | — | revert PR |
| **3** | **The UI** — flag-gated `NEXT_PUBLIC_ADVANCED_FILTERS`, leads list view only | `scroll-area.tsx`, `combobox.tsx`, `src/components/filters/**`, `useAdvancedFilters`. **Flag off ⇒ pixel-identical to today** — that's the gate. | — | flip the env var, no deploy |
| **4** | **Kanban + the 350-line deletion** | `KanbanFilterState` collapses to `{ listSlug?, sort*, search, encodedFilter }`. Delete duplicated state (`KanbanBoard.tsx:138-149`) and filterDefs (L594-739). A filter set on the table survives switching to Kanban via the shared URL. | — | revert PR |
| **5** | **Saved views + facet-count downgrade** | `saved_views` + RLS + `/api/v1/saved-views`, `?view=<uuid>` expansion (re-validated through zod on every read), `saved-view-picker.tsx`, `visible_columns` folds in the column manager. `treeToAggregateParams()` lands here (D5). | `201_*` | revert code, leave table |
| **6** | **Custom fields** | `custom_field_definitions` (`key CHECK ~ '^[a-z0-9_]{1,64}$'`) + backfill scan, fed by write-path upsert and form-config publish. **Deletes the client-side page-scoped key discovery at `leads-table.tsx:1399-1409`** — today the available field list changes depending on which page you're on. | `202_*` | revert code, leave table |
| **7** | **Second entity — kill the fork** | `registry/applications.ts`; Applications adopts `AdvancedFilterBar`; **delete `applications-filter-menu.tsx`**. Success criterion: if this requires *any* edit to `compile.ts`/`pgrst.ts`, stop and fix the abstraction. | — | revert PR |
| **8** | **Retire `FilterMenu`; drop the flag** | One PR per remaining surface (timesheet, inbox, check-in, UTM, 3 ORCA toolbars, classes, attendance). Then delete `filter-menu.tsx` + `legacy-leads-params.ts`, remove the env flag and the legacy params. Keep `filter-dropdown.tsx`. | — | per-surface revert |
| **9** | *(only if D5 telemetry says so)* | `p_filter jsonb` + a codegen'd `filter_matches()` SQL function for exact counts on OR/new-operator trees. | — | — |

---

## Risk register (the ones that will actually bite)

| Risk | Failure mode | Mitigation | Test |
|---|---|---|---|
| **PostgREST filter-string injection** | A value containing `,` `)` `.` escapes the value position and injects a predicate — worst case widening a scope filter | Columns only from registry literals; operators allow-listed; values always through `pgVal`/`pgLike` | `pgrst.test.ts` fuzz suite incl. `"a,tenant_id.neq.x"`, unicode, 200-char values |
| **Compiler replaces the visibility base** | Counselors see the whole tenant, or 0 rows | Compiler takes a builder and returns one; never calls `.from()`/`.rpc()`. Enforced by the type signature | Live-DB test: same tree as owner / admin / counselor / branch-scoped; assert counselor ⊆ own leads |
| **`is not` drops NULL rows** | "Status is not Contacted" hides every lead with no status — users read it as data loss | Every negative op compiles to `or(C.is.null, …)` | `describe("negation includes empty")` × every type |
| **Promoted dual-read forgotten/inverted** | Legacy education rows silently vanish; or De Morgan inverted so negation matches everything | It's a `FieldSource` *kind*, one code path for both polarities | Both polarities on `field_of_study` + `destinations`/`countries`; live test with one legacy + one new row |
| **URL exceeds undici 16KB** (already caused a documented prod bug) | Request fails opaquely at the transport layer | Three gates: `.max(200)` per list, `MAX_ENCODED_LEN` client+server → 422 "save this as a view", saved views as the escape valve | 250-UUID `is_any_of` returns 422 with a usable message, not a transport error |
| **Empty pipeline allow-list stops failing closed** | `pipelineAccess.ids === []` must yield 0 rows; an "optimize away empty `.in()`" refactor would leak the tenant | Pipeline predicate is a **scope** predicate applied by the route, never by the compiler. No empty-`in` optimization exists | Existing route test preserved verbatim + compiler test that `is_any_of []` is 422, not a no-op |
| **Timezone-wrong date boundaries** | "Created today" in Kathmandu (UTC+5:45) misses the first 5h45m | Client sends `tz`; `CompileCtx.tz` computes day boundaries; `now` injected for determinism | Frozen `now` across UTC / Asia/Kathmandu / America/New_York incl. a DST day |
| **`is_none_of` across an embed** | `collaborators is none of [X]` compiles to `!inner + not.in` = "has *a* collaborator who isn't X" — semantically wrong and duplicates parent rows | Omitted from `relation` in the operator table; UI never offers it, `planFilter` 422s it | Unit test asserting rejection |
| **Saved view drifts past a schema change** | Stored tree references a deleted field key → 500 on load | Re-run `safeParse` on every read; unknown keys **dropped with a UI warning**, never fatal. Same for a stale URL | View with `{field:"does_not_exist"}` loads, warns, degrades |
| **`scopedClient.delete()` misuse in saved-views routes** | A DELETE with only the auto tenant filter wipes every view in the tenant (`scoped.ts:49-53`, unenforced) | Every mutation chains `.eq("id", viewId)`; called out as a PR review item | DELETE one view leaves the others intact |
| **Facet counts silently *wrong* rather than absent** | Worse than hiding them | When `treeToAggregateParams()` returns null the route **skips `getSourceFacet()` entirely** and returns `counts: null`; UI renders no badge, never a zero | `?f=<unmappable>&facets=source` → `counts: null`; `?facets=source` alone unchanged |
| **Migration number collision** | Repo already has duplicate `110/197/198` | Take the number at PR time after rebasing onto latest `origin/stage` | duplicate-prefix check |

---

## Verification

**vitest (~150 tests, the bulk).** The compiler is a pure function over `(tree, registry) → filter string / builder calls` — exactly the `kanban-column-params.test.ts` shape (`vitest.config.ts` runs `environment: "node"`, `src/**/*.test.ts`). Files: `compile.test.ts`, `pgrst.test.ts` (fuzz), `serialize.test.ts`, `legacy-leads-params.test.ts`, `tree-to-aggregate-params.test.ts`.

**The regression harness.** Because legacy params compile through the new tree (D3), the *existing* `route.test.ts` suite validates the compiler against real production semantics. If one existing test fails, the compiler is wrong. It must pass **unmodified** in Phase 2.

**Live DB (stage `dymeudcddasqpomfpjvt`), a script not CI.**
- Same tree run as owner / admin / counselor (`restrictToSelf`) / branch-scoped user — assert row sets are subsets, per the documented tenant-isolation + counselor-scoping hard gate.
- Every `filterable: true` field hit with `is_not_empty`; a PostgREST 400 means a bad column name (catches the key ≠ column trap).
- `EXPLAIN ANALYZE`: 3-condition AND must use `idx_leads_tenant_created_active`; capture the worst realistic OR.
- Phase 5: member cannot read another member's private view; shared view granted to position A invisible to position B; counselor opening an admin's shared view still sees only their own leads.
- Phase 6: backfill count vs a manual `jsonb_each_text` count; field-picker contents identical on page 1 and page 40.

**Manual UI (per `CLAUDE.md`'s manual gate).** Flag off → pixel-identical to today. Flag on → every operator × every field type; `is not` includes empty rows; a legacy education lead still matches "Field of study is X"; URL survives copy-paste into a new tab; filter set on the table survives switching to Kanban.

---

## Execution note

Per `CLAUDE.md`, this session plans and reviews; **Sonnet executes**. The deliverable from each approved phase is a copy-pasteable brief for the Sonnet session, and this session re-verifies independently rather than trusting the executor's self-report. Phase 0 and Phase 1 are the right first brief — they are the highest-value, lowest-risk work and nothing depends on the UI existing.

## Critical files

- `src/components/ui/filter-menu.tsx` — the `FilterDef` contract being replaced
- `src/components/ui/filter-dropdown.tsx` — `FilterOptionList`, the one piece kept verbatim
- `src/app/(main)/api/v1/leads/route.ts` — the 145-line inline chain (mirror 2) + `SORT_COLUMNS` + facets
- `src/lib/supabase/queries.ts` — `getLeads` / `getLeadsPage` (mirror 1)
- `src/lib/leads/aggregates.ts` + `supabase/migrations/194_*.sql` — `lead_aggregates()` (mirror 3)
- `src/lib/ai/tools/universal/search-leads.ts` — (mirror 4)
- `src/lib/leads/visibility-query.ts` + `supabase/migrations/179_leads_visible_to_user.sql` — the base the compiler chains onto
- `src/lib/supabase/scoped.ts` — the compiler target; note the unenforced update/delete filter rule
- `src/lib/api/permissions.ts` — `ResolvedPermissions`, `leadQueryScope`
- `src/components/dashboard/leads/columns-registry.tsx` — key ≠ column, promoted dual-read
- `src/components/dashboard/leads-table.tsx` + `src/components/pipeline/KanbanBoard.tsx` + `kanban-column-params.ts` — the ~350 duplicated lines
- `src/industries/it-agency/features/project-board/hooks/use-workspace-filters.ts` — the URL-state pattern being generalized
- `supabase/migrations/048_dashboards.sql` — the `saved_views` precedent
