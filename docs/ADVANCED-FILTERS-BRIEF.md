# ADVANCED FILTERS — Sonnet execution brief

> ⚠️ **HISTORICAL — Phases 0, 1, 2, 3 and 3.5 below are all merged to `stage` and promoted to `main`.**
> Keep this file for the design rationale and the Phase 3.5 verification steps, which are still owed.
>
> **If you are picking this project up, start at
> [`ADVANCED-FILTERS-HANDOVER-BRIEF.md`](./ADVANCED-FILTERS-HANDOVER-BRIEF.md)** — current state,
> the blocking Phase 3.5 gate, and the Phase 2b / Phase 4 briefs.
> Full design + all 10 phases + risk register: [`ADVANCED-FILTERS-PLAN.md`](./ADVANCED-FILTERS-PLAN.md).

## Why this exists (read before touching anything)

EdgeX filtering is enum-only and operator-less. We are building a Notion / Twenty-CRM style
filter engine: field → operator → value, stacked conditions, AND/OR, saved views.

**The point is not the popover.** The predicate logic for leads is currently hand-maintained in
**four** places, and they have already drifted:

| # | Mirror | Location |
|---|---|---|
| 1 | `getLeads()` / `getLeadsPage()` | `src/lib/supabase/queries.ts:99-130`, `:304-332` — docstring at L259 says the semantics are *"copied to match getLeads()'s applyFilters exactly, not reimplemented"* |
| 2 | Inline chain in the API route | `src/app/(main)/api/v1/leads/route.ts:307-451` (~145 lines) |
| 3 | `lead_aggregates()` SQL | `supabase/migrations/194_*.sql:97-155` — **already drifted**: no `p_stage_eq`, documented at `route.ts:462-466` |
| 4 | AI tool | `src/lib/ai/tools/universal/search-leads.ts` |

Phase 1 builds the single compiler all four will eventually route through. It is pure TypeScript
with **zero imports from the rest of the app and zero consumers** — the lowest-risk, highest-value
PR in the whole plan.

---

# PHASE 0 — Perf pre-work

**Branch:** `feature/leads-tags-other-seqscan`
**Why first:** advanced filters multiply query cost. Fix the known seq scan now so every later
measurement is against a sane baseline.

## The problem

`src/app/(main)/api/v1/leads/route.ts:314`:

```ts
// Exclude "other" tagged contacts — they live on the /contacts page, not in lead lists
query = query.not("tags", "cs", '{"other"}');
```

This is unconditional on **every** leads request. It is a **negated GIN predicate** — `NOT (tags @> '{"other"}')`
cannot use `idx_leads_tags`, so it forces a seq scan. The route already documents the cost at L152-156:
*"Count is exact but costly (measured 432ms on prod's 16,898-row Admizz tenant — a seq scan forced by the tags filter)."*

The same predicate appears in `src/lib/supabase/queries.ts:115` and `search-leads.ts` — fix all sites consistently.

## Steps

1. **Measure first. Do not guess.** Against **stage** (`dymeudcddasqpomfpjvt`), capture `EXPLAIN (ANALYZE, BUFFERS)` for the Admizz tenant on:
   - default list page (page 1, 25 rows, no filters)
   - list page + 3 filters
   - the exact-count query
   Paste the raw plans into the PR body. This is the baseline for the whole project.

2. **Pick the fix based on what the plan actually shows.** Two candidates, in preference order:

   **A — partial index (purely additive, preferred):**
   ```sql
   CREATE INDEX idx_leads_tenant_created_active_nonother
     ON leads (tenant_id, created_at DESC, id DESC)
     WHERE deleted_at IS NULL AND converted_at IS NULL AND NOT (tags @> ARRAY['other']::text[]);
   ```
   Verify the planner *actually picks it up* — a partial index only helps if Postgres can prove the
   query predicate implies the index predicate. If `EXPLAIN` still shows a seq scan, A has failed; go to B.

   **B — generated column (guaranteed, but rewrites the table):**
   ```sql
   ALTER TABLE leads ADD COLUMN is_contact BOOLEAN
     GENERATED ALWAYS AS (tags @> ARRAY['other']::text[]) STORED;
   CREATE INDEX idx_leads_tenant_created_active_lead
     ON leads (tenant_id, created_at DESC, id DESC)
     WHERE deleted_at IS NULL AND converted_at IS NULL AND is_contact = false;
   ```
   Then all four call sites become `.is("is_contact", false)`.
   ⚠️ `ADD COLUMN ... GENERATED ... STORED` takes an ACCESS EXCLUSIVE lock and rewrites the table.
   Sub-second at ~17k rows, but **state the measured lock duration from stage in the PR**.

3. **Migration number:** `ls supabase/migrations/ | sort | tail` → `200` is free today. **Re-check after
   rebasing onto latest `origin/stage` right before merge** — the repo already has duplicate `110/197/198`
   pairs; do not add another. Transactional, additive, rollback line in the header, before/after counts.
   ⚠️ If you need `CREATE INDEX CONCURRENTLY` it cannot run inside a transaction — see `085_unique_display_id.sql`
   for the precedent, and say so explicitly in the PR.

4. **Verify row counts are byte-identical before/after** on stage for the Admizz tenant, several filter
   combinations. This change must be a pure perf change with zero semantic difference.

**Definition of done:** `npm run build` + `npm run test` green; `npx eslint --max-warnings 50` clean;
before/after `EXPLAIN ANALYZE` in the PR body; identical row counts proven.

**Rollback:** revert the PR. The index is additive and can be left in place.

