-- Migration 191: EdgeX native email inbound spine (Phase 1)
--
-- docs/email-productionization/INBOUND-SPINE-BRIEF.md. Makes emails/email_threads
-- provider-agnostic (Gmail send stays the default; Resend-inbound rows can now be
-- written), adds the reply-token table (inbound_addresses), a catch-all dead-letter
-- table for unrouted/rejected inbound mail, and the per-tenant rollout gate
-- (tenant_email_settings.inbound_enabled). No app code reads/writes any of this
-- until EDGEX_INBOUND_ENABLED=true — see §2 decision 6 and §8 of the brief.
--
-- Expected before/after row counts: emails 0 rows touched (column adds are
-- nullable-relaxing + defaulted, existing Gmail rows unaffected), email_threads
-- 0 rows touched (same), inbound_addresses 0 -> 0 (new table, no seed),
-- inbound_email_dead_letter 0 -> 0 (new table, no seed), tenant_email_settings
-- N -> N (new column, all existing tenants land inbound_enabled = false).
--
-- Rollback:
--   DROP TABLE IF EXISTS inbound_email_dead_letter CASCADE;
--   DROP TABLE IF EXISTS inbound_addresses CASCADE;
--   ALTER TABLE tenant_email_settings DROP COLUMN IF EXISTS inbound_enabled;
--   DROP INDEX IF EXISTS idx_email_threads_account_gmail_thread;
--   CREATE UNIQUE INDEX idx_email_threads_account_gmail_thread
--     ON email_threads (connected_email_account_id, gmail_thread_id);
--   ALTER TABLE email_threads DROP COLUMN IF EXISTS provider;
--   ALTER TABLE email_threads ALTER COLUMN connected_email_account_id SET NOT NULL;
--   ALTER TABLE email_threads ALTER COLUMN gmail_thread_id SET NOT NULL;
--   DROP INDEX IF EXISTS idx_emails_provider_dedup;
--   ALTER TABLE emails DROP COLUMN IF EXISTS sender_verdict;
--   ALTER TABLE emails DROP COLUMN IF EXISTS attachments;
--   ALTER TABLE emails DROP COLUMN IF EXISTS inbound_route;
--   ALTER TABLE emails DROP COLUMN IF EXISTS provider_message_id;
--   ALTER TABLE emails DROP COLUMN IF EXISTS provider;
--   ALTER TABLE emails ALTER COLUMN connected_email_account_id SET NOT NULL;
--   ALTER TABLE emails ALTER COLUMN gmail_message_id SET NOT NULL;
--   (Rollback of the NOT NULL restores only works while zero Resend-inbound rows
--   exist with NULL gmail_message_id/connected_email_account_id — true until this
--   phase's code actually starts writing them.)
--
-- Applied: local HELD / stage HELD / prod HELD. Written but NOT applied to any
-- database per the brief — migrations ride the deploy pipelines.

BEGIN;

-- ── emails: provider-agnostic columns ───────────────────────────────────────

ALTER TABLE emails ALTER COLUMN gmail_message_id DROP NOT NULL;
ALTER TABLE emails ALTER COLUMN connected_email_account_id DROP NOT NULL;

ALTER TABLE emails ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'gmail';
ALTER TABLE emails ADD COLUMN IF NOT EXISTS provider_message_id TEXT;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS inbound_route TEXT;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]';
ALTER TABLE emails ADD COLUMN IF NOT EXISTS sender_verdict JSONB;

