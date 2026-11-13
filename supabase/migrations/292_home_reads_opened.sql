-- Migration 292: home_reads.opened_at (EDGEX-87 Part B2). The 7:00 job makes Orca's read only for people who opened Home in the
-- last 7 days; nothing else records a Home open, and a job-made row must not count as one (or the job would keep itself alive
-- forever for someone who left). Written by /api/v1/home/read on a real open.
--
-- Additive, idempotent. Expected row counts: home_reads unchanged (the column is NULL on existing rows).
--   Rollback: ALTER TABLE home_reads DROP COLUMN IF EXISTS opened_at;
--   Applied: stage HELD / prod HELD.

BEGIN;

ALTER TABLE home_reads ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_home_reads_opened ON home_reads (tenant_id, opened_at) WHERE opened_at IS NOT NULL;

INSERT INTO public.schema_migrations (version) VALUES ('292_home_reads_opened.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
