-- Migration 283: EDGEX-87 A1 — education Home "Do next" (counsellor Home).
-- ROLLBACK: DROP TABLE IF EXISTS public.home_item_snoozes;
--           DROP TRIGGER IF EXISTS trg_leads_assigned_at ON public.leads; DROP FUNCTION IF EXISTS public.set_lead_assigned_at();
--           DROP INDEX IF EXISTS public.uniq_application_stages_submit_per_pipeline;
--           ALTER TABLE public.application_stages DROP COLUMN IF EXISTS is_submit_stage;
--           ALTER TABLE public.leads DROP COLUMN IF EXISTS assigned_at;
--           (and delete this file's row from schema_migrations)
--
-- Three additive pieces:
--
-- 1. leads.assigned_at (nullable). Stamped by trigger when assigned_to is set on INSERT, or changes on UPDATE
--    (set to now(); null when unassigned). The trigger touches NO other column.
--    NO BACKFILL, deliberately: the Home rule `new_uncalled` reads coalesce(assigned_at, created_at) and only looks at
--    leads assigned in the last 14 days, so the created_at fallback for pre-existing rows stops mattering two weeks
--    after deploy.
--    Existing leads triggers (checked): trigger_leads_updated_at (BEFORE UPDATE, sets updated_at only),
--    trg_leads_assignee_is_collaborator_ins / _upd (AFTER, mig 252), trg_leads_assignee_follows_sequences (AFTER UPDATE
--    OF assigned_to, mig 263). This one is BEFORE and writes only NEW.assigned_at, so it cannot conflict with them.
--    RPCs leads_visible_to_user (mig 195/255) RETURNS SETOF public.leads, so a new column flows through untouched;
--    lead_aggregates RETURNS TABLE (dimension, key, bucket, cnt) and does not enumerate leads columns.
--
-- 2. application_stages.is_submit_stage (boolean, default false): marks the stage at/after which an application counts
--    as "submitted" (used by the Home deadline_docs rule). Seeded true for slug = 'applied'. At most one per pipeline.
--    Expected counts: application_stages rows unchanged; rows with is_submit_stage = true afterwards = rows with slug 'applied'.
--
-- 3. home_item_snoozes: per-user "snooze until" for a Home item (key = rule kind + subject id).
--    Written by the server (service role) only; a member can read only their own rows.
--
-- Additive only. Before/after counts: leads n -> n, application_stages n -> n, home_item_snoozes (new) 0 rows.
--   Applied: stage <date> / prod HELD.

BEGIN;

-- 1. leads.assigned_at ------------------------------------------------------------------------------------------
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.set_lead_assigned_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_to IS NOT NULL THEN
      NEW.assigned_at := now();
    END IF;
  ELSIF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    NEW.assigned_at := CASE WHEN NEW.assigned_to IS NULL THEN NULL ELSE now() END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_assigned_at ON public.leads;
CREATE TRIGGER trg_leads_assigned_at
  BEFORE INSERT OR UPDATE OF assigned_to ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_lead_assigned_at();

-- 2. application_stages.is_submit_stage ---------------------------------------------------------------------------
ALTER TABLE public.application_stages ADD COLUMN IF NOT EXISTS is_submit_stage BOOLEAN NOT NULL DEFAULT false;

UPDATE public.application_stages SET is_submit_stage = true WHERE slug = 'applied' AND is_submit_stage = false;

-- At most one submit stage per pipeline (stages with no pipeline_id are keyed by tenant).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_application_stages_submit_per_pipeline
  ON public.application_stages (tenant_id, COALESCE(pipeline_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_submit_stage;

-- 3. home_item_snoozes ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.home_item_snoozes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_key    TEXT NOT NULL,
  until       TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT home_item_snoozes_once UNIQUE (tenant_id, user_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_home_item_snoozes_user ON public.home_item_snoozes (tenant_id, user_id, until);

ALTER TABLE public.home_item_snoozes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "home_item_snoozes_select_own" ON public.home_item_snoozes;
CREATE POLICY "home_item_snoozes_select_own" ON public.home_item_snoozes
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()) AND user_id = auth.uid());

DROP POLICY IF EXISTS "home_item_snoozes_service_all" ON public.home_item_snoozes;
CREATE POLICY "home_item_snoozes_service_all" ON public.home_item_snoozes
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

INSERT INTO public.schema_migrations (version) VALUES ('283_education_home_a1.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
