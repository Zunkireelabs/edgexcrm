-- Migration 193: pg_trgm + trigram GIN indexes for server-side leads search
--
-- Additive only (new extension + 4 indexes). Expected before/after row counts:
-- 0 rows touched (extension + index DDL only, no data changes).
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS idx_leads_search_trgm_first_name;
--           DROP INDEX CONCURRENTLY IF EXISTS idx_leads_search_trgm_last_name;
--           DROP INDEX CONCURRENTLY IF EXISTS idx_leads_search_trgm_email;
--           DROP INDEX CONCURRENTLY IF EXISTS idx_leads_search_trgm_phone;
--           (pg_trgm left installed — cheap, and other indexes may come to depend on it)
-- Applied: stage <YYYY-MM-DD> / prod HELD.
--
-- ── DOCUMENTED EXCEPTION to the repo's BEGIN/COMMIT convention (_TEMPLATE.sql) ──
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block (Postgres hard
-- error), so this file deliberately has NO BEGIN/COMMIT wrapper — every statement
-- below runs in psql's default autocommit mode, each as its own implicit
-- transaction. Confirmed against scripts/migrate-apply.sh: it feeds every pending
-- file to ONE psql session via `\i` WITHOUT an outer `-1`/transaction wrapper
-- (see that script's own header comment — deliberate, so each file's own
-- BEGIN/COMMIT isn't broken by an outer transaction). That means a file with no
-- BEGIN/COMMIT of its own runs its statements autocommitted, exactly what
-- CONCURRENTLY requires. Every statement here is IF NOT EXISTS / ON CONFLICT —
-- but that only covers a statement that never started or fully succeeded; a
-- CONCURRENTLY build that fails partway through needs the manual check below,
-- see "Retry is NOT unconditionally safe".
--
-- Verified on stage: pg_trgm is NOT installed and leads has no trigram indexes —
-- server-side ILIKE '%term%' search (GET /api/v1/leads?search=) seq-scans the
-- whole active row set on every keystroke-driven request. This covers exactly the
-- columns the API's `search` param matches (route.ts): first_name, last_name,
-- email, phone. One GIN index per column (not one combined index) matches how the
-- query is shaped — an OR of four independent ILIKE clauses — so Postgres can
-- BitmapOr across the four indexes instead of needing one wide multi-column index.
--
-- ── Retry is NOT unconditionally safe ──
-- CREATE INDEX CONCURRENTLY can fail partway through (e.g. lock timeout, killed
-- session) and leave an INVALID index behind. Postgres does NOT drop it
-- automatically, and `IF NOT EXISTS` sees the (invalid) name already exists and
-- silently skips it on every future retry — the index is then permanently absent
-- from query plans with no error ever surfaced. IF NOT EXISTS only makes each
-- individual statement idempotent when it succeeds or never started; it does not
-- make a failed-partway-through CONCURRENTLY build safe to just re-run as-is.
--
-- MANDATORY verification after running this file (on whichever DB it was just
-- applied to):
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- If any of the four idx_leads_search_trgm_* names appear, that index is invalid —
-- DROP INDEX CONCURRENTLY IF EXISTS <name>; then re-run its CREATE INDEX
-- CONCURRENTLY statement above before considering this migration applied.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_search_trgm_first_name
  ON leads USING gin (first_name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_search_trgm_last_name
  ON leads USING gin (last_name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_search_trgm_email
  ON leads USING gin (email gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_search_trgm_phone
  ON leads USING gin (phone gin_trgm_ops);

INSERT INTO public.schema_migrations (version) VALUES ('193_leads_search_trgm.sql')
  ON CONFLICT (version) DO NOTHING;
