-- Migration 153: Tenant default currency
--
-- Adds tenants.default_currency so billing UI (Accounts billable tiles,
-- delivery-dashboard My Time widget) can render the tenant's actual billing
-- currency (e.g. Zunkiree bills NPR) instead of a hardcoded USD/NPR default.
-- Additive only. Wrap in BEGIN/COMMIT. Include:
--   Expected before/after row counts: tenants: all rows gain default_currency
--   = 'NPR' (column added with a NOT NULL DEFAULT; existing rows backfilled
--   by Postgres at ADD COLUMN time, 0 rows explicitly touched by DML here).
--   Rollback: ALTER TABLE tenants DROP COLUMN IF EXISTS default_currency;
--   Applied: LOCAL ONLY (per-brief guardrail — do not apply to stage/prod from
--   this session; the stage auto-migration runner applies it on merge).

BEGIN;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS default_currency TEXT NOT NULL DEFAULT 'NPR';

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('153_tenant_default_currency.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