---

# PHASE 1 — The core filter library

**Branch:** `feature/filter-engine-core`
**Migration:** none. **Consumers: none.** Nothing in the app imports any of this yet — that is deliberate.

## Files to create — `src/lib/filters/`

```
types.ts                  the AST + FieldDef + FieldSource + CompileCtx
schema.ts                 zod validation (discriminated union on `op`)
operators.ts              OPERATORS_BY_TYPE + isOperatorAllowed()
serialize.ts              base64url encode/decode + size caps
pgrst.ts                  ★ security-critical: escaping/quoting for PostgREST filter strings
compile.ts                compileFilter() — the one predicate implementation
legacy-leads-params.ts    legacyLeadsParamsToTree() — the ~22 existing GET params → a tree
```

plus tests: `compile.test.ts`, `pgrst.test.ts`, `serialize.test.ts`, `legacy-leads-params.test.ts`.

`vitest.config.ts` runs `environment: "node"` over `src/**/*.test.ts`. Everything here must be a
**pure function** — no React, no DOM, no Supabase import. Model the shape on the existing
`src/components/pipeline/kanban-column-params.test.ts`, which is the only unit-tested filter code today.

## 1. `types.ts`

```ts
export type FilterFieldType =
  | "text" | "number" | "date" | "boolean"
  | "select" | "multiselect" | "uuid" | "tags" | "relation";

export type FilterOperator =
  | "is" | "is_not" | "is_empty" | "is_not_empty"
  | "contains" | "not_contains" | "starts_with" | "ends_with"
  | "is_any_of" | "is_none_of" | "has_all"
  | "gt" | "gte" | "lt" | "lte" | "between"
  | "before" | "after" | "on" | "date_between"
  | "within_last" | "within_next"       // "7d" | "30d" | "3m" | "1y"
  | "is_true" | "is_false";

export interface FilterCondition {
  id: string;      // stable client key, round-trips through the URL
  field: string;   // REGISTRY key — NEVER a DB column. Resolution happens only in compile.ts
  op: FilterOperator;
  value?: string | number | boolean | string[] | [number, number] | [string, string];
}

export interface FilterLeafGroup { conjunction: "and" | "or"; conditions: FilterCondition[] }

export interface FilterGroup {
  conjunction: "and" | "or";
  conditions: FilterCondition[];
  groups?: FilterLeafGroup[];   // depth STOPS here — enforced by the type, not a runtime guard
}

export type FilterTree = FilterGroup;
export const EMPTY_TREE: FilterTree = { conjunction: "and", conditions: [] };
```

Depth-2 is deliberate: two distinct interfaces means `compileGroup` is two non-recursive functions —
no cycle guard, no stack-depth DoS surface on a user-supplied query string.

`FieldSource` is the discriminant that keeps every known trap out of generic operator code:

```ts
export type FieldSource =
  | { kind: "column";       column: string }
  | { kind: "columns";      columns: string[]; fullNamePairs?: boolean }  // the search field
  | { kind: "array_column"; column: string }                              // tags, destinations
  | { kind: "jsonb";        column: "custom_fields"; path: string }
  | { kind: "promoted";     column: string; jsonb: { column: "custom_fields"; path: string } }
  | { kind: "embed";        relation: string; column: string; embedSelect: string }
  | { kind: "virtual";      compile: (c: FilterCondition, ctx: CompileCtx) => string };
```

`FieldDef` carries: `key, label, type, source, operators?, options?, emptyIsBlankString?, industries?,
group, icon? (lucide name as a STRING), filterable, sortable?, sortColumns?, columnKey?, accessor?,
visibleTo?`. Full annotated declaration is in §2.2 of the plan file — copy it verbatim.

`CompileCtx` must carry `{ tz: string; now: Date; industryId: string | null; permissions: ResolvedPermissions }`.
**`now` is injected, never `Date.now()` inside the compiler** — otherwise the date tests are non-deterministic.

## 2. `schema.ts` — zod

`zod@^4.4.3` is already a prod dependency (`package.json:54`). This is its first non-AI use, and that is
intentional: `src/lib/api/validation.ts` is body-only and **every one of its validators returns `null`
(pass) for an absent or wrong-typed value** — it structurally cannot gate a recursive tree.

Use a **discriminated union on `op`** so each operator's value shape is validated precisely
(no-value ops carry no `value`; list ops carry `string[]`; `between` carries a tuple; etc.).

Hard caps — these are the URL-size defence, not cosmetics:
- `z.array(z.string().min(1).max(200)).min(1).max(200)` per list operator
- ≤12 conditions per leaf group, ≤20 root conditions, ≤5 groups, **≤25 conditions total** via `.refine()`
- `.min(1)` on list values so `is_any_of []` is a **422, never a silent no-op** (see the empty-pipeline-allow-list risk)

Full schema in §1.2 of the plan file.

## 3. `serialize.ts`

```ts
export const FILTER_PARAM = "f";
export const VIEW_PARAM = "view";
export const MAX_ENCODED_LEN = 4096;   // budget under undici's ~16KB header block, after cookies

export function encodeFilterTree(tree: FilterTree): string;          // base64url(JSON), unpadded
export function decodeFilterTree(raw: string):
  | { ok: true; tree: FilterTree }
  | { ok: false; errors: Record<string, string[]> };                 // → apiValidationError()
export function isEmptyTree(tree: FilterTree): boolean;
export function countActiveConditions(tree: FilterTree): number;
```

