# BRIEF — Dashboard / insights / pipeline numbers are wrong on prod. Aggregate in Postgres.

**For:** Sonnet execution session · **From:** Opus planning session · **Date:** 2026-08-01
**Branch:** `fix/dashboard-aggregates` from **latest** `origin/stage`
**Scope:** one migration (`194`) + application code. **Stage only — no prod.**
**Stop at the review gate.** Opus re-verifies independently, including as a counselor.

---

## 0. This is a live correctness bug, not a performance task

`getLeads` (`src/lib/supabase/queries.ts`) caps at `scope?.limit ?? 1000`. Three pages call it with
**no `limit`**, so they silently compute from the first 1,000 rows:

| Call site | `limit` | Effective max |
|---|---|---|
| `dashboard/page.tsx:49` | none | **1,000** |
| `insights/dashboards/[id]/page.tsx:74` | none | **1,000** |
| `pipeline/page.tsx:67` | none | **1,000 per list** |

`getLeads` sorts `created_at DESC, id DESC` — so these pages see the 1,000 **newest** leads and
nothing else. Measured on **prod**, Admizz Education (16,920 live leads), 2026-08-01:

| Widget value | Truth | What the page displays |
|---|---|---|
| Stat card "New" | **10,836** | **542** |
| UTM Attribution (`custom_fields ? 'utm_source'`) | **106** | **0** |

The stat card is off by 20×. The UTM widget renders **empty**, which reads to the user as "we have
no UTM data" rather than "this was truncated." Nothing on screen indicates either number is partial.

**Only Admizz is over the cap today** (Zunkiree 975, Prime Ceramics 21, OTA-Demo 18, Mobilise 0), so
this is live harm for exactly one tenant — but it is the platform-level defect that will hit every
tenant as they grow. Per the standing sizing rule: raising the cap is not a fix. Removing it is
worse — it drags ~7 MB of full lead rows into a 3 GiB container that already has a confirmed leak
(RSS floor climbing ~153 MiB/h). **The aggregation has to happen in Postgres.**

---

## 1. Why a SQL function, and not the #338 count-only technique

PR #338 (merged to stage today) replaced a row-download with parallel `{ count: "exact", head: true }`
queries — one per group key. That is the right tool at 10–15 keys. It is the wrong tool here:

- **~40 group keys.** 4–5 statuses × 3 time windows, plus one per form, plus one per counselor
  (Admizz has ~17 members). That is ~40 round-trips per dashboard render.
- **Each one re-evaluates a non-inlinable function.** `leads_visible_to_user` is `SECURITY DEFINER`
  **and** carries `SET search_path`, so Postgres will not inline it — a `WHERE` chained on the
  outside cannot be pushed into the body. Every one of those ~40 calls materializes the caller's
  entire visible-lead set and then filters it. See the caveat comment at the top of the counts block
  in `src/app/(main)/api/v1/lead-lists/route.ts`, which names ~40 keys as the escalation threshold.

Dashboard aggregation is already past that threshold on day one. So take the escalation path now:
**one `GROUP BY` function, one round-trip, one predicate evaluation.**

---

## 2. Migration `194_lead_aggregates.sql`

Next free number is **194** (`ls supabase/migrations/ | sort -n | tail -1` → 193). Additive only,
wrapped in `BEGIN`/`COMMIT`, with a rollback line and the `schema_migrations` insert — follow
`supabase/migrations/_TEMPLATE` and use `179_leads_visible_to_user.sql` as the shape reference.

### The one rule that matters

**Do not reimplement the visibility predicate.** Select *from* `leads_visible_to_user(...)`, do not
copy its `WHERE` clause. That function is the single definition of what a counselor may see; a second
copy will drift, and when it drifts the failure mode is a count that reveals leads the viewer cannot
open. Nesting `SECURITY DEFINER` is fine here — `auth.uid()` reads the JWT GUC and is unaffected by
the definer switch, so the inner function's fail-closed authorization gate still applies.

