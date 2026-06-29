-- Migration 088: Per-List Stages
-- Each lead_list gets its own pipeline (hidden from the global Pipeline selector).
-- Reuses the existing pipeline engine; adds two FK columns + backfill.
-- Idempotent: skips lists that already have a pipeline_id set.

BEGIN;

-- ─── 1. Schema additions ───────────────────────────────────────────────────

ALTER TABLE lead_lists
  ADD COLUMN IF NOT EXISTS pipeline_id UUID REFERENCES pipelines(id) ON DELETE SET NULL;

ALTER TABLE pipelines
  ADD COLUMN IF NOT EXISTS list_id UUID REFERENCES lead_lists(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_pipelines_list_id ON pipelines(list_id);
CREATE INDEX IF NOT EXISTS idx_lead_lists_pipeline_id ON lead_lists(pipeline_id);

-- ─── 2. Logging: before counts ─────────────────────────────────────────────

DO $$
DECLARE
  v_list_count   INT;
  v_lead_count   INT;
BEGIN
  SELECT COUNT(*) INTO v_list_count FROM lead_lists;
  SELECT COUNT(*) INTO v_lead_count FROM leads WHERE list_id IS NOT NULL AND deleted_at IS NULL;
  RAISE NOTICE '088 BEFORE: % lead_lists, % leads with list_id', v_list_count, v_lead_count;
END$$;

-- ─── 3. Create one pipeline per list (idempotent — skips already-set rows) ─

DO $$
DECLARE
  r              RECORD;
  v_pipeline_id  UUID;
  v_slug         TEXT;
  v_pos          INT;
  v_lists_done   INT := 0;
  v_stages_done  INT := 0;
  v_cnt          INT;
  v_admizz       UUID;
BEGIN
  -- Resolve Admizz tenant once; stays NULL if not found → falls through to generic.
  SELECT id INTO v_admizz FROM tenants WHERE slug = 'admizz' LIMIT 1;

  FOR r IN
    SELECT id, name, slug, tenant_id
    FROM   lead_lists
    WHERE  pipeline_id IS NULL
    ORDER  BY tenant_id, sort_order
  LOOP
    -- build a slug that won't collide with existing pipeline slugs
    v_slug := regexp_replace(lower(r.slug || '-pipeline'), '[^a-z0-9]+', '-', 'g');
    v_slug := trim(both '-' from v_slug);

    -- get next position for this tenant
    SELECT COALESCE(MAX(position), -1) + 1
    INTO   v_pos
    FROM   pipelines
    WHERE  tenant_id = r.tenant_id;

    -- create the list-bound pipeline
    INSERT INTO pipelines (tenant_id, name, slug, position, is_default, is_active, list_id)
    VALUES (r.tenant_id, r.name, v_slug, v_pos, false, true, r.id)
    RETURNING id INTO v_pipeline_id;

    -- ── Seed stages: custom sets for Admizz funnel lists, generic for everything else ──

    IF v_admizz IS NOT NULL AND r.tenant_id = v_admizz AND r.slug = 'pre-qualified' THEN
      -- 5 stages; default = New Lead
      INSERT INTO pipeline_stages (tenant_id, pipeline_id, name, slug, position, color, is_default, is_terminal, terminal_type)
      VALUES
        (r.tenant_id, v_pipeline_id, 'New Lead',      'new-lead',      0, '#3b82f6', true,  false, NULL),
        (r.tenant_id, v_pipeline_id, 'Attempted',     'attempted',     1, '#a855f7', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Connected',     'connected',     2, '#f59e0b', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Qualified',     'qualified',     3, '#06b6d4', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Not Qualified', 'not-qualified', 4, '#ef4444', false, false, NULL);

    ELSIF v_admizz IS NOT NULL AND r.tenant_id = v_admizz AND r.slug = 'qualified' THEN
      -- 6 stages; default = New Lead
      INSERT INTO pipeline_stages (tenant_id, pipeline_id, name, slug, position, color, is_default, is_terminal, terminal_type)
      VALUES
        (r.tenant_id, v_pipeline_id, 'New Lead',       'new-lead',      0, '#3b82f6', true,  false, NULL),
        (r.tenant_id, v_pipeline_id, 'Qualified',      'qualified',     1, '#a855f7', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Not Connected',  'not-connected', 2, '#ef4444', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Prospect Ready', 'prospect-ready',3, '#f59e0b', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Class Ready',    'class-ready',   4, '#06b6d4', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Dropped',        'dropped',       5, '#ef4444', false, false, NULL);

    ELSIF v_admizz IS NOT NULL AND r.tenant_id = v_admizz AND r.slug = 'prospects' THEN
      -- 8 stages; default = Prospect Ready
      INSERT INTO pipeline_stages (tenant_id, pipeline_id, name, slug, position, color, is_default, is_terminal, terminal_type)
      VALUES
        (r.tenant_id, v_pipeline_id, 'Prospect Ready',       'prospect-ready',       0, '#3b82f6', true,  false, NULL),
        (r.tenant_id, v_pipeline_id, 'Class Ready',          'class-ready',          1, '#a855f7', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Not Connected',        'not-connected',        2, '#ef4444', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'In Person Counseling', 'in-person-counseling', 3, '#f59e0b', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Virtual Counseling',   'virtual-counseling',   4, '#06b6d4', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Application Ready',    'application-ready',    5, '#3b82f6', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Needs More Time',      'needs-more-time',      6, '#f59e0b', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Not Eligible/Dropped', 'not-eligible-dropped', 7, '#ef4444', false, false, NULL);

    ELSIF v_admizz IS NOT NULL AND r.tenant_id = v_admizz AND r.slug = 'applications' THEN
      -- 17 stages; default = Application Ready
      -- "Acceptance" typo from client spec corrected to "Acceptance Confirmed"
      INSERT INTO pipeline_stages (tenant_id, pipeline_id, name, slug, position, color, is_default, is_terminal, terminal_type)
      VALUES
        (r.tenant_id, v_pipeline_id, 'Application Ready',      'application-ready',      0,  '#3b82f6', true,  false, NULL),
        (r.tenant_id, v_pipeline_id, 'Application Started',    'application-started',    1,  '#a855f7', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Arranging Documents',    'arranging-documents',    2,  '#f59e0b', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Application Submitted',  'application-submitted',  3,  '#06b6d4', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Conditional Received',   'conditional-received',   4,  '#3b82f6', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Initial Fee Paid',       'initial-fee-paid',       5,  '#a855f7', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Interview Prep',         'interview-prep',         6,  '#f59e0b', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Unconditional Received', 'unconditional-received', 7,  '#06b6d4', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Financial Preparation',  'financial-preparation',  8,  '#3b82f6', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Tuition Fee Paid',       'tuition-fee-paid',       9,  '#a855f7', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Acceptance Confirmed',   'acceptance-confirmed',   10, '#f59e0b', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Visa Date Booked',       'visa-date-booked',       11, '#06b6d4', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Visa/Admission Granted', 'visa-admission-granted', 12, '#3b82f6', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Travel Booked',          'travel-booked',          13, '#a855f7', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Enrollment Done',        'enrollment-done',        14, '#22c55e', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Rejected/Declined',      'rejected-declined',      15, '#ef4444', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Dropped',                'dropped',                16, '#dc2626', false, false, NULL);

    ELSE
      -- Generic set for all other tenants / lists
      INSERT INTO pipeline_stages (tenant_id, pipeline_id, name, slug, position, color, is_default, is_terminal, terminal_type)
      VALUES
        (r.tenant_id, v_pipeline_id, 'New',       'new',       0, '#3b82f6', true,  false, NULL),
        (r.tenant_id, v_pipeline_id, 'Contacted', 'contacted', 1, '#a855f7', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Follow-up', 'follow-up', 2, '#f59e0b', false, false, NULL),
        (r.tenant_id, v_pipeline_id, 'Done',      'done',      3, '#22c55e', false, false, NULL);
    END IF;

    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_stages_done := v_stages_done + v_cnt;

    -- link list back to its pipeline
    UPDATE lead_lists SET pipeline_id = v_pipeline_id WHERE id = r.id;

    v_lists_done := v_lists_done + 1;
  END LOOP;

  RAISE NOTICE '088 BACKFILL: created % pipelines, % stages', v_lists_done, v_stages_done;
END$$;

-- ─── 4. Backfill leads: point each lead at its list's pipeline + default stage ─

DO $$
DECLARE
  v_leads_done INT;
BEGIN
  UPDATE leads l
  SET
    pipeline_id = lp.pipeline_id,
    stage_id    = ps.id,
    status      = ps.slug
  FROM lead_lists lp
  JOIN pipeline_stages ps
    ON ps.pipeline_id = lp.pipeline_id
   AND ps.is_default  = true
  WHERE l.list_id     = lp.id
    AND l.deleted_at  IS NULL
    AND lp.pipeline_id IS NOT NULL;

  GET DIAGNOSTICS v_leads_done = ROW_COUNT;
  RAISE NOTICE '088 BACKFILL: updated % leads with list-scoped pipeline+stage', v_leads_done;
END$$;

-- ─── 5. Logging: after counts ──────────────────────────────────────────────

DO $$
DECLARE
  v_pipelines_created  INT;
  v_leads_backfilled   INT;
BEGIN
  SELECT COUNT(*) INTO v_pipelines_created FROM pipelines WHERE list_id IS NOT NULL;
  SELECT COUNT(*) INTO v_leads_backfilled  FROM leads WHERE pipeline_id IN (SELECT id FROM pipelines WHERE list_id IS NOT NULL) AND deleted_at IS NULL;
  RAISE NOTICE '088 AFTER: % list-pipelines, % leads on list-pipeline', v_pipelines_created, v_leads_backfilled;
END$$;

COMMIT;
