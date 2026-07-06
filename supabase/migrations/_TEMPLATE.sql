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

-- REQUIRED: self-record in the ledger (mig 123). Set the string to THIS file's
-- EXACT filename. Applied by hand (psql/MCP), so the ledger row must live here.
INSERT INTO public.schema_migrations (version) VALUES ('NNN_name.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
