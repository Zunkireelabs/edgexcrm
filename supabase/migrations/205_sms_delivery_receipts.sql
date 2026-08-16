-- Migration 205: SMS Phase 4 — delivery-receipt polling support
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: sms_messages row count UNCHANGED (new
--   nullable/DEFAULT-backed columns only, ADD COLUMN with a DEFAULT backfills
--   existing rows in-place with no data loss; local dev has accumulated real
--   rows from Phase 3B testing — this is safe at any row count, not just 0).
--   Rollback: DROP INDEX IF EXISTS idx_sms_messages_awaiting_receipt;
--             ALTER TABLE sms_messages DROP COLUMN IF EXISTS delivery_last_polled_at;
--             ALTER TABLE sms_messages DROP COLUMN IF EXISTS delivery_poll_attempts;
--   Applied: local ONLY. Stage/prod HELD (SMS remains dark — SMS_ENABLED=false).
--
-- Context: docs/SMS-PHASE4-BRIEF.md item 1. Aakash gives no delivery webhook —
-- POST /sms/v4/api-report is poll-only, and the report row's `id` has no
-- relationship to the send response's `id` (verified live, see
-- docs/SMS-PHASE1-BRIEF.md §2), so matching happens on recipient + body +
-- timestamp in src/lib/sms/delivery-match.ts, not on any id. `delivered_at`
-- (migration 203) is already the delivery-status timestamp this needs; the
-- two columns below are the poll-attempt bookkeeping that timestamp alone
-- can't carry: how many times we've tried, and whether a row has been polled
-- so many times without resolving that we should stop (the "terminal state"
-- for an unresolvable row is `status='submitted' AND delivery_poll_attempts
-- >= <the poller's cap>` — no new status value needed, since "submitted"
-- ("the provider accepted it, we just never confirmed delivery") stays true).

BEGIN;

ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS delivery_poll_attempts SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS delivery_last_polled_at TIMESTAMPTZ;

-- Supports the poller's "rows still awaiting a receipt" query: status still
-- 'submitted', ordered/filtered by how long ago they were sent.
CREATE INDEX IF NOT EXISTS idx_sms_messages_awaiting_receipt
  ON sms_messages (tenant_id, sent_at)
  WHERE status = 'submitted';

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('205_sms_delivery_receipts.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
