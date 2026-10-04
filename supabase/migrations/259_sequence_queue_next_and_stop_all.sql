-- Migration 259: "queue next" + "stop-all" for sequences (OUTREACH-BULK-ENROLL-BRIEF.md §5, Phase 2b).
--
-- 1) sequence_enrollment_queue — a lead can be in only ONE running sequence (uq_enrollment_active_lead, mig 176).
--    "Queue next" parks the next sequence for a lead that is already in one: when the current enrollment
--    completes or is unenrolled, the worker enrolls the lead in the queued sequence. One waiting row per lead.
--    A separate table on purpose — the sequence_enrollments.status CHECK is read by many places and is not widened.
--
-- 2) sequence_enrollments.stop_reason gets a second value, 'sequence_paused': set by the sequence-level
--    "Pause all", so "Resume all" resumes exactly those and never a lead that is paused because they replied
--    (stop_reason 'replied', mig 257) or that a rep paused by hand (stop_reason NULL).
--
-- Additive only: one NEW table + a widened CHECK (every existing row — NULL or 'replied' — still satisfies it).
-- The new table is tenant-owned: tenant_id FK CASCADE + RLS (SELECT via get_user_tenant_ids(); writes only
-- through the service-role API/worker, so no write policy).
--   Expected before/after row counts: 0 rows touched (new empty table; constraint swap rewrites nothing).
--   Rollback: DROP TABLE IF EXISTS public.sequence_enrollment_queue;
--             ALTER TABLE public.sequence_enrollments DROP CONSTRAINT IF EXISTS sequence_enrollments_stop_reason_check;
--             ALTER TABLE public.sequence_enrollments ADD CONSTRAINT sequence_enrollments_stop_reason_check CHECK (stop_reason IN ('replied'));
--             (only safe once no row holds 'sequence_paused' — resume or unenroll those first)
--   Applied: stage <PENDING> / prod HELD.

BEGIN;

CREATE TABLE IF NOT EXISTS public.sequence_enrollment_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  sequence_id UUID NOT NULL REFERENCES public.email_sequences(id) ON DELETE CASCADE,
  queued_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  run_id UUID REFERENCES public.sequence_bulk_enrollments(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'started', 'cancelled', 'failed')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ
);

-- one waiting "next sequence" per lead
CREATE UNIQUE INDEX IF NOT EXISTS uq_enrollment_queue_waiting_lead
  ON public.sequence_enrollment_queue (tenant_id, lead_id)
  WHERE status = 'waiting';

CREATE INDEX IF NOT EXISTS idx_enrollment_queue_lead
  ON public.sequence_enrollment_queue (lead_id);

ALTER TABLE public.sequence_enrollment_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view enrollment queue" ON public.sequence_enrollment_queue;
CREATE POLICY "Tenant members can view enrollment queue"
  ON public.sequence_enrollment_queue FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

ALTER TABLE public.sequence_enrollments DROP CONSTRAINT IF EXISTS sequence_enrollments_stop_reason_check;
ALTER TABLE public.sequence_enrollments
  ADD CONSTRAINT sequence_enrollments_stop_reason_check CHECK (stop_reason IN ('replied', 'sequence_paused'));

INSERT INTO public.schema_migrations (version) VALUES ('259_sequence_queue_next_and_stop_all.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