base64url over `encodeURIComponent`: percent-encoding inflates `{ " ,` ~3×; base64 is a flat 1.33×.
`MAX_ENCODED_LEN` exists because oversized `.in()` lists have **already caused a production bug**
(the 300-id counselor visibility cap). Exceeding it must produce a 422 with an actionable message
("too many values — save this as a view"), never an opaque transport failure.

## 4. `pgrst.ts` — ★ THE SECURITY-CRITICAL FILE

Three rules, in this order. Get these wrong and we ship a filter-injection hole.

1. **Column names are NEVER derived from input.** `registry[cond.field]` must exist and be
   `filterable: true`, else 422. Every column string comes from a `FieldSource` literal in the
   registry. This is allow-listing *by construction* — there must be no code path that can splice
   an attacker string into the column position. Same discipline as the existing `SORT_COLUMNS`
   allow-list (`route.ts:102-108`) and its 422 regression test (`route.test.ts:510-516`).
2. **Operators are allow-listed** per field type via `isOperatorAllowed(field, op)` *before* compilation.
3. **Values are always escaped — never "sanitized by deletion."**

```ts
const NEEDS_QUOTE = /[,.:()"'\\{}\[\]\s]/;

export function pgVal(raw: string): string {
  if (raw === "") return '""';
  if (!NEEDS_QUOTE.test(raw)) return raw;
  return `"${raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function pgLike(raw: string, mode: "contains" | "prefix" | "suffix" | "exact"): string {
  const lit = raw.replace(/([\\%_])/g, "\\$1");     // escape USER wildcards first…
  const pat = mode === "contains" ? `%${lit}%`
            : mode === "prefix"   ? `${lit}%`
            : mode === "suffix"   ? `%${lit}`
            : lit;                                   // …then add OURS outside the escape
  return pgVal(pat);
}

export function pgCol(column: string, jsonPath?: string): string {
  if (!jsonPath) return column;
  if (!/^[a-z0-9_]{1,64}$/i.test(jsonPath)) throw new FilterCompileError("bad jsonb key");
  return `${column}->>${jsonPath}`;
}

export const and = (...p: string[]) => (p.length === 1 ? p[0] : `and(${p.join(",")})`);
export const or  = (...p: string[]) => (p.length === 1 ? p[0] : `or(${p.join(",")})`);
export const not = (p: string) => `not.${p}`;
```

This also **fixes a live bug**: the current `search.replace(/[,().]/g, "")` (`route.ts:379`) silently
mangles legitimate input like `o'brien@x.co.uk`. Proper quoting replaces deletion.

Array literals (`tags.eq.{}` for "is empty") emit `{}` as a bare constant, never built from input.

## 5. `compile.ts`

```ts
compileFilter<B>(builder: B, tree: FilterTree, registry: FieldRegistry, ctx: CompileCtx): B
```

**The invariant that keeps tenant isolation intact — do not violate it:**
`compileFilter` **receives a builder and returns a builder. It must NEVER call `.from()`, `.select()`
or `.rpc()`.** Tenant scoping, the `leads_visible_to_user` RPC (`src/lib/leads/visibility-query.ts`,
`supabase/migrations/179_*.sql`), pipeline/list allow-lists and shared-pool logic all stay exactly
where they are. A compiler that constructs its own base query will either leak the whole tenant to a
counselor or return zero rows — both have precedent in this repo.

Consequence: the compiler is **client-agnostic** and works identically on the RPC branch
(`userClient.rpc(...)`, RLS-enforced) and the service branch. It also emits **no RPC args**, so the
"never pass explicit `null` in RPC args" rule (PostgREST serializes JS `null` as the string `"null"` → 22P02)
stays entirely inside `visibility-query.ts`.

**Two output modes:**
- **Pure-AND trees → native builder calls** (`.eq/.in/.gte/.contains/.ilike`). This is the fast path and
  it is what keeps `idx_leads_tenant_created_active` usable. Prefer it whenever the condition is not
  inside an OR.
- **OR groups → constructed filter strings** via `pgrst.ts`, applied with a single `.or(...)`.

**The negation rule — the #1 correctness trap, and it is deliberate:**
In SQL, `col <> 'x'` evaluates to NULL (i.e. *excludes* the row) when `col IS NULL`. So a naive
"status is not Contacted" silently hides every lead with no status — users read that as data loss.
**Every negative operator compiles to `or(C.is.null, <negation>)`.** Notion, Airtable and Twenty all
behave this way. Put this in a comment block at the top of `compile.ts` and give it a dedicated
`describe("negation includes empty rows")`.

**Trap handling, one code path each:**
- `kind: "promoted"` — positive ops **OR** the two legs (real column, legacy `custom_fields` path);
  negative ops **AND** the two negated legs (De Morgan). Without this, legacy Admizz education rows
  silently vanish from a "Field of study is X" filter. Note `destinations` ↔ legacy `custom_fields.countries`
  (path ≠ column name).
- `kind: "virtual"` — `status`→`stage_id ?? status`, `source`→`form_config_id ?? intake_source`,
  `location`→`city + country`, `created`→`created_at`. The registry key is NOT the column name.
- `is_none_of` on `kind: "embed"` is **not supported** — `!inner + not.in` means "has *a* collaborator
  who isn't X", which is semantically wrong and duplicates parent rows. Omit it from `relation` in
  `OPERATORS_BY_TYPE`; `planFilter` must 422 it.
- Dates: compute day boundaries from `ctx.tz`, never from server-local time. Kathmandu is UTC+5:45 —
  a naive "created today" misses the first 5h45m of leads.

