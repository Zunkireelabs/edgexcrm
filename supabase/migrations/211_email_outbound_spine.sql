-- Migration 211: Email Outbound Spine + Compliance (Outreach Phase 0, dark)
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: email_suppressions 0 -> 0, email_unsubscribe_tokens 0 -> 0,
--   email_messages 0 -> 0 (new empty tables; no backfill). tenant_email_settings gains two nullable-
--   default columns (bulk_email_enabled, daily_send_cap) — 0 rows touched, existing rows get the
--   column defaults on read, not a rewrite.
--   Rollback: ALTER TABLE tenant_email_settings DROP COLUMN IF EXISTS bulk_email_enabled;
--             ALTER TABLE tenant_email_settings DROP COLUMN IF EXISTS daily_send_cap;
--             DROP TABLE IF EXISTS email_messages, email_unsubscribe_tokens, email_suppressions;
--   Applied: stage HELD / prod HELD (feature ships dark — EMAIL_OUTBOUND_ENABLED unset everywhere).
--
-- Context: docs/OUTREACH-PHASE0-BRIEF.md. This is the same problem sms_suppressions /
-- sms_optout_tokens / sms_messages (migs 202-204) already solved for the other channel —
-- table shapes below mirror those directly; see each table's comment for the one place
-- email's shape genuinely differs (per-tenant email normalization vs. phone E.164, and
-- source_id's deliberately missing FK — see email_messages below).

BEGIN;

-- ── email_suppressions ───────────────────────────────────────────────────────
-- The do-not-contact list. Direct analogue of sms_suppressions. Suppression is
-- PER-TENANT, not global — unsubscribing from Admizz must not silence the
-- address for Zunkiree. The unique index encodes that; do not "improve" it to
-- a global index.

CREATE TABLE IF NOT EXISTS email_suppressions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('unsubscribe', 'hard_bounce', 'complaint', 'manual', 'invalid')),
  source        TEXT,
  lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN email_suppressions.email IS
  'Stored lowercased and trimmed. Normalized on write by the single normalizeEmail() helper in '
  'src/lib/email/outbound/suppression.ts — callers must not normalize ad hoc.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_suppression_tenant_email
  ON email_suppressions (tenant_id, email);

ALTER TABLE email_suppressions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view email suppressions" ON email_suppressions;
CREATE POLICY "Tenant members can view email suppressions"
  ON email_suppressions FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Tenant admins can mutate email suppressions" ON email_suppressions;
CREATE POLICY "Tenant admins can mutate email suppressions"
  ON email_suppressions FOR ALL
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Service role full access to email suppressions" ON email_suppressions;
CREATE POLICY "Service role full access to email suppressions"
  ON email_suppressions FOR ALL
  USING (auth.role() = 'service_role');

-- ── email_unsubscribe_tokens ─────────────────────────────────────────────────
-- One STABLE, reusable token per (tenant, email) — not per message. Direct
-- analogue of sms_optout_tokens, for the same reason: someone must be able to
-- unsubscribe from an email sent six months ago. `used_at` is a record, not a
-- gate — the link keeps working after it's used, or a second tap looks like we
-- ignored them.

