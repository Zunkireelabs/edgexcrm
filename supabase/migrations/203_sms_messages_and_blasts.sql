-- Migration 203: SMS Phase 1 — blasts + per-message send records
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: sms_blasts 0 -> 0, sms_messages 0 -> 0 (new empty tables).
--   Rollback: DROP TABLE IF EXISTS sms_messages, sms_blasts;
--   Applied: stage HELD / prod HELD.
--
-- sms_messages rows are materialized up front (status 'queued') for every intended
-- recipient before any send call is made. Combined with uq_sms_message_blast_lead,
-- this makes a retried/re-run blast job idempotent: re-running INSERTs into an
-- already-populated blast is a no-op via ON CONFLICT DO NOTHING, so a blast can
-- never double-send a lead.

BEGIN;

CREATE TABLE IF NOT EXISTS sms_blasts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,
  body                     TEXT NOT NULL,          -- raw {{merge}} template, no prefix/footer
  audience_filter          JSONB,                   -- encoded FilterTree (src/lib/filters)
  audience_snapshot_count  INT,
  status                   TEXT NOT NULL DEFAULT 'draft' CHECK (status IN
                             ('draft', 'scheduled', 'queued', 'sending', 'sent', 'partially_failed', 'failed', 'cancelled')),
  scheduled_for            TIMESTAMPTZ,
  estimated_credits        INT,
  reserved_credits         INT,
  actual_credits           INT,
  recipients_total         INT NOT NULL DEFAULT 0,
  recipients_sent          INT NOT NULL DEFAULT 0,
  recipients_failed        INT NOT NULL DEFAULT 0,
  recipients_suppressed    INT NOT NULL DEFAULT 0,
  created_by               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at               TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_blasts_tenant_time ON sms_blasts (tenant_id, created_at DESC);

ALTER TABLE sms_blasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view sms blasts" ON sms_blasts;
CREATE POLICY "Tenant members can view sms blasts"
  ON sms_blasts FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Service role full access to sms blasts" ON sms_blasts;
CREATE POLICY "Service role full access to sms blasts"
  ON sms_blasts FOR ALL
  USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS sms_messages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  blast_id              UUID REFERENCES sms_blasts(id) ON DELETE CASCADE,   -- NULL for 1:1 / sequence sends
  lead_id               UUID REFERENCES leads(id) ON DELETE SET NULL,
  source                TEXT NOT NULL CHECK (source IN ('blast', 'manual', 'sequence')),
  to_phone              TEXT NOT NULL,     -- as sent to the provider: bare 10-digit MSISDN
  to_phone_stored       TEXT,              -- original leads.phone value, for audit
  body                  TEXT NOT NULL,     -- fully rendered: sender-label prefix + body + footer
  encoding              TEXT CHECK (encoding IN ('gsm7', 'unicode')),
  segments              SMALLINT,
  estimated_credits     SMALLINT,
  status                TEXT NOT NULL DEFAULT 'queued' CHECK (status IN
                          ('queued', 'deferred', 'sending', 'submitted', 'delivered', 'failed', 'suppressed', 'cancelled')),
  deferred_until        TIMESTAMPTZ,
  provider              TEXT NOT NULL DEFAULT 'aakash',
  provider_message_id   TEXT,
  provider_credit       SMALLINT,
  provider_network      TEXT,
  provider_status       TEXT,
  error_code            TEXT,
  error_message         TEXT,
  attempt_count         SMALLINT NOT NULL DEFAULT 0,
  sent_at               TIMESTAMPTZ,
  delivered_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency backbone: recipient rows for a blast are materialized up front;
-- a retried/re-run job INSERTs the same (blast_id, lead_id) pairs and relies on
-- ON CONFLICT DO NOTHING here to guarantee a blast can never double-send a lead.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_message_blast_lead
  ON sms_messages (blast_id, lead_id) WHERE blast_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sms_messages_lead ON sms_messages (lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_messages_pending
  ON sms_messages (tenant_id, status) WHERE status IN ('queued', 'deferred', 'sending');

CREATE INDEX IF NOT EXISTS idx_sms_messages_provider_id
  ON sms_messages (provider_message_id) WHERE provider_message_id IS NOT NULL;

ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view sms messages" ON sms_messages;
CREATE POLICY "Tenant members can view sms messages"
  ON sms_messages FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Service role full access to sms messages" ON sms_messages;
CREATE POLICY "Service role full access to sms messages"
  ON sms_messages FOR ALL
  USING (auth.role() = 'service_role');

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('203_sms_messages_and_blasts.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
