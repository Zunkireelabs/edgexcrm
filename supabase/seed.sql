-- ============================================================
-- LOCAL DEV SEED — synthetic test data only (NO prod data).
-- Loaded by `supabase start` / `supabase db reset` AFTER:
--   1. ./baseline/schema.sql  (full schema baselined from stage)
--   2. ./baseline/ledger.sql  (marks 125 historical migrations applied)
-- See supabase/config.toml [db.seed] and scripts/local-db-setup.sh.
--
-- The login user + tenant_users link are created by scripts/local-db-setup.sh
-- (via the local Auth admin API) because they need a GoTrue-managed auth uid.
-- ============================================================

-- baseline/schema.sql (a pg_dump) sets search_path='' for the load session. Reset it
-- so trigger functions that reference tables unqualified (e.g. ensure_single_default_pipeline)
-- resolve against public during seeding.
SET search_path TO public, extensions, storage;

-- 1. it_agency test tenant (current dev focus)
INSERT INTO public.tenants (id, name, slug, primary_color, industry_id, config)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Test Agency',
  'test-agency',
  '#6366f1',
  'it_agency',
  '{}'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- 2. Default pipeline for the test tenant
INSERT INTO public.pipelines (id, tenant_id, name, slug, is_default, position)
VALUES (
  '11111111-1111-1111-1111-000000000010',
  '11111111-1111-1111-1111-111111111111',
  'Sales Pipeline',
  'sales-pipeline',
  true,
  0
) ON CONFLICT (id) DO NOTHING;

-- 3. it_agency default pipeline stages (mirrors industries.default_pipeline_stages)
INSERT INTO public.pipeline_stages (id, pipeline_id, tenant_id, name, slug, position, color, is_default, is_terminal)
VALUES
  ('11111111-1111-1111-1111-000000000020', '11111111-1111-1111-1111-000000000010', '11111111-1111-1111-1111-111111111111', 'New',           'new',            0, '#3b82f6', true,  false),
  ('11111111-1111-1111-1111-000000000021', '11111111-1111-1111-1111-000000000010', '11111111-1111-1111-1111-111111111111', 'Discovery Call', 'discovery-call', 1, '#f97316', false, false),
  ('11111111-1111-1111-1111-000000000022', '11111111-1111-1111-1111-000000000010', '11111111-1111-1111-1111-111111111111', 'Proposal Sent',  'proposal-sent',  2, '#a855f7', false, false),
  ('11111111-1111-1111-1111-000000000023', '11111111-1111-1111-1111-000000000010', '11111111-1111-1111-1111-111111111111', 'Negotiation',    'negotiation',    3, '#eab308', false, false),
  ('11111111-1111-1111-1111-000000000024', '11111111-1111-1111-1111-000000000010', '11111111-1111-1111-1111-111111111111', 'Won',            'won',            4, '#22c55e', false, true),
  ('11111111-1111-1111-1111-000000000025', '11111111-1111-1111-1111-000000000010', '11111111-1111-1111-1111-111111111111', 'Lost',           'lost',           5, '#ef4444', false, true)
ON CONFLICT (id) DO NOTHING;

-- 4. Storage buckets (mirror stage: knowledge-base-files, lead-documents, employee-photos)
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('knowledge-base-files', 'knowledge-base-files', false),
  ('lead-documents',       'lead-documents',       true),
  ('employee-photos',      'employee-photos',      false)
ON CONFLICT (id) DO NOTHING;
