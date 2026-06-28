# BRIEF — Performance: leads indexes for the hot query paths (migration 073) — for Sonnet

**Owner:** Sonnet executor (`/db-engineer` track).
**Status:** Ready to build. **Review-gated** — apply to **STAGE DB only**, capture EXPLAIN evidence, then **STOP and report**. Do **NOT** apply to prod, do **NOT** self-merge/push (see `feedback_sonnet_oversteps_review_gate`). Prod is a separate, explicit GO at promotion time.
**Branch:** cut a fresh `feature/perf-leads-indexes` off `stage`.

---

## 1. Why (measured)
The single most-frequent query in the app — the leads list — has **no covering index for its sort**, so on the Admizz tenant (~6,114 leads) every default load filters ~6k rows and **sorts them in memory**. The bulk loader `getLeads` (`src/lib/supabase/queries.ts:99-102`) runs:
```sql
... WHERE tenant_id = $1 AND deleted_at IS NULL AND converted_at IS NULL
ORDER BY created_at DESC, id DESC
```
Existing indexes don't cover this: `idx_leads_created_at` is `(created_at DESC)` with no tenant prefix / no partial predicate; `idx_leads_last_activity_at` orders by `last_activity_at` (different column); `idx_leads_not_deleted` is `(tenant_id) WHERE deleted_at IS NULL` (no sort, no `converted_at`). Net: a heapsort of the whole tenant on every list load. Secondary gaps: no `intake_source` index (staging-cockpit source filter = full scan), and `idx_leads_tenant_list` / `idx_leads_pipeline_id` are non-partial single/again-sortless.

This affects `/leads`, `/contacts`, `/dashboard`, `/insights`, and the staging cockpit — i.e. the whole leads surface, not just one page.

## 2. The migration — `supabase/migrations/073_leads_perf_indexes.sql`
**Additive only. No data changes. No drops.** Use `IF NOT EXISTS` on every index so it's idempotent. Wrap in a transaction. (At ~6k rows, plain `CREATE INDEX` locks for milliseconds — `CONCURRENTLY` is unnecessary here and can't run in a txn; prod Admizz is the same ~6k size, so this is safe to replay at promotion.)

```sql
-- 073_leads_perf_indexes.sql
-- Additive indexes for the hot leads query paths. No data change, no drops, idempotent.
-- Rollback: DROP INDEX IF EXISTS idx_leads_tenant_created_active, idx_leads_tenant_intake_active,
--           idx_leads_tenant_list_created_active, idx_leads_tenant_pipeline_created_active;
BEGIN;

-- C1 (CRITICAL): the default leads-list query — tenant + active, ordered by created_at DESC, id DESC.
CREATE INDEX IF NOT EXISTS idx_leads_tenant_created_active
  ON leads (tenant_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL AND converted_at IS NULL;

-- C2 (HIGH): intake_source filtering (staging cockpit / import-source views).
CREATE INDEX IF NOT EXISTS idx_leads_tenant_intake_active
  ON leads (tenant_id, intake_source)
  WHERE deleted_at IS NULL;

-- C3: lead-list / staging views — list_id filter + recency sort (partial, sorted).
CREATE INDEX IF NOT EXISTS idx_leads_tenant_list_created_active
  ON leads (tenant_id, list_id, created_at DESC)
  WHERE deleted_at IS NULL AND converted_at IS NULL;

-- C4: pipeline board — pipeline_id filter + recency sort (partial, sorted).
CREATE INDEX IF NOT EXISTS idx_leads_tenant_pipeline_created_active
  ON leads (tenant_id, pipeline_id, created_at DESC)
  WHERE deleted_at IS NULL AND converted_at IS NULL;

COMMIT;
```
Do **not** drop the existing `idx_leads_tenant_list`, `idx_leads_pipeline_id`, `idx_leads_created_at`, etc. — other code paths may use them; this brief is purely additive. (A later cleanup pass can prune redundant ones once we confirm the new partials fully supersede them.)

## 3. Apply to STAGE only + prove it works
STAGE DB: `dymeudcddasqpomfpjvt` — host `db.dymeudcddasqpomfpjvt.supabase.co`, port 5432, user `postgres`, db `postgres`, sslmode require, PGPASSWORD `Zunkiree@123%^&`. Admizz tenant = `febeb37c-521c-4f29-adbb-0195b2eede88`.

1. **Capture BEFORE plan** (run before applying the migration):
   ```sql
   EXPLAIN ANALYZE
   SELECT * FROM leads
   WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
     AND deleted_at IS NULL AND converted_at IS NULL
   ORDER BY created_at DESC, id DESC
   LIMIT 25;
   ```
   Expect to see a `Sort` / heapsort node and/or a broad index/seq scan.
2. **Apply 073 to STAGE.**
3. **Capture AFTER plan** (same query). Expect an `Index Scan` (or `Index Only Scan`) using `idx_leads_tenant_created_active` with **no separate Sort node**.
4. **Confirm the intake_source index** is used: `EXPLAIN ANALYZE SELECT * FROM leads WHERE tenant_id='…febeb37c…' AND intake_source = '<pick a real value>' AND deleted_at IS NULL LIMIT 25;`
5. **Confirm indexes exist:** `SELECT indexname FROM pg_indexes WHERE tablename='leads' AND indexname LIKE 'idx_leads_tenant_%active';` → 4 rows.

## 4. Gates / report
- This is SQL only — no app code changes, so `npm run build` isn't strictly required, but run `npx eslint --max-warnings 50` if you touched anything else (you shouldn't have).
- **Report back to Opus:** the migration file, the **BEFORE and AFTER `EXPLAIN ANALYZE` plans** (paste both — this is the proof), the `pg_indexes` confirmation, and any deviation. Then **STOP**.
- **Do NOT** apply 073 to the **prod** DB (`pirhnklvtjjpuvbvibxf`) — prod replay is a separate explicit GO at promotion (the additive, idempotent design makes that replay clean later).

## 5. Out of scope (do not do here)
- No app-code changes, no query rewrites, no pagination work (separate brief).
- No dropping/renaming existing indexes.
- No prod application.
