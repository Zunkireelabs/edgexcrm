-- Migration 228: per-tenant email blast recipient cap (F4, docs/BLAST-FINDINGS-2026-09-06.md)
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: tenant_email_settings 0 rows touched (existing
--   rows get the column default on read, not a rewrite — same posture as migration
--   211's bulk_email_enabled/daily_send_cap addition).
--   Rollback: ALTER TABLE tenant_email_settings DROP COLUMN IF EXISTS max_recipients_per_blast;
--   Applied: stage HELD / prod HELD.
--
-- Context: SMS has tenant_sms_settings.max_recipients_per_blast (migration 202) enforced
-- in the send route before materialize. Email has no equivalent — the only nearby
-- constant, MAX_RECIPIENTS_PER_CALL in email-blast-send.ts, is the Inngest batch size,
-- not a ceiling. An email blast to Admizz's ~16,684-lead audience is today unbounded,
-- against a shared Resend plan of 50,000/month across ALL tenants. This mirrors SMS's
-- column exactly (same name, same bounds) rather than inventing a new shape.
--
-- Default is 2,000, deliberately lower than SMS's 500-vs-20,000-ceiling proportions
-- would suggest and far below the 20,000 ceiling — so a tenant's first real bulk email
-- blast fails loudly with MAX_RECIPIENTS_EXCEEDED and gets a conscious admin decision to
-- raise it, rather than silently sending to an audience that could eat a third of the
-- platform's monthly email quota in one click.

BEGIN;

ALTER TABLE tenant_email_settings
  ADD COLUMN IF NOT EXISTS max_recipients_per_blast INT NOT NULL DEFAULT 2000
    CHECK (max_recipients_per_blast BETWEEN 1 AND 20000);

COMMENT ON COLUMN tenant_email_settings.max_recipients_per_blast IS
  'Hard per-blast recipient cap, enforced in email-blasts/[id]/send/route.ts BEFORE '
  'compose/materialize (F4 — the send is REJECTED with MAX_RECIPIENTS_EXCEEDED, never '
  'truncated). Distinct from daily_send_cap (migration 211), which throttles the '
  'worker''s daily send volume across all blasts/sequences and never rejects the send '
  'call itself. Mirrors tenant_sms_settings.max_recipients_per_blast (migration 202).';

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('228_email_blast_recipient_cap.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
