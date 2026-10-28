-- Migration 279: saved (named) lead filters — one click to reapply a frequently used filter.
--
-- A user builds a filter on the Leads table (e.g. "Assigned to is any of Amit Rawal" +
-- "Stage: Prospects"), gives it a name, and reopens it later. Private to the user who saved it.
-- `filter_tree` holds the same FilterTree JSON the Leads filter bar already encodes into `?f=`.
--
-- Additive: one new table, no existing rows touched.
--   Expected before/after row counts: saved_lead_filters: new table (0 -> 0); leads unchanged.
--   Rollback: DROP TABLE IF EXISTS public.saved_lead_filters;
--   Applied: stage HELD / prod HELD (rides the deploy pipeline migrate job).

BEGIN;

CREATE TABLE IF NOT EXISTS public.saved_lead_filters (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id)    ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id)        ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  filter_tree JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A user can't have two saved filters with the same name (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_lead_filters_user_name
  ON public.saved_lead_filters (tenant_id, user_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS idx_saved_lead_filters_tenant_user
  ON public.saved_lead_filters (tenant_id, user_id, created_at);

ALTER TABLE public.saved_lead_filters ENABLE ROW LEVEL SECURITY;

-- Private per user: only the owner of a row can see or change it, inside their own tenants.
DROP POLICY IF EXISTS "saved_lead_filters_select" ON public.saved_lead_filters;
CREATE POLICY "saved_lead_filters_select" ON public.saved_lead_filters
  FOR SELECT USING (
    tenant_id IN (SELECT get_user_tenant_ids()) AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "saved_lead_filters_insert" ON public.saved_lead_filters;
CREATE POLICY "saved_lead_filters_insert" ON public.saved_lead_filters
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT get_user_tenant_ids()) AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "saved_lead_filters_update" ON public.saved_lead_filters;
CREATE POLICY "saved_lead_filters_update" ON public.saved_lead_filters
  FOR UPDATE USING (
    tenant_id IN (SELECT get_user_tenant_ids()) AND user_id = auth.uid()
  ) WITH CHECK (
    tenant_id IN (SELECT get_user_tenant_ids()) AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "saved_lead_filters_delete" ON public.saved_lead_filters;
CREATE POLICY "saved_lead_filters_delete" ON public.saved_lead_filters
  FOR DELETE USING (
    tenant_id IN (SELECT get_user_tenant_ids()) AND user_id = auth.uid()
  );

INSERT INTO public.schema_migrations (version) VALUES ('279_saved_lead_filters.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