CREATE TABLE IF NOT EXISTS email_unsubscribe_tokens (
  token         TEXT PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_unsub_tenant_email
  ON email_unsubscribe_tokens (tenant_id, email);

ALTER TABLE email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view email unsubscribe tokens" ON email_unsubscribe_tokens;
CREATE POLICY "Tenant members can view email unsubscribe tokens"
  ON email_unsubscribe_tokens FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Deliberately NO user-facing INSERT/UPDATE/DELETE policy — tokens are minted
-- and consumed server-side only (service role), never by an authenticated user.

DROP POLICY IF EXISTS "Service role full access to email unsubscribe tokens" ON email_unsubscribe_tokens;
CREATE POLICY "Service role full access to email unsubscribe tokens"
  ON email_unsubscribe_tokens FOR ALL
  USING (auth.role() = 'service_role');

-- ── email_messages — the idempotency backbone ────────────────────────────────
-- The materialized per-recipient row. This is the table that makes a retried
-- job safe, and it is the most important object in the phase.
--
-- DESIGN TRADEOFF: source_id is a generic nullable UUID with no foreign key,
-- where sms_messages uses a real blast_id FK. That is deliberate — email_blasts
-- does not exist until Phase 1, and a forward FK would either block this phase
-- or force building the blast table before the spine that sends it. We trade
-- referential integrity for the ability to land and test idempotency now. If
-- Phase 1 wants the FK back, it can add a blast_id column alongside.

CREATE TABLE IF NOT EXISTS email_messages (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id                UUID REFERENCES leads(id) ON DELETE SET NULL,
  source                 TEXT NOT NULL CHECK (source IN ('blast', 'sequence', 'manual')),
  source_id              UUID,     -- blast id (Phase 1) or enrollment/draft id (Phase 2); no FK, see above
  to_email               TEXT NOT NULL,     -- normalized (lowercased/trimmed), what's actually sent to
  to_email_stored        TEXT,              -- original leads.email value, for audit
  subject                TEXT NOT NULL,
  body_html              TEXT NOT NULL,
  body_text              TEXT,
  status                 TEXT NOT NULL DEFAULT 'queued' CHECK (status IN
                            ('queued', 'sending', 'sent', 'delivered', 'failed', 'suppressed', 'bounced', 'complained', 'cancelled')),
  provider               TEXT NOT NULL DEFAULT 'resend',
  provider_message_id    TEXT,
  error_code             TEXT,
  error_message          TEXT,
  attempt_count          SMALLINT NOT NULL DEFAULT 0,
  sending_started_at     TIMESTAMPTZ,     -- stamped on queued->sending; the reclaim rule's clock
  sent_at                TIMESTAMPTZ,
  delivered_at           TIMESTAMPTZ,
  bounced_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency backbone. Recipient rows are materialized UP FRONT; a retried or
-- re-run job re-INSERTs the same (source_id, lead_id) pairs and relies on
-- ON CONFLICT DO NOTHING here to guarantee we can never double-send a lead.
--
-- NOT partial (no WHERE clause) — PostgREST's on_conflict takes column names
-- only and cannot target a partial index (Postgres can't infer one without its
-- WHERE predicate), so a partial index here would be untargetable by
-- .upsert(..., { onConflict: "source_id,lead_id", ignoreDuplicates: true }) and
-- Phase 1's chunked materialization would abort its whole chunk on the first
-- duplicate instead of skipping it. NULLS DISTINCT (the Postgres default)
-- means rows with a NULL source_id never conflict with one another, and since
-- lead_id is nullable (ON DELETE SET NULL), a NULL lead_id likewise never
-- conflicts — idempotency holds only while lead_id is non-null, which
-- materialization always sets.
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_message_source_lead
  ON email_messages (source_id, lead_id);

CREATE INDEX IF NOT EXISTS idx_email_messages_pending
  ON email_messages (tenant_id, status) WHERE status IN ('queued', 'sending');

CREATE INDEX IF NOT EXISTS idx_email_messages_lead ON email_messages (lead_id, created_at DESC);

-- The webhook's only lookup key. Without this every Resend event is a seq scan.
CREATE INDEX IF NOT EXISTS idx_email_messages_provider_id
  ON email_messages (provider_message_id) WHERE provider_message_id IS NOT NULL;

ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view email messages" ON email_messages;
CREATE POLICY "Tenant members can view email messages"
  ON email_messages FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Service role full access to email messages" ON email_messages;
CREATE POLICY "Service role full access to email messages"
  ON email_messages FOR ALL
  USING (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS set_email_messages_updated_at ON email_messages;
CREATE TRIGGER set_email_messages_updated_at
  BEFORE UPDATE ON email_messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── tenant_email_settings — additive columns ─────────────────────────────────
-- Reuse the existing table (migration 045); no new settings table.

ALTER TABLE tenant_email_settings ADD COLUMN IF NOT EXISTS bulk_email_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tenant_email_settings ADD COLUMN IF NOT EXISTS daily_send_cap INT NOT NULL DEFAULT 2000;

COMMENT ON COLUMN tenant_email_settings.bulk_email_enabled IS
  'Per-tenant grant for the bulk/marketing send lane (blasts, sequences). Layered on top of the '
  'EMAIL_OUTBOUND_ENABLED env kill switch — both must be true for src/lib/email/outbound to send.';
COMMENT ON COLUMN tenant_email_settings.daily_send_cap IS
  'Enforced by sendQueuedEmailBatch() (src/lib/email/outbound/send.ts). A blown cap throttles '
  '(remainder stays queued) — it must never silently drop.';

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('211_email_outbound_spine.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
