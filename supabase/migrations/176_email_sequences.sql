-- Migration 176: Email sequencing (Outreach) — Stage 1 headless spine
--
-- Adds a cadence engine for it_agency: email_sequences (template + steps),
-- sequence_enrollments (a lead running a sequence), and
-- sequence_step_drafts (the per-step draft worklist). Stage 1 is
-- manual-send-only: a draft is generated per step, a human reviews/edits/
-- copies/sends from their own inbox, then marks it sent in EdgeX (logged to
-- lead_activities). draft_source and sent_via are seam columns — later
-- stages swap in AI drafting and EdgeX-native send with no schema rework.
--
-- Expected before/after row counts: new tables only, 0 rows touched on
-- existing tables.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.sequence_step_drafts;
--   DROP TABLE IF EXISTS public.sequence_enrollments;
--   DROP TABLE IF EXISTS public.email_sequence_steps;
--   DROP TABLE IF EXISTS public.email_sequences;
--
-- Applied: stage HELD / prod HELD.

BEGIN;

-- ── email_sequences ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_sequences_tenant ON public.email_sequences (tenant_id);

-- ── email_sequence_steps ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_sequence_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sequence_id UUID NOT NULL REFERENCES public.email_sequences(id) ON DELETE CASCADE,
  step_order INT NOT NULL CHECK (step_order >= 1),
  delay_days INT NOT NULL DEFAULT 0 CHECK (delay_days >= 0),
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  draft_source TEXT NOT NULL DEFAULT 'template' CHECK (draft_source IN ('template', 'ai')),
  subject_template TEXT NOT NULL DEFAULT '',
  body_template TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_email_sequence_steps_sequence_order
  ON public.email_sequence_steps (sequence_id, step_order);

-- ── sequence_enrollments ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sequence_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sequence_id UUID NOT NULL REFERENCES public.email_sequences(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'unenrolled')),
  current_step_order INT NOT NULL DEFAULT 0,
  enrolled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_lead ON public.sequence_enrollments (lead_id);
CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_sequence ON public.sequence_enrollments (sequence_id);

-- A lead may be in at most one running (active/paused) cadence at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_enrollment_active_lead
  ON public.sequence_enrollments (tenant_id, lead_id)
  WHERE status IN ('active', 'paused');

-- ── sequence_step_drafts ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sequence_step_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  enrollment_id UUID NOT NULL REFERENCES public.sequence_enrollments(id) ON DELETE CASCADE,
  step_id UUID REFERENCES public.email_sequence_steps(id) ON DELETE SET NULL,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  step_order INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped')),
  due_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  draft_source TEXT NOT NULL DEFAULT 'template',
  subject TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  edited BOOLEAN NOT NULL DEFAULT false,
  sent_at TIMESTAMPTZ,
  sent_via TEXT CHECK (sent_via IN ('manual_copy', 'edgex_send', 'agent')),
  sent_activity_id UUID REFERENCES lead_activities(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sequence_step_drafts_worklist
  ON public.sequence_step_drafts (tenant_id, assigned_to, status, due_at);
CREATE INDEX IF NOT EXISTS idx_sequence_step_drafts_enrollment
  ON public.sequence_step_drafts (enrollment_id);
CREATE INDEX IF NOT EXISTS idx_sequence_step_drafts_lead
  ON public.sequence_step_drafts (lead_id);

-- ── updated_at triggers (reuses update_updated_at() from mig 001) ────────

DROP TRIGGER IF EXISTS set_email_sequences_updated_at ON public.email_sequences;
CREATE TRIGGER set_email_sequences_updated_at
  BEFORE UPDATE ON public.email_sequences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS set_email_sequence_steps_updated_at ON public.email_sequence_steps;
CREATE TRIGGER set_email_sequence_steps_updated_at
  BEFORE UPDATE ON public.email_sequence_steps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS set_sequence_enrollments_updated_at ON public.sequence_enrollments;
CREATE TRIGGER set_sequence_enrollments_updated_at
  BEFORE UPDATE ON public.sequence_enrollments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS set_sequence_step_drafts_updated_at ON public.sequence_step_drafts;
CREATE TRIGGER set_sequence_step_drafts_updated_at
  BEFORE UPDATE ON public.sequence_step_drafts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE public.email_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sequence_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequence_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequence_step_drafts ENABLE ROW LEVEL SECURITY;

-- email_sequences: any tenant member reads; only admins mutate.
DROP POLICY IF EXISTS "Tenant members can view email sequences" ON public.email_sequences;
CREATE POLICY "Tenant members can view email sequences"
  ON public.email_sequences FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Tenant admins can mutate email sequences" ON public.email_sequences;
CREATE POLICY "Tenant admins can mutate email sequences"
  ON public.email_sequences FOR ALL
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Service role full access to email sequences" ON public.email_sequences;
CREATE POLICY "Service role full access to email sequences"
  ON public.email_sequences FOR ALL
  USING (auth.role() = 'service_role');

-- email_sequence_steps: any tenant member reads; only admins mutate.
DROP POLICY IF EXISTS "Tenant members can view email sequence steps" ON public.email_sequence_steps;
CREATE POLICY "Tenant members can view email sequence steps"
  ON public.email_sequence_steps FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Tenant admins can mutate email sequence steps" ON public.email_sequence_steps;
CREATE POLICY "Tenant admins can mutate email sequence steps"
  ON public.email_sequence_steps FOR ALL
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Service role full access to email sequence steps" ON public.email_sequence_steps;
CREATE POLICY "Service role full access to email sequence steps"
  ON public.email_sequence_steps FOR ALL
  USING (auth.role() = 'service_role');

-- sequence_enrollments: any tenant member reads AND mutates (reps enroll/pause their own work).
DROP POLICY IF EXISTS "Tenant members can view sequence enrollments" ON public.sequence_enrollments;
CREATE POLICY "Tenant members can view sequence enrollments"
  ON public.sequence_enrollments FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Tenant members can mutate sequence enrollments" ON public.sequence_enrollments;
CREATE POLICY "Tenant members can mutate sequence enrollments"
  ON public.sequence_enrollments FOR ALL
  USING (tenant_id IN (SELECT get_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Service role full access to sequence enrollments" ON public.sequence_enrollments;
CREATE POLICY "Service role full access to sequence enrollments"
  ON public.sequence_enrollments FOR ALL
  USING (auth.role() = 'service_role');

-- sequence_step_drafts: any tenant member reads AND mutates (reps edit/send/skip their own drafts).
DROP POLICY IF EXISTS "Tenant members can view sequence step drafts" ON public.sequence_step_drafts;
CREATE POLICY "Tenant members can view sequence step drafts"
  ON public.sequence_step_drafts FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Tenant members can mutate sequence step drafts" ON public.sequence_step_drafts;
CREATE POLICY "Tenant members can mutate sequence step drafts"
  ON public.sequence_step_drafts FOR ALL
  USING (tenant_id IN (SELECT get_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Service role full access to sequence step drafts" ON public.sequence_step_drafts;
CREATE POLICY "Service role full access to sequence step drafts"
  ON public.sequence_step_drafts FOR ALL
  USING (auth.role() = 'service_role');

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('176_email_sequences.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
