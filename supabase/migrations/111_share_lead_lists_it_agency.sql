-- Migration 111: Share Lead Lists to it_agency + complete travel_agency parity
-- DO NOT APPLY to prod — Opus applies after branch review, per-action approval (CLAUDE.md).
-- Additive only. Idempotent (ON CONFLICT DO NOTHING / IS NULL guards). Safe to re-run.
--
-- What this does:
--   1. Seeds funnel + off-funnel lists for it_agency tenants (New Leads/Contacted/
--      Qualified/Archived/Delete).
--   2. Seeds the missing Delete list for travel_agency tenants (parity, funnel already seeded
--      by migration 062).
--   3. Backfills leads.list_id -> intake list for it_agency leads with list_id IS NULL
--      (mirrors 062; no-op for travel_agency, already backfilled).
--   4. Per-list Kanban: creates one hidden list-bound pipeline + generic stages for every
--      lead_lists row with pipeline_id IS NULL, scoped to it_agency/travel_agency only
--      (mirrors 088's generic branch; deliberately excludes the pre-existing education_consultancy
--      admin-created list that also has pipeline_id IS NULL, out of scope for this migration).
--   5. Syncs it_agency leads onto their list-pipeline's default stage. NOTE: PipelineBoard
--      groups leads purely by lead.stage_id matched against the list's own pipeline stages
--      (src/components/pipeline/PipelineBoard.tsx groupByStage) -- a lead whose stage_id
--      belongs to a different pipeline is silently dropped from every Kanban column. This
--      step is required for the Kanban toggle to show leads at all, but it is a blunt reset:
--      any lead with real stage progress on the tenant's Default pipeline collapses to "New"
--      on the new list-pipeline. Flagged in the handback report for review before prod promotion.

BEGIN;

-- ─── Logging: before counts ─────────────────────────────────────────────────

DO $$
DECLARE
  v_lists            INT;
  v_leads_with_list  INT;
  v_pipelines        INT;
BEGIN
  SELECT COUNT(*) INTO v_lists FROM lead_lists;
  SELECT COUNT(*) INTO v_leads_with_list FROM leads WHERE list_id IS NOT NULL AND deleted_at IS NULL;
  SELECT COUNT(*) INTO v_pipelines FROM pipelines;
  RAISE NOTICE '111 BEFORE: % lead_lists, % leads with list_id, % pipelines', v_lists, v_leads_with_list, v_pipelines;
END$$;

-- ─── 1. Seed it_agency funnel + off-funnel lists ────────────────────────────
-- it_agency leads convert into the separate Deals pipeline, so the leads funnel is
-- top-of-funnel only (no "won/active clients" list). Delete is off-funnel via its slug.

INSERT INTO lead_lists (tenant_id, name, slug, sort_order, is_intake, is_archive, is_system, access, created_at, updated_at)
SELECT
  t.id,
  v.name,
  v.slug,
  v.sort_order,
  v.is_intake,
  v.is_archive,
  true AS is_system,
  '{"mode":"all"}'::jsonb AS access,
  now(),
  now()
FROM tenants t
CROSS JOIN (
  VALUES
    ('New Leads', 'new-leads', 1, true,  false),
    ('Contacted', 'contacted', 2, false, false),
    ('Qualified', 'qualified', 3, false, false),
    ('Archived',  'archived',  4, false, true),
    ('Delete',    'delete',    99, false, false)
) AS v(name, slug, sort_order, is_intake, is_archive)
WHERE t.industry_id = 'it_agency'
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- ─── 2. Seed the missing Delete list for travel_agency ──────────────────────
-- Funnel (Inquiries/Qualified/Active Clients) + Archived already seeded by 062.

INSERT INTO lead_lists (tenant_id, name, slug, sort_order, is_intake, is_archive, is_system, access, created_at, updated_at)
SELECT
  t.id,
  'Delete',
  'delete',
  99,
  false,
  false,
  true,
  '{"mode":"all"}'::jsonb,
  now(),
  now()
FROM tenants t
WHERE t.industry_id = 'travel_agency'
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- ─── 3. Backfill leads.list_id -> intake list for it_agency ─────────────────
-- list_id IS NULL guard makes this a no-op for travel_agency (already backfilled by 062)
-- and safe on re-run.

