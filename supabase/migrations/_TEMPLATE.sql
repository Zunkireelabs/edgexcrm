-- Migration NNN: <one line — what this does>
--
-- Additive only. Wrap in BEGIN/COMMIT. Include:
--   Expected before/after row counts: <table X: A -> B (or "0 rows touched")>.
--   Rollback: <the inverse — e.g. DROP TABLE IF EXISTS foo; / "policy-only, re-apply 0NN">.
--   Applied: stage <YYYY-MM-DD> / prod <YYYY-MM-DD or HELD>.
--
-- Copy this file to the NEXT FREE number: `ls supabase/migrations | sort` -> +1.
-- One number = one file, globally unique. Never reuse a number.
-- (This _TEMPLATE.sql is not a real migration — the leading underscore keeps it
--  out of the numbered sequence; do not apply it.)

BEGIN;

-- ... your additive DDL / DML here ...
-- New tenant-owned table? tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE
-- + RLS: SELECT via get_user_tenant_ids(), mutations via is_tenant_admin(tenant_id).
--
-- MAKE EVERY STATEMENT IDEMPOTENT (safe to run twice). The auto-migrate runner
-- may re-encounter a migration; a non-idempotent statement then errors and, being
-- fail-closed, blocks the deploy. (This exact bug shipped in mig 124: an unguarded
-- CREATE POLICY.) Use:
--   CREATE TABLE IF NOT EXISTS ... ; CREATE INDEX IF NOT EXISTS ... ;
--   ALTER TABLE ... ADD COLUMN IF NOT EXISTS ... ;
--   DROP POLICY IF EXISTS "p" ON t;  CREATE POLICY "p" ON t ... ;   -- policies have no IF NOT EXISTS
--   INSERT ... ON CONFLICT DO NOTHING;   UPDATE ... WHERE <guard so a re-run is a no-op>;

-- REQUIRED: self-record in the ledger (mig 123). Set the string to THIS file's
-- EXACT filename. Applied by hand (psql/MCP) AND by the auto-migrate runner, so the
-- ledger row MUST live here — a migration that omits this drifts the ledger and gets
-- re-run forever. CI enforces this (scripts/check-migrations.sh); do not remove it.
INSERT INTO public.schema_migrations (version) VALUES ('NNN_name.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
