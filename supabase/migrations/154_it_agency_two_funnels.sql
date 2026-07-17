-- Migration 154: it_agency — split Leads into two funnels (Lead Processing + Sales Leads)
--
-- Additive only. Structure-first: 13 lead_lists (5 Lead Processing + 8 Sales Leads) per
-- existing it_agency tenant, each tagged with a new `funnel_key` and given its own
-- hidden per-list pipeline + statuses (mig-088 pattern). Existing generic it_agency lists
-- (New Leads/Qualified/Contacted) are left untouched — funnel_key stays NULL on them.
--
-- Expected before/after row counts:
--   lead_lists: +13 per it_agency tenant (0 if already applied — idempotent)
--   pipelines: +13 per it_agency tenant (one per new list, mirrors mig 088)
--   pipeline_stages: +32 per it_agency tenant (2+4+4+4+1 Lead Processing, 2+4+4+3+3+3+1+1 Sales Leads)
-- Rollback:
--   DELETE FROM pipeline_stages WHERE pipeline_id IN (SELECT id FROM pipelines WHERE list_id IN (SELECT id FROM lead_lists WHERE funnel_key IS NOT NULL));
--   DELETE FROM pipelines WHERE list_id IN (SELECT id FROM lead_lists WHERE funnel_key IS NOT NULL);
--   DELETE FROM lead_lists WHERE funnel_key IS NOT NULL;
--   ALTER TABLE lead_lists DROP COLUMN IF EXISTS funnel_key;
-- Applied: stage <PENDING> / prod HELD.

BEGIN;

-- ─── 1. Schema: funnel grouping key (nullable — null = ungrouped, other industries unaffected) ──

ALTER TABLE lead_lists ADD COLUMN IF NOT EXISTS funnel_key TEXT;
CREATE INDEX IF NOT EXISTS idx_lead_lists_funnel_key ON lead_lists (tenant_id, funnel_key) WHERE funnel_key IS NOT NULL;

-- ─── 2. Logging: before counts ─────────────────────────────────────────────

DO $$
DECLARE
  v_lists_before INT;
BEGIN
  SELECT COUNT(*) INTO v_lists_before FROM lead_lists WHERE funnel_key IS NOT NULL;
  RAISE NOTICE '154 BEFORE: % lead_lists with funnel_key set', v_lists_before;
END$$;

-- ─── 3. Seed the 13 stage-lists per it_agency tenant (idempotent via ON CONFLICT) ──

INSERT INTO lead_lists (tenant_id, name, slug, sort_order, is_system, is_archive, is_intake, color, access, funnel_key)
SELECT
  t.id,
  v.name,
  v.slug,
  v.sort_order,
  true,
  false,
  false,
  v.color,
  '{"mode":"all"}'::jsonb,
  v.funnel_key
FROM tenants t
CROSS JOIN (VALUES
  -- Lead Processing (data machine)
  ('Raw',            'raw',            1, 'lead_processing', '#3b82f6'),
  ('Cleaned',        'cleaned',        2, 'lead_processing', '#a855f7'),
  ('Enriched',       'enriched',       3, 'lead_processing', '#f59e0b'),
  ('Fit-Qualified',  'fit-qualified',  4, 'lead_processing', '#22c55e'),
  ('Disqualified',   'disqualified',   5, 'lead_processing', '#ef4444'),
  -- Sales Leads (selling machine)
  ('New Prospect',   'new-prospect',   1, 'sales_leads',     '#3b82f6'),
  ('In Outreach',    'in-outreach',    2, 'sales_leads',     '#a855f7'),
  ('Engaged',        'engaged',        3, 'sales_leads',     '#f59e0b'),
  ('Meeting Booked', 'meeting-booked', 4, 'sales_leads',     '#06b6d4'),
  ('Proposal',       'proposal',       5, 'sales_leads',     '#8b5cf6'),
  ('Negotiation',    'negotiation',    6, 'sales_leads',     '#eab308'),
  ('Won',            'won',            7, 'sales_leads',     '#22c55e'),
  ('Lost',           'lost',           8, 'sales_leads',     '#ef4444')
) AS v(name, slug, sort_order, funnel_key, color)
WHERE t.industry_id = 'it_agency'
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- ─── 4. Give each new list its own hidden pipeline + statuses (mirrors mig 088) ────
-- Idempotent: only touches funnel_key lists that don't yet have a pipeline_id.