UPDATE leads l
SET list_id = ll.id, updated_at = now()
FROM lead_lists ll
JOIN tenants t ON t.id = ll.tenant_id
WHERE ll.tenant_id = l.tenant_id
  AND ll.is_intake = true
  AND l.list_id IS NULL
  AND l.deleted_at IS NULL
  AND t.industry_id = 'it_agency';

-- ─── 4. Per-list Kanban: create one hidden list-bound pipeline + generic stages ─
-- Reuses 088's generic branch. Scoped to it_agency/travel_agency so the pre-existing
-- education_consultancy admin-created list with pipeline_id IS NULL is left untouched.

DO $$
DECLARE
  r             RECORD;
  v_pipeline_id UUID;
  v_slug        TEXT;
  v_pos         INT;
  v_lists_done  INT := 0;
BEGIN
  FOR r IN
    SELECT ll.id, ll.name, ll.slug, ll.tenant_id
    FROM   lead_lists ll
    JOIN   tenants t ON t.id = ll.tenant_id
    WHERE  ll.pipeline_id IS NULL
      AND  t.industry_id IN ('it_agency', 'travel_agency')
    ORDER  BY ll.tenant_id, ll.sort_order
  LOOP
    v_slug := regexp_replace(lower(r.slug || '-pipeline'), '[^a-z0-9]+', '-', 'g');
    v_slug := trim(both '-' from v_slug);

    SELECT COALESCE(MAX(position), -1) + 1
    INTO   v_pos
    FROM   pipelines
    WHERE  tenant_id = r.tenant_id;

    INSERT INTO pipelines (tenant_id, name, slug, position, is_default, is_active, list_id)
    VALUES (r.tenant_id, r.name, v_slug, v_pos, false, true, r.id)
    RETURNING id INTO v_pipeline_id;

    INSERT INTO pipeline_stages (tenant_id, pipeline_id, name, slug, position, color, is_default, is_terminal, terminal_type)
    VALUES
      (r.tenant_id, v_pipeline_id, 'New',       'new',       0, '#3b82f6', true,  false, NULL),
      (r.tenant_id, v_pipeline_id, 'Contacted', 'contacted', 1, '#a855f7', false, false, NULL),
      (r.tenant_id, v_pipeline_id, 'Follow-up', 'follow-up', 2, '#f59e0b', false, false, NULL),
      (r.tenant_id, v_pipeline_id, 'Done',      'done',      3, '#22c55e', false, false, NULL);

    UPDATE lead_lists SET pipeline_id = v_pipeline_id WHERE id = r.id;

    v_lists_done := v_lists_done + 1;
  END LOOP;

  RAISE NOTICE '111: created % list-bound pipelines (it_agency + travel_agency)', v_lists_done;
END$$;

-- ─── 5. Sync it_agency leads onto their list-pipeline's default stage ───────
-- See header note: required for PipelineBoard to render these leads at all, but resets
-- any existing real stage progress on the tenant's prior Default pipeline to "New".

DO $$
DECLARE
  v_leads_synced INT;
BEGIN
  UPDATE leads l
  SET pipeline_id = lp.pipeline_id,
      stage_id    = ps.id,
      status      = ps.slug,
      updated_at  = now()
  FROM lead_lists lp
  JOIN tenants t ON t.id = lp.tenant_id
  JOIN pipeline_stages ps ON ps.pipeline_id = lp.pipeline_id AND ps.is_default = true
  WHERE l.list_id = lp.id
    AND l.deleted_at IS NULL
    AND t.industry_id = 'it_agency'
    AND lp.pipeline_id IS NOT NULL;

  GET DIAGNOSTICS v_leads_synced = ROW_COUNT;
  RAISE NOTICE '111: synced % it_agency leads onto their list pipeline default stage', v_leads_synced;
END$$;

-- ─── Logging: after counts ───────────────────────────────────────────────────

DO $$
DECLARE
  v_lists            INT;
  v_leads_with_list  INT;
  v_pipelines        INT;
BEGIN
  SELECT COUNT(*) INTO v_lists FROM lead_lists;
  SELECT COUNT(*) INTO v_leads_with_list FROM leads WHERE list_id IS NOT NULL AND deleted_at IS NULL;
  SELECT COUNT(*) INTO v_pipelines FROM pipelines;
  RAISE NOTICE '111 AFTER: % lead_lists, % leads with list_id, % pipelines', v_lists, v_leads_with_list, v_pipelines;
END$$;

COMMIT;