The complete **operator × field-type mapping table** (every cell specified, incl. jsonb containment
via `custom_fields.cs.{"k":"V"}` which is GIN-backed) is §3.4 of the plan file. Implement it exactly.

## 6. `legacy-leads-params.ts`

```ts
export function legacyLeadsParamsToTree(sp: URLSearchParams): FilterTree
```

Converts the existing toolbar params — `status, search, form, tag, created, industry, source (csv),
assignees (csv), collaborators (csv)` — into a `FilterTree`.

**Do NOT include scope params**: `list`, `funnel`, `stage`, `branch_id`, `assigned_to`, `include_converted`,
`page`, `pageSize`, `count`, `sort`, `order`, `facets`. Those are *scope*, applied by the route, and must
never enter the tree. In particular the pipeline allow-list stays a route-applied predicate so
`pipelineAccess.ids === []` keeps failing closed (`.in("pipeline_id", [])` → 0 rows).

**This function is the whole de-duplication strategy.** In Phase 2 the route will build a tree from
`?f=` *or* from these legacy params and run both through the same compiler — which makes the existing
`route.test.ts` suite a full-fidelity regression harness against real production semantics.

## Tests — ~120, and they are the deliverable

- **`pgrst.test.ts` — fuzz `pgVal`/`pgLike`/`pgCol`** with `, . ( ) " \ ' % _ { } \n`, unicode, 200-char
  values, and specifically the injection probe **`"a,tenant_id.neq.x"`**. Assert the output cannot break
  out of the value position.
- **`compile.test.ts`** — every operator × every field type against the §3.4 table. Plus:
  - `describe("negation includes empty rows")` — every negative op × every type emits `or(C.is.null, …)`
  - promoted dual-read, **both polarities**, on `field_of_study` and `destinations`/`countries`
  - `is_any_of []` throws/422s rather than becoming a no-op
  - `is_none_of` on a `relation` field is rejected
  - dates with a **frozen `ctx.now`** across `UTC`, `Asia/Kathmandu`, `America/New_York`, including a DST-transition day
- **`serialize.test.ts`** — round-trip; a 250-UUID `is_any_of` is rejected with a usable message, not a transport error
- **`legacy-leads-params.test.ts`** — each legacy param produces the expected condition; scope params are ignored

## Definition of done (Phase 1)

- `npm run test` green, `npm run build` clean, `npx eslint --max-warnings 50` clean
  (build-clean has red-deployed before — lint separately, per SOP)
- Nothing outside `src/lib/filters/` is modified
- PR to **`stage`** (never `main`), rebased onto latest `origin/stage`

## STOP HERE

Do not start Phase 2. Do not merge without the review gate — post the PR link and the test output,
and wait. Historically this step has been skipped; it is not optional.

---

---

# PHASE 0-FIXUP — renumber migration 200 → 201

