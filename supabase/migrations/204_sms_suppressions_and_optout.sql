-- Migration 204: SMS Phase 2 — suppression list, opt-out tokens, Phase 1 cleanup
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: sms_suppressions 0 -> 0, sms_optout_tokens 0 -> 0
--   (new empty tables; no backfill). sms_messages gains nullable column `shortcode`
--   (0 rows touched — table is empty on every environment this has been applied to).
--   sms_credits_settle is dropped and recreated with an added p_ref_type parameter
--   (function-only change, no rows touched). Four updated_at triggers added.
--   Rollback: DROP TRIGGER set_tenant_sms_settings_updated_at ON tenant_sms_settings;
--             DROP TRIGGER set_sms_credit_accounts_updated_at ON sms_credit_accounts;
--             DROP TRIGGER set_sms_blasts_updated_at ON sms_blasts;
--             DROP TRIGGER set_sms_messages_updated_at ON sms_messages;
--             ALTER TABLE sms_messages DROP COLUMN IF EXISTS shortcode;
--             DROP FUNCTION IF EXISTS sms_credits_settle(UUID, UUID, INT, INT, TEXT);
--             -- then recreate the mig-202 4-arg sms_credits_settle from that file if reverting fully.
--             DROP TABLE IF EXISTS sms_optout_tokens, sms_suppressions;
--   Applied: stage HELD / prod HELD (SMS remains dark — SMS_ENABLED=false).
--
-- Context: Aakash gives no free-form inbound SMS, so we can never honour "Reply
-- STOP" and must own our own do-not-contact list + opt-out link entirely (Nepal
-- has no DND registry to check against either). See docs/SMS-PHASE2-BRIEF.md.

BEGIN;

-- ── sms_suppressions ─────────────────────────────────────────────────────────
-- The do-not-contact list. Keyed on normalized E.164 phone, NOT the bare
-- 10-digit `to_phone` shape sms_messages uses for the provider call — this
-- table must match against leads.phone, form submissions, and manual admin
-- entry, which arrive in the five different shapes documented in migration 158.
-- That asymmetry with sms_messages.to_phone is deliberate, not a bug.

CREATE TABLE IF NOT EXISTS sms_suppressions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_e164    TEXT NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('opt_out', 'manual', 'hard_bounce', 'complaint', 'invalid')),
  source        TEXT,
  lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN sms_suppressions.phone_e164 IS
  'Normalized E.164 ("+9779800000000"), NOT sms_messages.to_phone''s bare-10-digit provider shape. '
  'Suppression must join against leads.phone / form submissions / manual entry, which arrive in the '
  'five shapes documented in migration 158 — E.164 is the only stable common key across those.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_suppression_tenant_phone
  ON sms_suppressions (tenant_id, phone_e164);

ALTER TABLE sms_suppressions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view sms suppressions" ON sms_suppressions;
CREATE POLICY "Tenant members can view sms suppressions"
  ON sms_suppressions FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Tenant admins can mutate sms suppressions" ON sms_suppressions;
CREATE POLICY "Tenant admins can mutate sms suppressions"
  ON sms_suppressions FOR ALL
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Service role full access to sms suppressions" ON sms_suppressions;
CREATE POLICY "Service role full access to sms suppressions"
  ON sms_suppressions FOR ALL
  USING (auth.role() = 'service_role');

-- ── sms_optout_tokens ────────────────────────────────────────────────────────
-- One STABLE, reusable token per (tenant, phone) — not per message. Keeps the
-- footer short (every character is billed) and lets someone opt out from a
-- message sent months ago. `used_at` is a record, not a gate: the link must
-- keep working after use, or a repeat tap looks like we ignored them.

