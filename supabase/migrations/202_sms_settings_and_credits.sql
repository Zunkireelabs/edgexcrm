-- Migration 202: SMS Phase 1 — per-tenant settings + platform-pool credit ledger
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: tenant_sms_settings 0 -> 0, sms_credit_accounts 0 -> 0,
--   sms_credit_ledger 0 -> 0 (new empty tables; no backfill in this migration).
--   Rollback: DROP FUNCTION IF EXISTS sms_credits_reserve, sms_credits_settle;
--             DROP TABLE IF EXISTS sms_credit_ledger, sms_credit_accounts, tenant_sms_settings;
--   Applied: stage HELD / prod HELD.
--
-- Context: EdgeX owns ONE Aakash SMS account (100,000 credits) shared across tenants.
-- Credits are a platform-owned pool allocated per tenant, not a per-tenant provider
-- account. sms_credit_accounts.balance/reserved are ONLY ever written by the two
-- SECURITY DEFINER RPCs below — never directly by application code.

BEGIN;

-- ── tenant_sms_settings ──────────────────────────────────────────────────────
-- Structural clone of tenant_email_settings (migration 045).

CREATE TABLE IF NOT EXISTS tenant_sms_settings (
  tenant_id             UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  sender_label          TEXT,
  quiet_hours_start     SMALLINT NOT NULL DEFAULT 8,
  quiet_hours_end       SMALLINT NOT NULL DEFAULT 20,
  quiet_hours_enabled   BOOLEAN NOT NULL DEFAULT true,
  timezone              TEXT,             -- NULL => fall back to tenants.timezone
  optout_footer         TEXT,
  max_recipients_per_blast INT NOT NULL DEFAULT 500 CHECK (max_recipients_per_blast BETWEEN 1 AND 20000),
  low_credit_threshold  INT NOT NULL DEFAULT 200,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE tenant_sms_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view sms settings" ON tenant_sms_settings;
CREATE POLICY "Tenant members can view sms settings"
  ON tenant_sms_settings FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Tenant admins can mutate sms settings" ON tenant_sms_settings;
CREATE POLICY "Tenant admins can mutate sms settings"
  ON tenant_sms_settings FOR ALL
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Service role full access to sms settings" ON tenant_sms_settings;
CREATE POLICY "Service role full access to sms settings"
  ON tenant_sms_settings FOR ALL
  USING (auth.role() = 'service_role');

-- ── sms_credit_accounts ──────────────────────────────────────────────────────
-- Deliberately NO CHECK (balance >= 0): sms_credits_settle() may legitimately push
-- balance negative when the provider's actual per-recipient credit charge exceeds
-- our up-front reserve estimate (e.g. a message straddled a segment boundary we
-- mis-measured, or the provider billed differently than our local counter). That
-- is a rare, bounded overage we want visible in the ledger, not a constraint
-- violation that would abort the settle transaction and leave reserved credits
-- stuck. Non-negativity IS enforced on the debit side, in sms_credits_reserve()
-- (balance < amount => refuse), which is the only path that can ever move
-- balance down from a healthy state. Do not add a CHECK (balance >= 0) here.

CREATE TABLE IF NOT EXISTS sms_credit_accounts (
  tenant_id         UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  balance           INTEGER NOT NULL DEFAULT 0,
  reserved          INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  lifetime_granted  INTEGER NOT NULL DEFAULT 0,
  lifetime_consumed INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sms_credit_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view sms credit account" ON sms_credit_accounts;
CREATE POLICY "Tenant members can view sms credit account"
  ON sms_credit_accounts FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Service role full access to sms credit accounts" ON sms_credit_accounts;
CREATE POLICY "Service role full access to sms credit accounts"
  ON sms_credit_accounts FOR ALL
  USING (auth.role() = 'service_role');

-- ── sms_credit_ledger ─────────────────────────────────────────────────────────
-- Append-only. Never UPDATE or DELETE a row.

CREATE TABLE IF NOT EXISTS sms_credit_ledger (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  delta          INTEGER NOT NULL,
  reason         TEXT NOT NULL CHECK (reason IN ('grant', 'reserve', 'settle', 'settle_overage', 'refund', 'adjustment', 'reconcile_note')),
  balance_after  INTEGER NOT NULL,
  ref_type       TEXT,
  ref_id         UUID,
  actor_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_credit_ledger_tenant_time
  ON sms_credit_ledger (tenant_id, created_at DESC);

-- Idempotency guard: makes a retried caller (e.g. a re-run Inngest step) of
-- reserve/settle a safe no-op via ON CONFLICT DO NOTHING in the RPCs below,
-- rather than double-booking (or, for a diff=0 settle, double-debiting) the
-- same ref_id. The RPCs write the ledger row FIRST and gate the account
-- mutation on whether that insert actually happened — see sms_credits_reserve
-- and sms_credits_settle. 'settle' covers both diff>0 and diff<0 outcomes
-- (previously split into 'refund'/'settle_overage', which left the diff=0
-- case with no ledger row for this index to catch a replay against).
CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_ledger_reserve_ref
  ON sms_credit_ledger (tenant_id, ref_type, ref_id, reason)
  WHERE reason IN ('reserve', 'settle', 'refund', 'settle_overage');

ALTER TABLE sms_credit_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view sms credit ledger" ON sms_credit_ledger;
CREATE POLICY "Tenant members can view sms credit ledger"
  ON sms_credit_ledger FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Service role full access to sms credit ledger" ON sms_credit_ledger;
CREATE POLICY "Service role full access to sms credit ledger"
  ON sms_credit_ledger FOR ALL
  USING (auth.role() = 'service_role');

-- ── sms_credits_reserve ──────────────────────────────────────────────────────
-- Reserves an ESTIMATED credit amount ahead of a send. Row-locks the account so
-- concurrent reserves against the same tenant serialize instead of racing past
-- each other. Refuses (writes nothing) if the account is missing or underfunded.

CREATE OR REPLACE FUNCTION sms_credits_reserve(
  p_tenant_id UUID,
  p_amount    INT,
  p_ref_type  TEXT,
  p_ref_id    UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance   INT;
  v_reserved  INT;
  v_ledger_id UUID;
BEGIN
  SELECT balance, reserved INTO v_balance, v_reserved
  FROM sms_credit_accounts
  WHERE tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'shortfall', p_amount, 'reason', 'no_account');
  END IF;

  IF v_balance < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'balance', v_balance, 'reserved', v_reserved, 'shortfall', p_amount - v_balance);
  END IF;

  -- Write the ledger row FIRST — the unique index decides whether this is a
  -- replay of an already-applied reserve. Only mutate the account if the
  -- insert actually inserted, so a retried call (same ref_id) can't debit
  -- twice while the ledger only ever gets one row for it.
  INSERT INTO sms_credit_ledger (tenant_id, delta, reason, balance_after, ref_type, ref_id)
  VALUES (p_tenant_id, -p_amount, 'reserve', v_balance - p_amount, p_ref_type, p_ref_id)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_ledger_id;

  IF v_ledger_id IS NULL THEN
    -- Replay of an already-applied reserve: return current state, mutate nothing.
    RETURN jsonb_build_object('ok', true, 'balance', v_balance, 'reserved', v_reserved, 'shortfall', 0, 'replayed', true);
  END IF;

  UPDATE sms_credit_accounts
  SET balance = balance - p_amount,
      reserved = reserved + p_amount,
      updated_at = now()
  WHERE tenant_id = p_tenant_id
  RETURNING balance, reserved INTO v_balance, v_reserved;

  RETURN jsonb_build_object('ok', true, 'balance', v_balance, 'reserved', v_reserved, 'shortfall', 0);
END;
$$;

-- ── sms_credits_settle ───────────────────────────────────────────────────────
-- Reconciles a prior reserve() against the provider's ACTUAL per-recipient credit
-- total (ground truth). diff > 0 (we over-reserved) => refund the difference back
-- to balance. diff < 0 (provider charged more than estimated) => balance absorbs
-- the overage and may go negative — see the comment on sms_credit_accounts above.

CREATE OR REPLACE FUNCTION sms_credits_settle(
  p_tenant_id UUID,
  p_ref_id    UUID,
  p_reserved  INT,
  p_actual    INT
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
  VALUES (p_tenant_id, v_diff, 'settle', v_balance + v_diff, 'sms_blast', p_ref_id,
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
INSERT INTO public.schema_migrations (version) VALUES ('202_sms_settings_and_credits.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
