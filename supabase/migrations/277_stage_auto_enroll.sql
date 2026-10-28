-- Migration 277: stage-triggered auto-enroll for Outreach sequences (email + SMS)
--
-- A sequence can be linked to one or more lead stages (lead_lists). When a lead enters a linked stage, the lead is
-- enrolled in that sequence automatically (the work is done by the existing bulk-enroll runner). Adds:
--   1) sequence_stage_triggers      — the rule: (stage, channel) -> sequence. One active rule per stage per channel.
--   2) sequence_enrollments.source / trigger_list_id — where an enrollment came from ('manual' | 'bulk' | 'stage_rule')
--      and, for a rule, the stage that started it. stop_reason gains 'stage_left'.
--   3) sequence_bulk_enrollments.trigger_kind / trigger_list_id — a run started by a rule is marked, so the manual
--      bulk-enroll history can keep ignoring it and the runner can tag the enrollments it creates.
--   4) lead_auto_enroll_optouts     — "don't auto-enroll this lead" (per lead, per channel).
--
-- Additive only. Wrapped in BEGIN/COMMIT. Every statement is idempotent.
--   Expected before/after row counts: 0 rows touched (new empty tables; new columns default to the old behaviour:
--   source='manual', trigger_kind='manual'; the CHECK swap rewrites nothing).
--   Rollback: DROP TABLE IF EXISTS public.lead_auto_enroll_optouts;
--             DROP TABLE IF EXISTS public.sequence_stage_triggers;
--             ALTER TABLE public.sequence_bulk_enrollments DROP COLUMN IF EXISTS trigger_list_id, DROP COLUMN IF EXISTS trigger_kind;
--             ALTER TABLE public.sequence_enrollments DROP COLUMN IF EXISTS trigger_list_id, DROP COLUMN IF EXISTS source;
--             ALTER TABLE public.sequence_enrollments DROP CONSTRAINT IF EXISTS sequence_enrollments_stop_reason_check;
--             ALTER TABLE public.sequence_enrollments ADD CONSTRAINT sequence_enrollments_stop_reason_check
--               CHECK (stop_reason IN ('replied', 'sequence_paused', 'suppressed'));
--             (the last step is only safe once no row holds 'stage_left')
--   Applied: stage <PENDING> / prod HELD.

BEGIN;

-- ── 1) sequence_stage_triggers ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sequence_stage_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sequence_id UUID NOT NULL REFERENCES public.email_sequences(id) ON DELETE CASCADE,
  list_id UUID NOT NULL REFERENCES public.lead_lists(id) ON DELETE CASCADE,
  -- copied from the sequence by the trigger below (same pattern as sequence_enrollments, mig 274) so it can never drift
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  -- the admin who set the rule up: the background run enrolls leads on their behalf (their assignment/permission context)
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One ACTIVE rule per stage per channel (one email + one SMS sequence per stage), so a stage move is never ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stage_trigger_active_list_channel
  ON public.sequence_stage_triggers (tenant_id, list_id, channel)
  WHERE is_active;

-- A sequence links to a stage at most once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stage_trigger_sequence_list
  ON public.sequence_stage_triggers (sequence_id, list_id);

CREATE INDEX IF NOT EXISTS idx_stage_triggers_sequence ON public.sequence_stage_triggers (sequence_id);

CREATE OR REPLACE FUNCTION public.sequence_stage_trigger_set_channel() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  SELECT s.channel INTO NEW.channel FROM public.email_sequences s WHERE s.id = NEW.sequence_id;
  IF NEW.channel IS NULL THEN
    NEW.channel := 'email';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stage_trigger_channel ON public.sequence_stage_triggers;
CREATE TRIGGER trg_stage_trigger_channel
  BEFORE INSERT OR UPDATE OF sequence_id ON public.sequence_stage_triggers
  FOR EACH ROW EXECUTE FUNCTION public.sequence_stage_trigger_set_channel();

DROP TRIGGER IF EXISTS set_sequence_stage_triggers_updated_at ON public.sequence_stage_triggers;
CREATE TRIGGER set_sequence_stage_triggers_updated_at
  BEFORE UPDATE ON public.sequence_stage_triggers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.sequence_stage_triggers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view stage triggers" ON public.sequence_stage_triggers;
CREATE POLICY "Tenant members can view stage triggers"
  ON public.sequence_stage_triggers FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Tenant admins can mutate stage triggers" ON public.sequence_stage_triggers;
CREATE POLICY "Tenant admins can mutate stage triggers"
  ON public.sequence_stage_triggers FOR ALL
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Service role full access to stage triggers" ON public.sequence_stage_triggers;
CREATE POLICY "Service role full access to stage triggers"
  ON public.sequence_stage_triggers FOR ALL
  USING (auth.role() = 'service_role');

-- ── 2) sequence_enrollments: where did it come from? ─────────────────────

ALTER TABLE public.sequence_enrollments
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'bulk', 'stage_rule'));

ALTER TABLE public.sequence_enrollments
  ADD COLUMN IF NOT EXISTS trigger_list_id UUID REFERENCES public.lead_lists(id) ON DELETE SET NULL;

-- "has this lead ever been auto-enrolled into this sequence?" (the once-only rule) and "which running enrollments came
-- from a stage rule?" (stop-on-leave) — both only look at stage_rule rows.
CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_stage_rule
  ON public.sequence_enrollments (tenant_id, sequence_id, lead_id)
  WHERE source = 'stage_rule';

ALTER TABLE public.sequence_enrollments DROP CONSTRAINT IF EXISTS sequence_enrollments_stop_reason_check;
ALTER TABLE public.sequence_enrollments
  ADD CONSTRAINT sequence_enrollments_stop_reason_check
  CHECK (stop_reason IN ('replied', 'sequence_paused', 'suppressed', 'stage_left'));

-- ── 3) sequence_bulk_enrollments: a run started by a rule ────────────────

ALTER TABLE public.sequence_bulk_enrollments
  ADD COLUMN IF NOT EXISTS trigger_kind TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_kind IN ('manual', 'stage_rule'));

ALTER TABLE public.sequence_bulk_enrollments
  ADD COLUMN IF NOT EXISTS trigger_list_id UUID REFERENCES public.lead_lists(id) ON DELETE SET NULL;

-- ── 4) lead_auto_enroll_optouts ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.lead_auto_enroll_optouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, lead_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_auto_enroll_optouts_lead ON public.lead_auto_enroll_optouts (lead_id);

ALTER TABLE public.lead_auto_enroll_optouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view auto-enroll opt-outs" ON public.lead_auto_enroll_optouts;
CREATE POLICY "Tenant members can view auto-enroll opt-outs"
  ON public.lead_auto_enroll_optouts FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Tenant admins can mutate auto-enroll opt-outs" ON public.lead_auto_enroll_optouts;
CREATE POLICY "Tenant admins can mutate auto-enroll opt-outs"
  ON public.lead_auto_enroll_optouts FOR ALL
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Service role full access to auto-enroll opt-outs" ON public.lead_auto_enroll_optouts;
CREATE POLICY "Service role full access to auto-enroll opt-outs"
  ON public.lead_auto_enroll_optouts FOR ALL
  USING (auth.role() = 'service_role');

INSERT INTO public.schema_migrations (version) VALUES ('277_stage_auto_enroll.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
