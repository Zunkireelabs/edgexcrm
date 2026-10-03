-- Migration 258: bulk enroll — runs and per-lead results (OUTREACH-BULK-ENROLL-BRIEF.md §5).
--
-- Why: a lead enters a sequence only through the single-lead enroll call, so putting hundreds of leads in a
-- sequence meant hundreds of page visits. Bulk enroll resolves an audience (selected rows or a filter) when the
-- rep clicks Start, saves one row per lead here, and a background worker enrolls them in chunks. Saving the
-- per-lead rows is what makes it restart-safe (a restart continues with the 'pending' rows), idempotent
-- (UNIQUE (run_id, lead_id)), cancellable, and gives the progress line + the "skipped" download.
--
-- sequence_bulk_enrollments        one row per bulk run
-- sequence_bulk_enrollment_items   one row per lead in that run, with its outcome
--
-- Additive only: two NEW tables, no existing table touched. Both are tenant-owned: tenant_id FK with CASCADE
-- + RLS (SELECT via get_user_tenant_ids(); writes only through the service-role API/worker, so no write policy).
--   Expected before/after row counts: 0 rows touched (new empty tables).
--   Rollback: DROP TABLE IF EXISTS public.sequence_bulk_enrollment_items; DROP TABLE IF EXISTS public.sequence_bulk_enrollments;
--   Applied: stage <PENDING> / prod HELD.

BEGIN;

CREATE TABLE IF NOT EXISTS public.sequence_bulk_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sequence_id UUID NOT NULL REFERENCES public.email_sequences(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source_mode TEXT NOT NULL CHECK (source_mode IN ('selected', 'filter')),
  -- the filter tree, or {"lead_ids": <count>} for hand-picked rows — an audit trail, not read back
  source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  conflict_policy TEXT NOT NULL DEFAULT 'skip' CHECK (conflict_policy IN ('skip', 'switch', 'queue')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'cancelled', 'failed')),
  total_count INT NOT NULL DEFAULT 0,
  enrolled_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  cancel_requested BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seq_bulk_enrollments_tenant_status
  ON public.sequence_bulk_enrollments (tenant_id, status);

CREATE TABLE IF NOT EXISTS public.sequence_bulk_enrollment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES public.sequence_bulk_enrollments(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'enrolled', 'skipped', 'failed')),
  reason TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_seq_bulk_items_run_outcome
  ON public.sequence_bulk_enrollment_items (run_id, outcome);

DROP TRIGGER IF EXISTS set_seq_bulk_enrollments_updated_at ON public.sequence_bulk_enrollments;
CREATE TRIGGER set_seq_bulk_enrollments_updated_at
  BEFORE UPDATE ON public.sequence_bulk_enrollments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.sequence_bulk_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequence_bulk_enrollment_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view bulk enrollments" ON public.sequence_bulk_enrollments;
CREATE POLICY "Tenant members can view bulk enrollments"
  ON public.sequence_bulk_enrollments FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Tenant members can view bulk enrollment items" ON public.sequence_bulk_enrollment_items;
CREATE POLICY "Tenant members can view bulk enrollment items"
  ON public.sequence_bulk_enrollment_items FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

INSERT INTO public.schema_migrations (version) VALUES ('258_sequence_bulk_enroll.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
