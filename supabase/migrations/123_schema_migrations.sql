-- Migration 123: schema_migrations ledger
--
-- Records which migration FILES have been applied to THIS database. Migrations
-- here are applied by hand (psql / Supabase MCP) with no runner, so each
-- migration self-records its own filename inside its own transaction — the
-- ledger row commits atomically with the migration (see _TEMPLATE.sql).
--
-- Keyed on the full FILENAME (not the number) so the historical duplicate
-- numbers (110_*, 112_*) are distinct rows. This is distinct from the Supabase
-- CLI's internal supabase_migrations.schema_migrations — we don't use that runner.
--
-- Backfill of the pre-123 migrations is a PER-DB step (the two DBs differ — prod
-- lags stage), deliberately NOT baked into this file: a blind insert-all would
-- wrongly mark prod's held migrations as applied. Stage is backfilled with all
-- present files now; prod is backfilled at the consolidated promotion, AFTER the
-- held migrations are applied. See scripts/migrate-status.sh and the SOP
-- (docs/dev-collab/DEV-WORKFLOW-AND-DEPLOYMENT.md § Migration protocol).

BEGIN;

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version     TEXT PRIMARY KEY,        -- exact migration filename, e.g. '121_attendance.sql'
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by  TEXT NOT NULL DEFAULT current_user
);

COMMENT ON TABLE public.schema_migrations IS
  'Ledger of applied migration files (one row per supabase/migrations/NNN_*.sql), self-recorded by each migration. Manual-application ledger; distinct from Supabase CLI internal table.';

-- Operational metadata, not tenant data. Lock it away from all normal clients;
-- the service role / psql used to apply migrations bypasses RLS.
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.schema_migrations FROM anon, authenticated;

-- Self-record this migration.
INSERT INTO public.schema_migrations (version) VALUES ('123_schema_migrations.sql')
  ON CONFLICT (version) DO NOTHING;

-- Additive: 1 new table, 0 rows touched on any existing table.
COMMIT;