DO $$
DECLARE
  r              RECORD;
  v_pipeline_id  UUID;
  v_slug         TEXT;
  v_pos          INT;
  v_lists_done   INT := 0;
  v_stages_done  INT := 0;
  v_cnt          INT;
BEGIN
  FOR r IN
    SELECT id, name, slug, tenant_id, funnel_key
    FROM   lead_lists
    WHERE  pipeline_id IS NULL
      AND  funnel_key IS NOT NULL
    ORDER  BY tenant_id, sort_order
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

    -- ── Statuses per stage-list slug ──
    IF r.slug = 'raw' THEN
      INSERT INTO pipeline_stages (tenant_id, pipeline_id, name, slug, position, color, is_default, is_terminal, terminal_type)
      VALUES
        (r.tenant_id, v_pipeline_id, 'Imported',       'imported',       0, '#3b82f6', true,  false, NULL),
        (r.tenant_id, v_pipeline_id, 'Source-tagged',  'source-tagged',  1, '#22c55e', false, false, NULL);

    ELSIF r.slug = 'cleaned' THEN
      INSERT INTO pipeline_stages (tenant_id, pipeline_id, name, slug, position, color, is_default, is_terminal, terminal_type)
      VALUES
        (r.tenant_id, v_pipeline_id, 'Needs cleaning', 'needs-cleaning', 0, '#f59e0b', true,  false, NULL),
        (r.tenant_id, v_pipeline_id, 'Duplicate',       'duplicate',      1, '#a855f7', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Invalid',         'invalid',        2, '#ef4444', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Clean',           'clean',          3, '#22c55e', false, false, NULL);

    ELSIF r.slug = 'enriched' THEN
      INSERT INTO pipeline_stages (tenant_id, pipeline_id, name, slug, position, color, is_default, is_terminal, terminal_type)
      VALUES
        (r.tenant_id, v_pipeline_id, 'Needs enrichment', 'needs-enrichment', 0, '#f59e0b', true,  false, NULL),
        (r.tenant_id, v_pipeline_id, 'Enriching',        'enriching',        1, '#a855f7', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Enriched',         'enriched-status',  2, '#22c55e', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Thin data',        'thin-data',        3, '#ef4444', false, false, NULL);

    ELSIF r.slug = 'fit-qualified' THEN
      INSERT INTO pipeline_stages (tenant_id, pipeline_id, name, slug, position, color, is_default, is_terminal, terminal_type)
      VALUES
        (r.tenant_id, v_pipeline_id, 'Needs review',    'needs-review',    0, '#f59e0b', true,  false, NULL),
        (r.tenant_id, v_pipeline_id, 'Fit',              'fit',             1, '#22c55e', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Not a fit',        'not-a-fit',       2, '#ef4444', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Maybe/nurture',    'maybe-nurture',   3, '#a855f7', false, false, NULL);

    ELSIF r.slug = 'disqualified' THEN
      INSERT INTO pipeline_stages (tenant_id, pipeline_id, name, slug, position, color, is_default, is_terminal, terminal_type)
      VALUES
        (r.tenant_id, v_pipeline_id, 'Disqualified', 'disqualified-status', 0, '#ef4444', true, true, NULL);

    ELSIF r.slug = 'new-prospect' THEN
      INSERT INTO pipeline_stages (tenant_id, pipeline_id, name, slug, position, color, is_default, is_terminal, terminal_type)
      VALUES
        (r.tenant_id, v_pipeline_id, 'Ready',    'ready',    0, '#3b82f6', true,  false, NULL),
        (r.tenant_id, v_pipeline_id, 'Assigned', 'assigned', 1, '#22c55e', false, false, NULL);

    ELSIF r.slug = 'in-outreach' THEN
      INSERT INTO pipeline_stages (tenant_id, pipeline_id, name, slug, position, color, is_default, is_terminal, terminal_type)
      VALUES
        (r.tenant_id, v_pipeline_id, 'Sequence active', 'sequence-active', 0, '#3b82f6', true,  false, NULL),
        (r.tenant_id, v_pipeline_id, 'Follow-up due',    'follow-up-due',   1, '#f59e0b', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Bounced',          'bounced',         2, '#ef4444', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Exhausted',        'exhausted',       3, '#6b7280', false, false, NULL);

    ELSIF r.slug = 'engaged' THEN
      INSERT INTO pipeline_stages (tenant_id, pipeline_id, name, slug, position, color, is_default, is_terminal, terminal_type)
      VALUES
        (r.tenant_id, v_pipeline_id, 'Warm',      'warm',      0, '#22c55e', true,  false, NULL),
        (r.tenant_id, v_pipeline_id, 'Objection', 'objection', 1, '#f59e0b', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Not now',   'not-now',   2, '#a855f7', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Ghosted',   'ghosted',   3, '#6b7280', false, false, NULL);

    ELSIF r.slug = 'meeting-booked' THEN
      INSERT INTO pipeline_stages (tenant_id, pipeline_id, name, slug, position, color, is_default, is_terminal, terminal_type)
      VALUES
        (r.tenant_id, v_pipeline_id, 'Scheduled', 'scheduled', 0, '#3b82f6', true,  false, NULL),
        (r.tenant_id, v_pipeline_id, 'Held',      'held',      1, '#22c55e', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'No-show',   'no-show',   2, '#ef4444', false, false, NULL);

    ELSIF r.slug = 'proposal' THEN
      INSERT INTO pipeline_stages (tenant_id, pipeline_id, name, slug, position, color, is_default, is_terminal, terminal_type)
      VALUES
        (r.tenant_id, v_pipeline_id, 'Drafting',  'drafting',  0, '#a855f7', true,  false, NULL),
        (r.tenant_id, v_pipeline_id, 'Sent',      'sent',      1, '#3b82f6', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Reviewing', 'reviewing', 2, '#f59e0b', false, false, NULL);

    ELSIF r.slug = 'negotiation' THEN
      INSERT INTO pipeline_stages (tenant_id, pipeline_id, name, slug, position, color, is_default, is_terminal, terminal_type)
      VALUES
        (r.tenant_id, v_pipeline_id, 'Verbal yes',   'verbal-yes',   0, '#22c55e', true,  false, NULL),
        (r.tenant_id, v_pipeline_id, 'Legal/terms',  'legal-terms',  1, '#3b82f6', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Stalled',      'stalled',      2, '#ef4444', false, false, NULL);

    ELSIF r.slug = 'won' THEN
      INSERT INTO pipeline_stages (tenant_id, pipeline_id, name, slug, position, color, is_default, is_terminal, terminal_type)
      VALUES
        (r.tenant_id, v_pipeline_id, 'Won', 'won-status', 0, '#22c55e', true, true, 'won');

    ELSIF r.slug = 'lost' THEN
      INSERT INTO pipeline_stages (tenant_id, pipeline_id, name, slug, position, color, is_default, is_terminal, terminal_type)
      VALUES
        (r.tenant_id, v_pipeline_id, 'Lost', 'lost-status', 0, '#ef4444', true, true, 'lost');
    END IF;

    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_stages_done := v_stages_done + v_cnt;

    UPDATE lead_lists SET pipeline_id = v_pipeline_id WHERE id = r.id;

    v_lists_done := v_lists_done + 1;
  END LOOP;

  RAISE NOTICE '154 SEED: created % list-pipelines, % statuses', v_lists_done, v_stages_done;
END$$;

-- ─── 5. Logging: after counts ──────────────────────────────────────────────

DO $$
DECLARE
  v_lists_after      INT;
  v_pipelines_after  INT;
  v_stages_after     INT;
BEGIN
  SELECT COUNT(*) INTO v_lists_after FROM lead_lists WHERE funnel_key IS NOT NULL;
  SELECT COUNT(*) INTO v_pipelines_after
    FROM pipelines WHERE list_id IN (SELECT id FROM lead_lists WHERE funnel_key IS NOT NULL);
  SELECT COUNT(*) INTO v_stages_after
    FROM pipeline_stages WHERE pipeline_id IN (
      SELECT id FROM pipelines WHERE list_id IN (SELECT id FROM lead_lists WHERE funnel_key IS NOT NULL)
    );
  RAISE NOTICE '154 AFTER: % funnel lead_lists, % list-pipelines, % statuses', v_lists_after, v_pipelines_after, v_stages_after;
END$$;

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('154_it_agency_two_funnels.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
