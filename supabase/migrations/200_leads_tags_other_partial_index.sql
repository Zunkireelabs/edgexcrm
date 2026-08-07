-- Migration 200: partial index so the "exclude tags @> {other}" predicate stops
-- forcing a seq scan on every /api/v1/leads request.
--
-- Additive only (index-only, no table rewrite). Expected before/after row counts:
--   leads: 0 rows touched (index creation does not modify data).
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS idx_leads_tenant_created_active_nonother;
-- Applied: stage <YYYY-MM-DD> / prod HELD (promotion gate).
--
-- NOT in a transaction: CREATE INDEX CONCURRENTLY cannot run inside BEGIN/COMMIT
-- (see supabase/migrations/085_unique_display_id.sql for the precedent).
--
-- src/app/(main)/api/v1/leads/route.ts:314 runs `NOT (tags @> '{"other"}')`
-- unconditionally on every request. This is a negated GIN predicate — Postgres
-- cannot use idx_leads_tags for a negation, so the exact-count query (and any
-- other query that isn't LIMIT-bounded against idx_leads_tenant_created_active)
-- falls back to a full seq scan. Measured on stage (dymeudcddasqpomfpjvt),
-- Admizz tenant (16,683 active rows): exact-count query 1467.9ms via Seq Scan.
--
-- This partial index carries the exact same predicate (tenant_id, deleted_at IS
-- NULL, converted_at IS NULL, NOT tags @> '{other}') as the WHERE clause, so the
-- planner can prove the query predicate implies the index predicate and use an
-- Index Only Scan instead. Verified in a rolled-back transaction against stage
-- before committing to this approach (see PR body for before/after EXPLAIN
-- plans) — count query dropped to ~11.9ms.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_tenant_created_active_nonother
  ON public.leads (tenant_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL AND converted_at IS NULL AND NOT (tags @> ARRAY['other']::text[]);

INSERT INTO public.schema_migrations (version) VALUES ('200_leads_tags_other_partial_index.sql')
  ON CONFLICT (version) DO NOTHING;