**Branch:** existing `feature/leads-tags-other-seqscan` (amend PR #367, do not open a new one)
**Visible surface: NONE.**

## Why

**PR #366** (`feature/classes-managers-fees-lockdown`, Anish's work — open, unmerged) already owns
`200_class_managers.sql`, and it is **already applied to the stage ledger** (2026-08-06 17:36). Our
`200_leads_tags_other_partial_index.sql` is a second file with the same number.

Root cause of the miss: the brief said to take the next number from `ls supabase/migrations/ | sort | tail`,
which returns `199` — because #366's file is not merged to `stage` yet. **Checking the repo alone is not
enough.** The number must be free across: repo files **+ every open PR's migration files + the stage ledger.**

Verified 2026-08-07: `201` is free on all three. Only #366 and #367 claim 200; the other open PRs with
migrations are stale (100/101/138-142).

## This does NOT depend on Anish's PR

Zero file overlap between #366 and #367/#368 — no merge conflict, no ordering dependency. **Do not wait
for #366 to merge, and do not touch his branch.** We renumber ours; his work is untouched either way.

## Steps

1. `git mv supabase/migrations/200_leads_tags_other_partial_index.sql supabase/migrations/201_leads_tags_other_partial_index.sql`
2. Update the `INSERT INTO public.schema_migrations (version) VALUES (...)` line inside the file to the new filename.
3. Fill in the `-- Applied: stage <YYYY-MM-DD>` placeholder in the header — it is still literally `<YYYY-MM-DD>`.
4. On the **stage DB only** (`dymeudcddasqpomfpjvt`), delete the now-stale ledger row so the pipeline
   re-applies cleanly under the new name:
   `DELETE FROM public.schema_migrations WHERE version = '200_leads_tags_other_partial_index.sql';`
   Re-application is a **no-op** — `CREATE INDEX CONCURRENTLY IF NOT EXISTS` and the index already exists.
   Do not drop the index. Do not touch the `200_class_managers.sql` row.
5. Rebase onto latest `origin/stage`, force-push, re-check the number is still free before merge.

**Proof required in the PR body:** `psql` output showing the ledger no longer has the old row, and that
`idx_leads_tenant_created_active_nonother` still exists.

---

# PHASE 2 — Lead field registry + server-side `?f=`

**Branch:** `feature/filter-engine-leads-route` (branch from `stage` **after** Phase 1 merges)
**Migration:** none. **Visible surface: NONE** — `?f=` has no UI until Phase 3; this phase is
behaviour-preserving by construction.

## Goal

Kill **mirror 2**: replace the ~145-line inline `.eq/.in/.or/.contains/.gte` chain at
`src/app/(main)/api/v1/leads/route.ts:307-451` with a single `compileFilter()` call, and route the
existing legacy params through the same tree.

**The gate that makes this safe:** because legacy params compile through the new tree, the existing
`route.test.ts` suite becomes a full-fidelity regression harness against real production semantics.
**It must pass completely unmodified.** If you find yourself editing an existing test to make it green,
stop — the compiler is wrong, not the test.

## Work

### 1. Add `planFilter` to `src/lib/filters/` — Phase 1 omitted it

Phase 1 exports only `compileFilter`. That is not sufficient for this route, because of a real ordering
constraint at `route.ts:295-302`:

```ts
const selectColumns: string = collaboratorIds.length > 0
  ? `${LEADS_LIST_COLUMNS},lead_collaborators!inner(user_id)`
  : LEADS_LIST_COLUMNS;
```

`.select()` is called **before** `compileFilter` would run, so the route must know *in advance* whether
the tree contains an `embed`-kind condition. Add:

```ts
export function planFilter(tree: FilterTree, registry: FieldRegistry, ctx: CompileCtx):
  | { ok: true; embeds: string[] }                       // e.g. ["lead_collaborators!inner(user_id)"]
  | { ok: false; errors: Record<string, string[]> };     // → apiValidationError() 422
```

`planFilter` validates every condition (unknown field / not filterable / operator not allowed /
`visibleTo` denies) **up front and returns all errors**, rather than `compileFilter` throwing mid-chain
on the first bad one. The route calls `planFilter` → 422 on error → uses `embeds` to build `selectColumns`
→ then `compileFilter`. Add unit tests for it alongside the Phase 1 suite.

### 2. `src/lib/filters/registry/{index,leads}.ts`

`leadFields(ctx)` returns `FieldDef[]`, industry- and permission-filtered. Cover at minimum the 9 axes the
toolbar has today (status, search, form, tag, created, industry, source, assignees, collaborators) plus the
obvious first-class columns. Traps to encode as `FieldSource` kinds, not as special cases:

- `status` → `virtual` (`stage_id ?? status`), `source` → `virtual` (`form_config_id ?? intake_source`),
  `location` → `virtual` (`city + country`), `created` → column `created_at`. **The registry key is not the column name.**
- `field_of_study` / `destinations` → `promoted` (legacy rows carry `custom_fields.field_of_study` /
  `custom_fields.countries` — note path ≠ column name).
- `collaborators` → `embed` with `embedSelect: "lead_collaborators!inner(user_id)"`.
- `data_completeness`, `next_task`, `assigned_role` → `filterable: false`.
- **No `cf:*` custom fields in this phase** — that is Phase 6.

Fold `SORT_COLUMNS` (`route.ts:102-108`) into `FieldDef.sortColumns`. The unknown-sort → **422** behaviour
and its regression test (`route.test.ts:510-516`, `?sort=custom_fields->x`) must survive byte-identically.

### 3. Rewrite the route's predicate section

Build the tree from `?f=` (via `decodeFilterTree`, enforcing `MAX_ENCODED_LEN` → 422) **else** from
`legacyLeadsParamsToTree(searchParams)`. Then `planFilter` → `compileFilter`.

**Leave these completely alone** — they are *scope*, not filters, and must never enter the tree:
`list`, `funnel`, `stage`, `branch_id`, `assigned_to`, `include_converted`, `page`, `pageSize`, `count`,
`sort`, `order`, `facets`, the `visibleLeadsBase()` call and its two-client split, the pipeline allow-list
(`.in("pipeline_id", [...])` — **must keep failing closed on `[]`**), the shared-pool `.in("assigned_to", …)`,
the list/funnel/recycle-bin resolution at L207-264, and the `.not("tags","cs",'{"other"}')` exclusion.

**Facets:** if `?f=` is present, skip `getSourceFacet()` entirely and return `counts: null` — do **not**
pass partial params to `lead_aggregates()`, which would produce subtly *wrong* counts (worse than none).
The `treeToAggregateParams()` downgrade that restores exact counts lands in Phase 5. `?facets=source`
without `?f=` must behave exactly as today.

### 4. Do NOT touch in this phase

`src/lib/supabase/queries.ts` (`getLeads`/`getLeadsPage`) and `src/lib/ai/tools/universal/search-leads.ts`.
Those are Phase 2b. One mirror at a time.

## Proof required in the PR body

- Full `route.test.ts` output showing it passes **unmodified** (`git diff` on that file must be empty,
  except for genuinely new tests you *add*).
- New equivalence tests: for each legacy param, `?f=<equivalent tree>` and the legacy form return
  byte-identical result sets on stage.
- **Live stage run as four roles** — owner, admin, counselor (`restrictToSelf`), branch-scoped — with the
  same tree. Assert counselor's rows ⊆ their own leads and branch rows ⊆ branch leads. This is the
  documented tenant-isolation / counselor-scoping hard gate; a compiler that replaced the visibility base
  would show up here and nowhere else.
- `EXPLAIN ANALYZE` on a 3-condition pure-AND tree confirming `idx_leads_tenant_created_active` is still used
  (the native fast path must not have degraded into `.or()` strings).

## Definition of done

`npm run test` green, `npm run build` clean, `npx eslint --max-warnings 50` clean, PR to `stage`,
**stop at the review gate.** Do not start Phase 3.

---

# PHASE 3 — The UI (first visible surface)

**Branch:** `feature/filter-engine-ui` from latest `origin/stage`
**Migration:** none.
**⚠️ THIS PHASE HAS A VISIBLE SURFACE — the PR is not acceptable without a screenshot from local dev.**

Phases 0/1/2 are merged and deployed to stage: migration `201`, `src/lib/filters/` core, the lead
registry, and `?f=` live on `GET /api/v1/leads`. The server already understands advanced filters;
this phase is the Notion/Twenty-style bar that produces them.

## 0. First — the carried-forward correctness fix

`compileAssignees` in `src/lib/filters/registry/leads.ts` ends with:

```ts
return "id.not.is.null"; // no valid tokens — legacy applies no filter in this case
```

That comment is **accurate** — legacy `route.ts`'s tri-branch has no final `else`, so
`?assignees=garbage` genuinely applies no filter today. It was correct to preserve in Phase 2.

**But it breaks the moment this phase ships OR groups.** A tautology inside `or(...)` makes the entire
group match every row, and it is reachable via `?f=` with
`{field:"assignees", op:"is_any_of", value:["garbage"]}` (zod permits it — a non-empty array of strings).

**Fix: let the compiler DROP a no-op condition instead of emitting a tautology.** Have the per-condition
compile path return `null` for "contributes nothing", and have `compileGroup` filter those out before
joining. Dropping is identical to a tautology inside AND (so Phase 2's byte-identical contract holds),
and correct inside OR (the leg simply isn't there). If dropping empties a group entirely, the group
contributes nothing rather than becoming `or()` of nothing.

Tests: the legacy `?assignees=garbage` equivalence test must still pass, plus a new one proving
`or(<dropped>, X)` compiles to just `X` — **not** to something matching everything.

## 1. shadcn primitives to add

Both compose from packages already installed — **no new npm dependencies**.

| File | Built from |
|---|---|
| `src/components/ui/scroll-area.tsx` | `radix-ui@^1.4.3` unified package — `import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"`, same import style as the existing `popover.tsx` |
| `src/components/ui/combobox.tsx` | A thin Popover + Command composition (not an upstream shadcn primitive). `popover.tsx` and `command.tsx` (cmdk `^1.1.1`) both already exist. |

**Do not add `react-day-picker` / `calendar.tsx`.** Date editing is native `<input type="date">` inside
the existing `Input` (two of them for `between`) plus relative presets (Today / Last 7 days / Last 30 days
/ This month). Zero deps, native mobile pickers, and it covers the operator set. Revisit only if asked.

## 2. Component tree — `src/components/filters/`

```
AdvancedFilterBar                      advanced-filter-bar.tsx
├── FilterChipRow → FilterChip         click a chip to edit it in place
├── ConjunctionToggle                  "Where / and / or" — hand-rolled 2-state, no toggle-group primitive
└── AddFilterButton  "+ Add filter"
    └── FilterFieldPicker              Command + CommandInput + grouped items  (reference screenshot 1)
        └── FilterConditionEditor
            ├── FilterOperatorPicker   options from isOperatorAllowed()        (reference screenshot 2)
            └── FilterValueEditor      dispatch on field.type + operator arity
                ├── text · number (1 or 2 inputs for `between`) · date
                ├── select · boolean
                └── multi-select  ← WRAPS the existing FilterOptionList
```

`MultiSelectValueEditor` must **reuse `FilterOptionList` from `src/components/ui/filter-dropdown.tsx`**
rather than reimplement it. That component (search + checkbox rows + clear) is the one piece of today's
filter UI worth keeping verbatim. Do not fork it.

Match the reference screenshots: chips read `Name: brian ✕`, with `+ Add filter` inline after them.

## 3. What the host supplies

```ts
export interface FilterHostConfig<Row = unknown> {
  entity: EntityKey;
  fields: FieldDef<Row>[];            // already industry- and permission-filtered
  value: FilterTree;
  onChange: (next: FilterTree) => void;
  density?: "comfortable" | "compact";   // kanban toolbar is tight
  showChips?: boolean;
  allowGroups?: boolean;                 // depth-2 UI; false on narrow toolbars
  maxConditions?: number;                // default 25
  optionOverrides?: Partial<Record<OptionLoaderKey, FilterOption[]>>;
}
```

Only `fields`/`value`/`onChange` plus three cosmetic flags differ between surfaces — that is what makes
one component serve table, kanban and board. **Do not add surface-specific branches inside the bar.**

Async option loaders (`members`, `stages`, `lists`, `forms`, `tags`, `sources`, …) go in a single
`use-filter-options.ts` with caching, so the field picker doesn't fire a request per dropdown open.
`optionOverrides` exists because Kanban already has `stages` in props.

## 4. State — `src/lib/filters/use-advanced-filters.ts`

URL-backed, modelled on the existing `src/industries/it-agency/features/project-board/hooks/use-workspace-filters.ts`
(the only URL-backed filter state in the app today — read it first and follow its shape, including
`router.replace(..., { scroll: false })`).

Reads/writes `?f=` via Phase 1's `encodeFilterTree`/`decodeFilterTree`. A malformed or stale `?f=`
must **degrade with a toast, never crash** — drop unknown field keys and keep the rest.

Enforce `MAX_ENCODED_LEN` client-side too, with a real message ("too many values — save this as a view"),
so the user hits a good error rather than a transport failure.

## 5. Wiring into the leads table

`src/components/dashboard/leads-table.tsx` — **a high-conflict shared file. Rebase onto latest
`origin/stage` immediately before merge and resolve hunk-by-hunk, never "keep my whole file."**

- Render `AdvancedFilterBar` when `NEXT_PUBLIC_ADVANCED_FILTERS === "1"`, else the existing `FilterMenu`.
  **Both paths must work** — this flag is the kill switch.
- Flag on: `buildFetchParams` sets `f` and **stops setting** the 8 legacy filter params.
  `fetchSignature` must include the encoded tree, or the table won't refetch on filter change.
- Flag off: **pixel-identical to today.** That is the gate.
- Add `@deprecated` JSDoc to `FilterDef` / `FilterMenu` / `FilterChips` pointing at the new bar.
- **Kanban is Phase 4** — don't touch `KanbanBoard.tsx` or `kanban-column-params.ts`.

## 6. Proof required in the PR body

- **A screenshot (or short recording) of the filter bar working on local dev.** Non-negotiable. Show at
  minimum: the field picker open, an operator dropdown open, and two stacked chips filtering real rows.
- Flag **off** screenshot proving the old toolbar is unchanged.
- Manual matrix: every operator × every field type actually exercised.
- `is not` on a field with empty values **includes** the empty rows (the negation rule — verify in the UI,
  not just in a unit test).
- A URL with `?f=` copy-pasted into a fresh tab reproduces the same filtered view.
- `npm run test`, `npm run build`, `npx eslint --max-warnings 50` all clean.

## 7. Stop

PR to `stage`, **stop at the review gate.** Do not start Phase 4 (Kanban) or Phase 5 (saved views).

---

# PHASE 3 ADDENDUM — facet counts (regression fix + server-side move)

Found during Sadin's manual testing of the Phase 3 branch. Fold into the **same** PR — the bar must
not ship with a visible count regression.

## A. The regression

`origin/stage`'s legacy filter menu shows counts on **Assigned To** and **Collaborators**
(`Sadin (42)`) and **hides zero-count people** so the list stays short. The new
`advancedFilterOptionOverrides` in `leads-table.tsx` kept counts on `source` only:

```ts
source:        `${s} (${sourceCounts.get(s) ?? 0})`          // ✓ counts
assignees:     memberNames[userId] || email.split("@")[0]     // ✗ dropped
collaborators: same                                            // ✗ dropped
```

It also lists every counselor instead of only those with leads. Both must be restored.

## B. Do NOT just port the legacy label — the legacy number is wrong

`counselorCounts` (`leads-table.tsx`) is computed from `localLeads`, which is set from the fetched
page (`setLocalLeads(body.data)`). Under server pagination that's **25 rows**, so `Sadin (3)` means
"3 on this page", not "3 in the tenant". It is also a **fifth mirror** of the predicate set — it
re-implements source/tag/status/form/created matching client-side to cross-filter.

Migration 194 already fixed exactly this for Source by moving it server-side; Assigned To never got
the same treatment (see 194's own header comment about the "current 25-row page only").

## C. The server-side number already exists

`lead_aggregates()` **already returns a `counselor` dimension** — `assigned_to`-keyed with an
`"(unassigned)"` sentinel (`LeadAggregates.counselor` in `src/lib/leads/aggregates.ts`). It currently
feeds `LeadsByCounselorChart`. **No migration needed** — wire it into the facet path the way `source`
already is (`getSourceFacet()` + the `?facets=source` branch in `route.ts`), then delete the
client-side `counselorCounts` memo.

Extend the facet param to accept more than one dimension (e.g. `?facets=source,assignee`) so the
table makes **one** facet round-trip, not two. Keep `?facets=source` alone behaving exactly as today.

Collaborator counts have no existing dimension. **Do not add one in this PR** — collaborators come
from a join table (`lead_collaborators`) and that's a bigger change. Instead: keep the existing
client-side collaborator count, and add a code comment saying it is page-scoped and pending the same
server-side move. Being explicitly inconsistent-and-labelled beats silently shipping two different
meanings of the same-looking number.

## D. Scope: universal, no industry gate

Assignee counts are not education-specific. The legacy code gates on `isAdmin || isTeamScoped`,
**never on industry** — keep it that way. This is a Global feature per `CLAUDE.md`'s taxonomy;
adding an industry gate would be a regression, not a feature.

## E. Pull `treeToAggregateParams()` forward from Phase 5

Phase 2 made the route **skip facets entirely and return `counts: null`** whenever `?f=` is present
(correctly — a partial translation would give subtly wrong counts). But that means counts would
disappear the moment a user adds an advanced filter, which is exactly when they want them. The
client has asked for these counts twice; that regression is not acceptable.

Add `src/lib/filters/tree-to-aggregate-params.ts`:

```ts
export function treeToAggregateParams(tree: FilterTree, registry: FieldRegistry):
  | { ok: true; params: LeadAggregateFilterParams }   // expressible in lead_aggregates()'s vocabulary
  | { ok: false; reason: string };                    // OR group / contains / is_empty / cf:* → caller skips facets
```

Rules: a **pure-AND** tree whose every condition maps onto an existing `lead_aggregates()` param
returns `ok: true` and exact counts are preserved. Anything else (any OR group, any operator the RPC
can't express, any unknown field) returns `ok: false` and the route keeps today's `counts: null`
behaviour. `pino`-log every fall-back with the reason, so we learn whether Phase 9's SQL-side
evaluator is ever actually warranted.

**Never emit a partial translation.** Wrong counts are worse than absent counts.

## F. Proof required (in addition to the Phase 3 screenshots)

- Screenshot of Assigned To showing counts, with zero-count people absent.
- On stage's Admizz tenant (16k+ leads): a counselor's facet count matches
  `SELECT count(*) FROM leads WHERE assigned_to = … AND deleted_at IS NULL AND converted_at IS NULL`
  — i.e. **tenant-wide, not 25-capped**. This is the whole point of the change; prove the number moved.
- Counts still present with an advanced filter active (the §E path), and correctly **absent**
  (`counts: null`, no badge, never a zero) for an OR-group tree.
- Unit tests for `treeToAggregateParams`: pure-AND maps; OR group → `ok:false`; `contains` → `ok:false`.

## G. The Apply bug — diagnose before patching

Do **not** shotgun this. The chain `handleApply → onAdd → setTree → router.replace → useSearchParams
→ buildFetchParams → fetchSignature` is structurally correct on inspection, so the fault is runtime.
Sadin will report which of these three he observes:

1. URL never gains `?f=` → the bar isn't reaching `setTree`, or the flag is off / the dev server was
   not restarted after adding `NEXT_PUBLIC_ADVANCED_FILTERS=1` (these are inlined at build time).
2. URL updates but no `/api/v1/leads?...f=...` request fires → `fetchSignature` isn't changing.
3. Request fires and returns filtered rows but the table still shows everything → the SSR-prop-sync
   fix didn't hold.

Fix only the branch that matches, and say in the PR which one it was.

---

# PHASE 3.5 — Enable the flag on STAGE only, then prove the counts at real volume

**Branch:** `feature/advanced-filters-stage-flag` from latest `origin/stage`
**Migration:** none. **Small change — two files.** The value is the verification it unlocks.

Phases 0–3 are merged and deployed (`d3841a63`). But `NEXT_PUBLIC_ADVANCED_FILTERS` is not wired
into the image build, so the deployed bundle has it `undefined` and stage still renders the **legacy**
toolbar. The new bar exists only on local dev.

`NEXT_PUBLIC_*` is **inlined at build time** (the Dockerfile says so at line 15). A container restart
or an `.env.local` edit on the VPS will NOT turn it on — it has to be a build arg.

## The change

**1. `Dockerfile`** — add alongside the existing `NEXT_PUBLIC_*` pairs (ARGs ~L11-23, ENVs ~L25-32):

```dockerfile
ARG NEXT_PUBLIC_ADVANCED_FILTERS
ENV NEXT_PUBLIC_ADVANCED_FILTERS=$NEXT_PUBLIC_ADVANCED_FILTERS
```

**2. `.github/workflows/deploy-staging.yml`** — add one line to `build-args` (~L55-63):

```yaml
NEXT_PUBLIC_ADVANCED_FILTERS=1
```

A **literal `1`, not a secret** — matching how `NEXT_PUBLIC_SENTRY_ENVIRONMENT=staging` is done. It
should be readable in the workflow file that staging has this on.

**3. Do NOT touch `.github/workflows/deploy.yml`.** Prod stays off. With no ARG value passed, the
Dockerfile ARG resolves empty and the flag is `undefined` — the legacy toolbar. Say explicitly in the
PR that prod is unaffected, and confirm you did not edit `deploy.yml`.

`docker-compose.yml` needs no change — it pulls the prebuilt image
(`image: ghcr.io/zunkireelabs/edgexcrm:stage`) and has no build section.

## The verification this unlocks — the actual point of the PR

Local dev has 33 leads, so it cannot prove the Assigned To counts moved off the old 25-row page cap.
Stage's Admizz tenant has ~16.7k. **This is the outstanding gate before any prod promotion of Phases 0–3.**

After the deploy is green, on **stage** (`dymeudcddasqpomfpjvt`):

1. Open `dev-lead-crm.zunkireelabs.com` → Leads → **+ Add filter → Assigned to**. Screenshot the counts.
2. For 2–3 counselors, compare the facet count against the DB directly:
   ```sql
   SELECT count(*) FROM leads
   WHERE tenant_id = '<admizz>' AND assigned_to = '<user_id>'
     AND deleted_at IS NULL AND converted_at IS NULL
     AND NOT (tags @> ARRAY['other']::text[]);
   ```
   They must match **exactly**. A number ≤25 that looks suspiciously like a page size means the facet
   didn't move server-side and the whole A/B/C change is not doing what it claims.
3. Apply the filter and confirm the row count and the chip agree.
4. Confirm counts still render with a second filter stacked (the `treeToAggregateParams` path), and are
   **absent** (no badge, never a zero) for a tree it can't express.
5. Sanity-check page-1 perf is not worse than the legacy toolbar on a 16.7k tenant.

**Stage lead data is real customer PII** — screenshots for the PR are fine (it's our own stage), but do
not paste raw rows anywhere else, and do not point any third-party service at it.

## Proof required in the PR body

Both screenshots (stage Assigned To counts; the filter applied), the `SELECT count(*)` outputs beside
the facet numbers, and an explicit line confirming `deploy.yml` was not modified.

## Rollback

Remove the one build-arg line and redeploy — next stage build goes back to the legacy toolbar. No
migration, no data change.

Stop at the review gate.

---

## Non-negotiables for all phases

- Branch from **latest `origin/stage`**; rebase again right before merge. Squash-merge to `stage`.
  `stage` is branch-protected and requires **1 approval** — you cannot self-merge.
- Never merge to `main`. Never apply anything to the prod DB (`pirhnklvtjjpuvbvibxf`).
- Stage DB is `dymeudcddasqpomfpjvt`. **Stage lead data is real customer PII** — 16,436 of Admizz's
  16,684 leads carry a real phone number. Do not paste it anywhere or point third-party services at it.
- The Vercel PR check always fails and is non-blocking — judge CI on GitHub Actions Lint / Type Check / Build / Test only.
