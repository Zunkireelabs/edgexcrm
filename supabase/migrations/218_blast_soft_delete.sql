-- Migration 218: soft-delete marker for email_blasts + sms_blasts
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: 0 rows touched (two nullable ADD COLUMN +
--     two partial indexes; no data written).
--   Rollback:
--     ALTER TABLE email_blasts DROP COLUMN IF EXISTS deleted_at;
--     ALTER TABLE sms_blasts   DROP COLUMN IF EXISTS deleted_at;
--     DROP INDEX IF EXISTS idx_email_blasts_not_deleted;
--     DROP INDEX IF EXISTS idx_sms_blasts_not_deleted;
--   Applied: stage HELD / prod HELD.
--
-- Context: the campaigns list ("Email Campaigns" / "SMS Campaigns") "Delete"
-- action was a soft-delete to status='cancelled' with NO list filter, so a
-- "deleted" blast reappeared on refresh (and an already-cancelled one 409'd and
-- could never be removed). The DELETE routes now HARD-delete a blast that never
-- sent anything (no *_messages rows) and SOFT-hide one that has send history by
-- stamping deleted_at; both list endpoints filter `deleted_at IS NULL`. This
-- column is the soft-hide marker. sms_messages already CASCADE on
-- sms_blasts(id); email_messages has no FK (soft source/source_id link), so its
-- DELETE route clears strays explicitly.

BEGIN;

ALTER TABLE email_blasts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE sms_blasts   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Partial indexes: the list queries only ever want the live rows, ordered by
-- created_at within a tenant — mirrors the existing idx_*_blasts_tenant_time
-- but scoped to the not-deleted set.
CREATE INDEX IF NOT EXISTS idx_email_blasts_not_deleted
  ON email_blasts (tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sms_blasts_not_deleted
  ON sms_blasts (tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('218_blast_soft_delete.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