```sql
CREATE OR REPLACE FUNCTION public.lead_aggregates(
  p_tenant           uuid,
  p_week1_start      timestamptz,   -- caller-supplied window boundaries; see §2.1
  p_week2_start      timestamptz,
  p_user             uuid  DEFAULT NULL,
  p_scope            text  DEFAULT 'own',
  p_branch_id        uuid  DEFAULT NULL,
  p_user_branch_id   uuid  DEFAULT NULL,
  p_cross_pool_slug  text  DEFAULT NULL
)
RETURNS TABLE (dimension text, key text, bucket text, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH v AS (
    SELECT * FROM public.leads_visible_to_user(
      p_tenant, p_user, p_scope, p_branch_id, p_user_branch_id, p_cross_pool_slug)
    WHERE deleted_at IS NULL AND converted_at IS NULL
  )
  SELECT 'status', coalesce(status,'(none)'), 'all',       count(*) FROM v GROUP BY 1,2,3
  UNION ALL
  SELECT 'status', coalesce(status,'(none)'), 'this_week', count(*) FROM v
    WHERE created_at >= p_week1_start GROUP BY 1,2,3
  UNION ALL
  SELECT 'status', coalesce(status,'(none)'), 'last_week', count(*) FROM v
    WHERE created_at >= p_week2_start AND created_at < p_week1_start GROUP BY 1,2,3
  UNION ALL
  SELECT 'stage',      coalesce(stage_id::text,'(none)'),          'all', count(*) FROM v GROUP BY 1,2,3
  UNION ALL
  SELECT 'source',     coalesce(form_config_id::text,'(none)'),    'all', count(*) FROM v GROUP BY 1,2,3
  UNION ALL
  SELECT 'counselor',  coalesce(assigned_to::text,'(unassigned)'), 'all', count(*) FROM v GROUP BY 1,2,3
  UNION ALL
  SELECT 'utm_source',   coalesce(custom_fields->>'utm_source','(none)'),   'all', count(*) FROM v GROUP BY 1,2,3
  UNION ALL
  SELECT 'utm_medium',   coalesce(custom_fields->>'utm_medium','(none)'),   'all', count(*) FROM v GROUP BY 1,2,3
  UNION ALL
  SELECT 'utm_campaign', coalesce(custom_fields->>'utm_campaign','(none)'), 'all', count(*) FROM v GROUP BY 1,2,3
  UNION ALL
  SELECT 'list', coalesce(list_id::text,'(none)'), 'all', count(*) FROM v GROUP BY 1,2,3;
$$;

GRANT EXECUTE ON FUNCTION public.lead_aggregates(uuid,timestamptz,timestamptz,uuid,text,uuid,uuid,text)
  TO authenticated;
```

**This signature is a starting point, not gospel.** Before writing it, read
`src/components/dashboard/stats-cards.tsx` — in particular `matchesStage()` and the branch that
splits stages into `is_terminal`/`terminal_type` won/lost/in-progress. If that logic keys off
something other than `status`/`stage_id`, the `dimension` set must cover what it actually reads.
Adjust and say what you changed and why.

### 2.1 Week boundaries are parameters, not `now()`

`stats-cards.tsx` computes its one-week and two-week windows in JS from the request time. If the
function called `now()` instead, the boundary would shift between the server component and anything
computed client-side, and tenant-timezone handling (already fixed once, migration 153) would have a
second home. Keep that logic where it is: compute the two boundaries in TypeScript exactly as
`stats-cards.tsx` does today and pass them in.

### 2.2 Do not pass an explicit `null` in the RPC args object

Same hazard as `visibility-query.ts:18-23`: PostgREST's GET/HEAD convention serializes a JS `null`
as the literal string `"null"`, which fails to cast to `uuid` (22P02). **Omit** the key and let the
SQL `DEFAULT` apply. Every param a caller might skip needs a trailing `DEFAULT` for that to work —
which is why `p_week1_start`/`p_week2_start` are positioned before the optional scope params.

---

## 3. Application changes

### 3.1 New helper

`src/lib/leads/aggregates.ts`:

```ts
export interface LeadAggregates {
  status: Record<string, { all: number; thisWeek: number; lastWeek: number }>;
  stage: Record<string, number>;
  source: Record<string, number>;
  counselor: Record<string, number>;
  utmSource: Record<string, number>;
  utmMedium: Record<string, number>;
  utmCampaign: Record<string, number>;
  list: Record<string, number>;
  total: number;
}

export async function getLeadAggregates(
  tenantId: string,
  scope: LeadVisibilityScope | undefined,
  now: Date,
): Promise<LeadAggregates>
```

One `supabase.rpc("lead_aggregates", ...)` call, reshaped into the struct above. `total` is the sum
of `status.*.all` — do not issue a second query for it.

### 3.2 `dashboard/page.tsx`

Replace `getLeads(tenantData.tenant.id, scope)` with `getLeadAggregates(...)`. **Stop loading lead
rows on this page entirely.** Then change the four widgets to accept numbers instead of `Lead[]`:

- `stats-cards.tsx` — currently `leads.length`, `leads.filter(l => l.status === "new").length`, and
  `filterByWeek()`. All become lookups.
