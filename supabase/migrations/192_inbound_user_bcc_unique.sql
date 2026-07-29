-- Migration 192: one active BCC dropbox address per (tenant, user)
--
-- docs/email-productionization/BCC-DROPBOX-BRIEF.md §3. A dropbox is
-- inbound_addresses(kind='user', verb='bcc', user_id=<rep>, thread_id=NULL) —
-- migration 191 already permits this row shape (kind/verb CHECKs, nullable
-- user_id/thread_id). This migration adds only the uniqueness guarantee so
-- POST /api/v1/email/bcc-address's regenerate (revoke old + insert new, one
-- txn) can never leave two ACTIVE dropboxes for the same rep. Revoked rows
-- are excluded and stay for history/audit.
--
-- Expected before/after row counts: inbound_addresses 0 rows touched (index
-- add only, no DML); N -> N.
--
-- Rollback: DROP INDEX IF EXISTS idx_inbound_addresses_user_verb_active;
--
-- Applied: stage 2026-07-29 (3 -> 3 rows, verified via psql before/after count)
-- / prod HELD (per brief — do not touch prod).

BEGIN;

-- One ACTIVE dropbox per (tenant, user, verb). Revoked rows stay for history.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_addresses_user_verb_active
  ON inbound_addresses (tenant_id, user_id, verb)
  WHERE kind = 'user' AND status = 'active';

INSERT INTO public.schema_migrations (version) VALUES ('192_inbound_user_bcc_unique.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
