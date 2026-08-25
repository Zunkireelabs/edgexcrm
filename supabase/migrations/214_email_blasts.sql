-- Migration 214: Email Outbound Phase 1 — email_blasts
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: email_blasts 0 -> 0 (new empty table).
--   Rollback: DROP TABLE IF EXISTS email_blasts;
--   Applied: stage HELD / prod HELD (feature ships dark — EMAIL_OUTBOUND_ENABLED
--             unset everywhere, same posture as migration 211).
--
-- Context: docs/OUTREACH-PHASE1-BRIEF.md. Direct analogue of sms_blasts
-- (migration 203) minus everything credit-related (email has no per-send
-- provider cost to reserve/settle) plus the fields email needs (subject,
-- from-name override). email_messages (migration 211) already carries the
-- generic source/source_id pair a blast materializes into — no FK from
-- email_messages back to this table by design (see 211's comment); the
-- non-partial uq_email_message_source_lead index is what makes
-- .upsert(chunk, { onConflict: "source_id,lead_id", ignoreDuplicates: true })
-- possible for materialization (§5 of the brief).
--
-- 'throttled' is the one status sms_blasts does not have. It exists because
-- tenant_email_settings.daily_send_cap (default 2000, migration 211) can be
-- far smaller than a real audience (Admizz: 16,684) — see §6 of the brief.
-- A blast that hits the cap must show as in-progress-with-a-resume-time, not
-- silently report "sent" after sending only the first 2000.

BEGIN;

CREATE TABLE IF NOT EXISTS email_blasts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,          -- internal label, never sent
  subject_template         TEXT NOT NULL,          -- raw {{merge}}, no footer
  body_template            TEXT NOT NULL,          -- raw {{merge}} HTML, no footer
  from_name_override       TEXT,                   -- NULL => resolveTenantSender's default
  audience_filter          JSONB,                   -- encoded FilterTree (src/lib/filters)
  audience_snapshot_count  INT,
  status                   TEXT NOT NULL DEFAULT 'draft' CHECK (status IN
                             ('draft', 'scheduled', 'queued', 'sending', 'throttled', 'sent',
                              'partially_failed', 'failed', 'cancelled')),
  scheduled_for            TIMESTAMPTZ,
  recipients_total         INT NOT NULL DEFAULT 0,
  recipients_sent          INT NOT NULL DEFAULT 0,
  recipients_failed        INT NOT NULL DEFAULT 0,
  recipients_suppressed    INT NOT NULL DEFAULT 0,
  created_by               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at               TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_blasts_tenant_time ON email_blasts (tenant_id, created_at DESC);

ALTER TABLE email_blasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view email blasts" ON email_blasts;
CREATE POLICY "Tenant members can view email blasts"
  ON email_blasts FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Tenant admins can mutate email blasts" ON email_blasts;
CREATE POLICY "Tenant admins can mutate email blasts"
  ON email_blasts FOR ALL
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Service role full access to email blasts" ON email_blasts;
CREATE POLICY "Service role full access to email blasts"
  ON email_blasts FOR ALL
  USING (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS set_email_blasts_updated_at ON email_blasts;
CREATE TRIGGER set_email_blasts_updated_at
  BEFORE UPDATE ON email_blasts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('214_email_blasts.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
