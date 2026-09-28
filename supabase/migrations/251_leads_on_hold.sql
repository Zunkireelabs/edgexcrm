-- Migration 251: leads.on_hold — a lead the customer explicitly asked to wait
-- on, distinct from a lead that's simply been forgotten. Suppresses the
-- follow-up-needed signal only (migration 250); a pending callback stays
-- time-sensitive regardless of hold status, so callback-due still applies
-- even when a lead is on hold.
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: leads: N -> N (0 rows added/removed;
--     one column added, defaulted false on existing rows).
--   Rollback: ALTER TABLE leads DROP COLUMN on_hold;
--   Applied: stage HELD / prod HELD.

BEGIN;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS on_hold BOOLEAN NOT NULL DEFAULT false;

INSERT INTO public.schema_migrations (version) VALUES ('251_leads_on_hold.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