CREATE TABLE IF NOT EXISTS sms_optout_tokens (
  token         TEXT PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_e164    TEXT NOT NULL,
  lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_optout_tenant_phone
  ON sms_optout_tokens (tenant_id, phone_e164);

ALTER TABLE sms_optout_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view sms optout tokens" ON sms_optout_tokens;
CREATE POLICY "Tenant members can view sms optout tokens"
  ON sms_optout_tokens FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Deliberately NO user-facing INSERT/UPDATE/DELETE policy — tokens are minted
-- and consumed server-side only (service role), never by an authenticated user.

DROP POLICY IF EXISTS "Service role full access to sms optout tokens" ON sms_optout_tokens;
CREATE POLICY "Service role full access to sms optout tokens"
  ON sms_optout_tokens FOR ALL
  USING (auth.role() = 'service_role');

-- ── updated_at triggers (reuses update_updated_at() from mig 001) ────────────
-- L-4 cleanup from the Phase 1 review: these four tables shipped in migs
-- 202/203 without the trigger every other table follows (see mig 176), so
-- updated_at never moved.

DROP TRIGGER IF EXISTS set_tenant_sms_settings_updated_at ON tenant_sms_settings;
CREATE TRIGGER set_tenant_sms_settings_updated_at
  BEFORE UPDATE ON tenant_sms_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS set_sms_credit_accounts_updated_at ON sms_credit_accounts;
CREATE TRIGGER set_sms_credit_accounts_updated_at
  BEFORE UPDATE ON sms_credit_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS set_sms_blasts_updated_at ON sms_blasts;
CREATE TRIGGER set_sms_blasts_updated_at
  BEFORE UPDATE ON sms_blasts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS set_sms_messages_updated_at ON sms_messages;
CREATE TRIGGER set_sms_messages_updated_at
  BEFORE UPDATE ON sms_messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── L-3: persist the provider's shortcode (sender ID actually used) ──────────
-- Observed "AT_Alert" today; the only record of which sender ID a message went
-- out under, which changes the moment a branded ID is registered with NTC/Ncell.

ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS shortcode TEXT;

-- ── L-1: sms_credits_settle needs a p_ref_type parameter ─────────────────────
-- Migration 202 hardcoded ref_type = 'sms_blast' in the ledger insert while
-- sms_credits_reserve already takes p_ref_type. Phase 5's 1:1 sends
-- (ref_type = 'sms_message') would otherwise write mislabeled ledger rows.
-- Changing the signature requires DROP + recreate — migration 202 is merged,
-- so this cannot be an in-place CREATE OR REPLACE.

DROP FUNCTION IF EXISTS sms_credits_settle(UUID, UUID, INT, INT);

CREATE OR REPLACE FUNCTION sms_credits_settle(
  p_tenant_id UUID,
  p_ref_id    UUID,
  p_reserved  INT,
  p_actual    INT,
  p_ref_type  TEXT DEFAULT 'sms_blast'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance   INT;
  v_reserved  INT;
  v_diff      INT;
  v_ledger_id UUID;
BEGIN
  SELECT balance, reserved INTO v_balance, v_reserved
  FROM sms_credit_accounts
  WHERE tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_account');
  END IF;

  v_diff := p_reserved - p_actual;

  -- Always write exactly one ledger row per settle — including when diff = 0
  -- (our estimate was exactly right), so a retried call always has a row for
  -- the unique index to catch as a replay. Write it FIRST and gate the
  -- mutation on whether the insert actually inserted, same shape as reserve.
  INSERT INTO sms_credit_ledger (tenant_id, delta, reason, balance_after, ref_type, ref_id, notes)
  VALUES (p_tenant_id, v_diff, 'settle', v_balance + v_diff, p_ref_type, p_ref_id,
          format('reserved %s, actual %s', p_reserved, p_actual))
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_ledger_id;

  IF v_ledger_id IS NULL THEN
    -- Replay of an already-applied settle: return current state, mutate nothing.
    RETURN jsonb_build_object('ok', true, 'balance', v_balance, 'reserved', v_reserved, 'diff', v_diff, 'replayed', true);
  END IF;

  UPDATE sms_credit_accounts
  SET reserved = reserved - p_reserved,
      balance = balance + v_diff,
      lifetime_consumed = lifetime_consumed + p_actual,
      updated_at = now()
  WHERE tenant_id = p_tenant_id
  RETURNING balance, reserved INTO v_balance, v_reserved;

  RETURN jsonb_build_object('ok', true, 'balance', v_balance, 'reserved', v_reserved, 'diff', v_diff);
END;
$$;

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('204_sms_suppressions_and_optout.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