- `leads-by-stage-chart.tsx` — `leads.reduce(...)` → `aggregates.stage`.
- `leads-by-source-chart.tsx` — `leads.reduce(...)` → `aggregates.source` (still joined to `formMap`).
- `leads-by-counselor-chart.tsx` — `leads.reduce(...)` → `aggregates.counselor` (still joined to
  `memberMap`/`memberNames`).

Keep each component's rendering, sorting, "(none)"/"(unassigned)" labelling and empty states exactly
as they are. **The only thing changing is where the numbers come from.**

### 3.3 `insights/dashboards/[id]/page.tsx`

Admizz's two dashboards use exactly five widget keys — `stats`, `leads-by-stage`, `leads-by-source`,
`leads-by-counselor`, `utm`. The first four are the components from §3.2. Wire `utm`
(`UtmAnalyticsSection`, reached via `dashboard-renderer.tsx:173`) to `aggregates.utmSource` /
`utmMedium` / `utmCampaign`.

**The it_agency widgets (`sales-*`, `delivery-*`, `overview-*`) are out of scope** — they belong to
Mobilise (0 leads) and Zunkiree (975), both under the cap, so none of them is wrong today. But they
still read the capped `leads` array. Two requirements:

1. Keep them working. If they still need `leads`, keep that fetch **for those widgets only**, and
   pass an **explicit** `limit` rather than relying on the `?? 1000` default, so the bound is visible
   at the call site instead of hidden three files away.
2. **Add a tripwire.** When the returned array length equals the limit, `log.warn` with tenant id and
   widget set — truncation must announce itself. Today it is completely silent, which is how this
   survived on prod. Do not add user-facing UI for this.

### 3.4 `pipeline/page.tsx` + `ListFunnelBoard.tsx`

`ListFunnelBoard.tsx:90` renders `{leads.length}` as the per-column count — capped at 1,000, so
Admizz's Migration QC column shows "1000" against 8,620 real rows. Line 66 derives the status filter
chips from the loaded set, so a status occurring only in rows 1,001+ silently vanishes from the
filter.

- Per-column count comes from `aggregates.list[list.id]` — exact.
- Status chips come from the DB, not from the loaded page.
- **Card loading stays as-is for now.** Per-column card pagination is the follow-up brief (it merges
  with the Kanban item at `leads/page.tsx:184`). Make the card `limit` explicit at the call site and
  leave it. The column header will then show the true count above a partial card list — that is a
  known, accepted, temporary state and it must be noted in the PR body.

### 3.5 Leave `getLeads` alone

Do **not** change the `?? 1000` default in this PR. Its remaining consumers (Kanban, leads-organise,
pipeline cards) are the follow-up brief's problem, and changing a shared default underneath them is
how you turn a scoped fix into an incident.

---

## 4. Verification — this is the part that matters

Counts are correctness-sensitive **and** tenant-isolation-adjacent. Per
`feedback_verify_rls_paths_under_real_session`, service-role SQL bypasses RLS and hides exactly the
bug that matters. **Reproduce as a real logged-in user.**

1. **Equivalence test (do this first, it is the safety net).** Build a fixture of leads and assert the
   new aggregate output equals what the *old* component logic produced over the same fixture — per
   status, per stage, per source, per counselor, per week window. This catches "the numbers changed
   in a different wrong direction," which no amount of eyeballing prod will.
2. **As owner/admin on stage** (`hello@admizz.org`): dashboard stat cards and all three charts must
   match a direct SQL check. Stage is a clone of prod, so the shape is comparable:
   ```sql
   SELECT status, count(*) FROM leads
   WHERE tenant_id = '<admizz>' AND deleted_at IS NULL AND converted_at IS NULL
   GROUP BY status;
   ```
   Specifically confirm the two numbers this brief opened with are now right: "New" reads the full
   count (order 10k, not order 500), and the UTM widget is **non-empty**.
