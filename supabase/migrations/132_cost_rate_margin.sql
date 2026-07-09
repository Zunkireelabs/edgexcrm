-- Migration 132: per-person cost rate + frozen cost-rate snapshot on time entries
--
-- Additive only. Wrap in BEGIN/COMMIT. Include:
--   Expected before/after row counts: tenant_users: 0 rows touched (column add only);
--     time_entries: 0 rows touched (column add only).
--   Rollback: ALTER TABLE time_entries DROP COLUMN IF EXISTS cost_rate_snapshot; ALTER TABLE tenant_users DROP COLUMN IF EXISTS cost_rate;
--   Applied: stage HELD / prod HELD (local only per brief).
--
-- No backfill — historical approved entries keep cost_rate_snapshot = null (contribute
-- 0 cost); cost tracking is forward-looking from when cost rates are set per person.

BEGIN;

-- Per-person cost rate, alongside the existing billing rate (tenant_users.default_hourly_rate).
ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS cost_rate NUMERIC(10,2);
-- Frozen cost rate per approved entry (mirrors rate_snapshot), so historical margin doesn't drift.
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS cost_rate_snapshot NUMERIC(10,2);

INSERT INTO public.schema_migrations (version) VALUES ('132_cost_rate_margin.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