-- Webhook-redelivery idempotency anchor for Resend-inbound rows (mirrors
-- idx_messages_provider_dedup, mig 044:138). Gmail rows keep using
-- idx_emails_gmail_message (connected_email_account_id, gmail_message_id).
DROP INDEX IF EXISTS idx_emails_provider_dedup;
CREATE UNIQUE INDEX idx_emails_provider_dedup
  ON emails (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- ── email_threads: provider-agnostic columns ────────────────────────────────

ALTER TABLE email_threads ALTER COLUMN connected_email_account_id DROP NOT NULL;
ALTER TABLE email_threads ALTER COLUMN gmail_thread_id DROP NOT NULL;

ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'gmail';

-- Recreate as a PARTIAL unique index. Without the WHERE clause, the now-nullable
-- columns would silently stop enforcing uniqueness for the Gmail-account rows
-- that still need it (Postgres treats NULL <> NULL, so a plain unique index on
-- nullable columns lets unlimited NULL/NULL rows through anyway — the partial
-- form makes that explicit rather than accidental).
DROP INDEX IF EXISTS idx_email_threads_account_gmail_thread;
CREATE UNIQUE INDEX idx_email_threads_account_gmail_thread
  ON email_threads (connected_email_account_id, gmail_thread_id)
  WHERE connected_email_account_id IS NOT NULL AND gmail_thread_id IS NOT NULL;

-- ── inbound_addresses: stored-random reply/bcc/fwd tokens ───────────────────
--
-- Stored random tokens, NOT HMAC-derived (brief §2 decision 3): an HMAC-derived
-- address is baked into every email already sitting in leads' mailboxes forever,
-- so rotating the secret would break every historical reply address, and one
-- leaked address couldn't be revoked without killing all of them. A stored
-- 144-bit random token is individually revocable and carries tenant_id on the
-- row itself — the row IS the authorization (brief §8).

CREATE TABLE IF NOT EXISTS inbound_addresses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('thread', 'user', 'tenant')),
  verb          TEXT NOT NULL CHECK (verb IN ('reply', 'bcc', 'fwd')),
  token         TEXT NOT NULL UNIQUE,
  thread_id     UUID REFERENCES email_threads(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inbound_addresses_tenant ON inbound_addresses (tenant_id);
CREATE INDEX IF NOT EXISTS idx_inbound_addresses_thread ON inbound_addresses (thread_id) WHERE thread_id IS NOT NULL;

ALTER TABLE inbound_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inbound_addresses_select" ON inbound_addresses;
CREATE POLICY "inbound_addresses_select" ON inbound_addresses
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "inbound_addresses_insert" ON inbound_addresses;
CREATE POLICY "inbound_addresses_insert" ON inbound_addresses
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "inbound_addresses_update" ON inbound_addresses;
CREATE POLICY "inbound_addresses_update" ON inbound_addresses
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "inbound_addresses_delete" ON inbound_addresses;
CREATE POLICY "inbound_addresses_delete" ON inbound_addresses
  FOR DELETE USING (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "inbound_addresses_service_role" ON inbound_addresses;
CREATE POLICY "inbound_addresses_service_role" ON inbound_addresses
  FOR ALL USING (auth.role() = 'service_role');

-- ── inbound_email_dead_letter: nothing is ever silently dropped ────────────
--
-- tenant_id is nullable BY DESIGN — unrouted mail (no matching token) has no
-- tenant to attach to. Service-role-only RLS: this table exists for ops
-- triage, not tenant-facing UI.

CREATE TABLE IF NOT EXISTS inbound_email_dead_letter (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID REFERENCES tenants(id) ON DELETE CASCADE,
  provider_message_id TEXT UNIQUE,
  from_address        TEXT,
  to_addresses        TEXT[] NOT NULL DEFAULT '{}',
  subject             TEXT,
  reason              TEXT NOT NULL,
  raw_event           JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inbound_dead_letter_tenant ON inbound_email_dead_letter (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inbound_dead_letter_created ON inbound_email_dead_letter (created_at DESC);

ALTER TABLE inbound_email_dead_letter ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inbound_email_dead_letter_service_role" ON inbound_email_dead_letter;
CREATE POLICY "inbound_email_dead_letter_service_role" ON inbound_email_dead_letter
  FOR ALL USING (auth.role() = 'service_role');

-- ── tenant_email_settings: per-tenant rollout gate ──────────────────────────
--
-- DEFAULT false is deliberate and load-bearing (mirrors tenants.ai_enabled,
-- mig 174) — every existing tenant lands opted-out; inbound only activates
-- where flipped true AND EDGEX_INBOUND_ENABLED=true.

ALTER TABLE tenant_email_settings ADD COLUMN IF NOT EXISTS inbound_enabled BOOLEAN NOT NULL DEFAULT false;

INSERT INTO public.schema_migrations (version) VALUES ('191_inbound_email_spine.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