3. **As a counselor on stage** (real credentials — ask Sadin; `edgexdev123` did not work for the
   Admizz counselor accounts during #338). Counts must match what that counselor can see, **not** the
   tenant total. This is the regression migration 179 exists to prevent. If you cannot get a
   counselor session, say so — do not skip it silently.
4. **Pipeline board:** column counts exact against SQL; status chips complete.
5. **Insights:** Admizz's two dashboards render correctly. Zunkiree/Mobilise it_agency dashboards
   render **unchanged** — this is the regression risk of touching `dashboard-renderer.tsx`.

**Report round-trip COUNTS and rows fetched, never stage milliseconds** (stage Supabase is in
Incheon; prod is in Mumbai — see `docs/PAGE-RENDER-WATERFALL-BRIEF.md` §0a).

Expected: dashboard goes from ~17 round-trips and ~7 MB of lead rows to **1 round-trip, ~40 result
rows, 0 lead rows.**

## 5. Gates

- `npm run build` clean.
- `npx eslint --max-warnings 50` — baseline **45 warnings / 0 errors** (post-#338).
- `npm run test` — baseline **1050 passing across 102 files, 0 skipped**.
- Migration applies cleanly on a local/stage DB with before/after counts logged. It is DDL-only —
  0 rows touched.

## 6. Explicitly OUT of scope

- **Prod.** Migration 194 goes to stage only. Prod application is a separate, explicitly-approved step.
- The `?? 1000` default in `getLeads` itself.
- Per-column card pagination (pipeline) and Kanban full-load at `leads/page.tsx:184`.
- The it_agency `sales-*` / `delivery-*` widgets beyond the tripwire in §3.3.
- Merging. Stop at review.

## 7. Report back with

1. The diff, and the final migration SQL.
2. Before/after round-trip counts + rows fetched, dashboard and pipeline.
3. All five verification results, with the counselor case stated explicitly as done or not done.
4. Whether `matchesStage`/the terminal-stage branch forced a change to the `dimension` set, and what.
5. Gate output.
6. Anything you chose not to do, and why.

---

# ADDENDUM (2026-08-01, after the brief was issued) — `/leads` source facet

**Do this in the same PR.** It is the same defect class as everything above, and it must be true
before the promotion because #332 ships in that promotion and #332 is what made it acute.

## Correction to something Opus said verbally

An earlier note claimed `lead_aggregates` "already returns a `source` dimension, exactly what the
facet needs." **That is wrong — ignore it.** The chart's `source` dimension groups by
**`form_config_id`** (which form the lead arrived through). The `/leads` facet groups by
**`intake_source`** (a free-text string). Different columns, different values. A new dimension is
required.

## The bug

`src/components/dashboard/leads-table.tsx` (~L565-600) builds the Source filter's **option list**
(`sources`) and its **per-option counts** (`sourceCounts`) from `localLeads` — the current 25-row
server page. Measured on prod, Admizz, 2026-08-01:

| Dropdown shows | Reality |
|---|---|
| walk_in (13), Affiliate (4), Branch Office (3), referral (2), Website (2), form (**1**) | NEB10K-REM **7,500** · NEB10K **2,495** · Agentics leads **2,409** · Model Secondary School – Management 937 · Sohan Leads 801 · … · form **102** |

The six largest sources — ~15,000 of 16,920 leads — are **not offered at all**, so they cannot be
filtered on. Before #332 the list view loaded up to 1,000 rows, so this was incomplete; at a 25-row
page it is broken.

## Design — facets travel with the page they describe

`leads-table.tsx:527` already fetches pages from **`/api/v1/leads?<filters>`**, and that endpoint
already receives every active filter. So compute facets there, not in a separate call.

1. **Opt-in query param `?facets=1`** — same shape as the `?counts=1` pattern shipped in #338. Keep
   it opt-in so the many other consumers of this route pay nothing.
2. **Extend `lead_aggregates`** (migration 194, which you are already writing) with optional filter
   parameters mirroring the filter set `/api/v1/leads` applies: status, assigned_to, tag, form,
   created-after, list, and the #332 search term. All `DEFAULT NULL`, all trailing — and remember
   §2.2: **omit** keys, never pass an explicit `null`. The dashboard callers pass none of them and
   are unaffected.
3. **Two intake-source dimensions**, so no behavioural flag is needed:
   - `intake_source` — the exact string (`/leads` view).
   - `intake_source_part` — `unnest(string_to_array(intake_source, ' | '))` (staging view, which
     splits on `" | "` today).
4. **Cross-filtering is preserved by the caller**, matching current behaviour: when asking for the
   source facet, pass every active filter **except** source itself.

## The invariant that makes this testable

**The count shown beside a facet option must equal the total the page reports when you select that
option.** If the source facet says "NEB10K-REM (7,500)", selecting it must yield "Showing 1-25 of
7,500". Assert this in a test and check it by hand on stage — it catches any filter that got dropped
between the page query and the facet query, which is the one way this fix can be subtly wrong.

If a filter cannot be expressed in SQL, **say so in your report** — do not silently omit it. A facet
count that disagrees with the result count is worse than the current bug, because it looks correct.

## Scope discipline

Source is the only facet in scope. Do **not** convert the counselor / tag / status / form facets in
this PR — they have the same latent issue and belong in the follow-up brief with Kanban. If the
implementation makes the others trivially free, note that in the report and let Opus decide.
