-- Migration 290: EDGEX-109 P4a — Orca, the process improver: the fixed menu of SQL cuts it may read, and two badge columns on a change.
-- ROLLBACK: DROP FUNCTION IF EXISTS public.education_process_breakdown(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT);
--           ALTER TABLE public.process_changes DROP CONSTRAINT IF EXISTS process_changes_needs_check, DROP CONSTRAINT IF EXISTS process_changes_turns_on_check;
--           ALTER TABLE public.process_changes DROP COLUMN IF EXISTS needs, DROP COLUMN IF EXISTS turns_on;
--           (and delete this file's row from schema_migrations)
--
-- WHY: the Process Improver agent may only quote numbers that exact code computed. `education_process_metrics()` gives the headline
-- numbers; this function gives the CUTS of those same numbers that explain them (by weekday, inside vs outside office hours, by arrival
-- hour band, by branch, by the owner's position, wait percentiles, intake leftovers). It is a FIXED menu: p_cut must be one of the names
-- below, anything else raises. No free SQL ever reaches the database from the model.
--
-- 1. education_process_breakdown(p_tenant, p_key, p_cut, p_from, p_to, p_tz) -> JSONB { cut, groups: [ {key, label, n, ...} ], ... }.
--    Reuses the definitions of education_process_metrics() (migration 289): the same cohort (leads that ARRIVED in the window, not
--    deleted, not a walk-in), the same first-owner time, the same first CONTACT (activity or human note), the same working-hour deadline.
--    It returns COUNTS, MINUTES AND IDS OF LISTS/BRANCHES/POSITIONS ONLY: never a lead id, a name, a phone number or a message.
--    new_lead_first_call cuts: by_weekday | office_split | by_hour_band | by_branch | by_owner_position | wait_percentiles | intake_leftovers
--    visa_to_enrolled / dropping_a_student cuts: by_branch.   leaver_handover: none.
--    A group row carries: n (leads in it), called_1h, called_1wh, never (no contact yet), contact_p50/p75/p90 (minutes from arrival to
--    first contact), wait_p50/p75/p90 (minutes from arrival to first owner). Weekday keys are 0 = Sunday ... 6 = Saturday, tenant tz.
-- 2. process_changes.needs / turns_on: two nullable badge columns. `needs` = a change that depends on a feature that is not built yet
--    (a FIXED list). `turns_on` = the Settings switch the owner clicks AFTER approving (approving never flips a setting by itself).
--
-- Additive only. Before/after counts: 1 new function, 2 new nullable columns on process_changes (existing rows keep NULL), no row touched.
--   Applied: NOT YET (written 2026-11-08).

BEGIN;

ALTER TABLE public.process_changes
  ADD COLUMN IF NOT EXISTS needs    TEXT,
  ADD COLUMN IF NOT EXISTS turns_on TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_changes_needs_check') THEN
    ALTER TABLE public.process_changes
      ADD CONSTRAINT process_changes_needs_check CHECK (needs IS NULL OR needs IN ('EDGEX-104', 'EDGEX-105', 'EDGEX-107', 'EDGEX-108'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_changes_turns_on_check') THEN
    ALTER TABLE public.process_changes
      ADD CONSTRAINT process_changes_turns_on_check CHECK (turns_on IS NULL OR turns_on IN ('smart_assignment_auto'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.education_process_breakdown(
  p_tenant UUID, p_key TEXT, p_cut TEXT, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tz TEXT
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_oh  JSONB;
  v_out JSONB;
BEGIN
  IF p_key = 'new_lead_first_call' THEN
    IF p_cut NOT IN ('by_weekday', 'office_split', 'by_hour_band', 'by_branch', 'by_owner_position', 'wait_percentiles', 'intake_leftovers') THEN
      RAISE EXCEPTION 'education_process_breakdown: unknown cut % for %', p_cut, p_key USING ERRCODE = 'invalid_parameter_value';
    END IF;
  ELSIF p_key IN ('visa_to_enrolled', 'dropping_a_student') THEN
    IF p_cut <> 'by_branch' THEN
      RAISE EXCEPTION 'education_process_breakdown: unknown cut % for %', p_cut, p_key USING ERRCODE = 'invalid_parameter_value';
    END IF;
  ELSE
    RAISE EXCEPTION 'education_process_breakdown: no cuts for process %', p_key USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_oh := public.education_office_hours(p_tenant);

  IF p_key = 'new_lead_first_call' AND p_cut = 'intake_leftovers' THEN
    -- Current state (the window does not apply): unassigned, still-workable leads in a non-archive intake list, by how long they have waited.
    WITH u AS (
      SELECT l.id, l.created_at,
             CASE
               WHEN now() - l.created_at < INTERVAL '1 day'  THEN 1
               WHEN now() - l.created_at < INTERVAL '3 days' THEN 2
               WHEN now() - l.created_at < INTERVAL '7 days' THEN 3
               ELSE 4
             END AS band
      FROM leads l
      JOIN lead_lists ll ON ll.id = l.list_id
      WHERE l.tenant_id = p_tenant AND ll.is_intake AND NOT ll.is_archive
        AND l.assigned_to IS NULL AND l.deleted_at IS NULL AND l.archived_at IS NULL AND COALESCE(l.on_hold, false) = false
        AND NOT (COALESCE(l.tags, ARRAY[]::TEXT[]) && ARRAY['other', 'parent']::TEXT[])
        AND public.education_lead_terminal(p_tenant, l.pipeline_id, l.status) IS NULL
    )
    SELECT jsonb_build_object(
      'cut', p_cut,
      'list_ids', COALESCE((SELECT jsonb_agg(id ORDER BY sort_order) FROM lead_lists WHERE tenant_id = p_tenant AND is_intake AND NOT is_archive), '[]'::JSONB),
      'total', (SELECT count(*) FROM u),
      'oldest_days', (SELECT floor(EXTRACT(EPOCH FROM (now() - min(created_at))) / 86400.0)::INT FROM u),
      'groups', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('key', band::TEXT, 'n', n) ORDER BY band)
        FROM (SELECT band, count(*) AS n FROM u GROUP BY band) s
      ), '[]'::JSONB)
    ) INTO v_out;
    RETURN v_out;
  END IF;

  IF p_key = 'new_lead_first_call' THEN
    WITH c AS (
      SELECT l.id, l.created_at, l.assigned_to, l.assigned_at, l.branch_id
      FROM leads l
      WHERE l.tenant_id = p_tenant AND l.deleted_at IS NULL
        AND l.created_at >= p_from AND l.created_at < p_to
        AND NOT (COALESCE(l.tags, ARRAY[]::TEXT[]) && ARRAY['other', 'parent']::TEXT[])
    ),
    own AS (
      SELECT c.id,
             CASE
               WHEN fa.at IS NOT NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (fa.at - c.created_at)) / 60.0)
               WHEN c.assigned_to IS NOT NULL THEN 0
               ELSE NULL
             END AS wait_min
      FROM c
      LEFT JOIN LATERAL (
        SELECT LEAST(c.assigned_at, (
          SELECT min(g.created_at) FROM audit_logs g
          WHERE g.tenant_id = p_tenant AND g.entity_type = 'lead' AND g.entity_id = c.id AND g.changes ? 'assigned_to'
        )) AS at
      ) fa ON TRUE
    ),
    fc AS (
      SELECT c.id,
             public.education_working_deadline_oh(v_oh, p_tz, c.created_at, 60) AS wdeadline,
             (SELECT min(t) FROM (
                SELECT min(a.created_at) AS t FROM lead_activities a WHERE a.tenant_id = p_tenant AND a.lead_id = c.id AND a.created_at >= c.created_at
                UNION ALL
                SELECT min(n.created_at) FROM lead_notes n WHERE n.lead_id = c.id AND n.ai_tool_call_id IS NULL AND n.created_at >= c.created_at
              ) x) AS at
      FROM c
    ),
    x AS (
      SELECT c.id,
             EXTRACT(DOW FROM (c.created_at AT TIME ZONE p_tz))::INT  AS dow,
             EXTRACT(HOUR FROM (c.created_at AT TIME ZONE p_tz))::INT AS hr,
             public.education_in_office_hours(v_oh, p_tz, c.created_at) AS in_oh,
             c.branch_id,
             pp.slug AS pos_slug,
             c.assigned_to,
             own.wait_min,
             fc.at AS contact_at,
             CASE WHEN fc.at IS NOT NULL THEN EXTRACT(EPOCH FROM (fc.at - c.created_at)) / 60.0 END AS contact_min,
             (fc.at IS NOT NULL AND fc.at <= c.created_at + INTERVAL '60 minutes') AS w1h,
             (fc.at IS NOT NULL AND fc.at <= fc.wdeadline) AS w1wh
      FROM c
      JOIN own ON own.id = c.id
      JOIN fc  ON fc.id = c.id
      LEFT JOIN tenant_users tu ON tu.tenant_id = p_tenant AND tu.user_id = c.assigned_to
      LEFT JOIN positions pp ON pp.id = tu.position_id
    ),
    g AS (
      SELECT x.*,
             CASE p_cut
               WHEN 'by_weekday'        THEN x.dow::TEXT
               WHEN 'office_split'      THEN CASE WHEN x.in_oh THEN 'inside' ELSE 'outside' END
               WHEN 'by_hour_band'      THEN CASE WHEN x.hr < 6 THEN '00-06' WHEN x.hr < 9 THEN '06-09' WHEN x.hr < 12 THEN '09-12'
                                                  WHEN x.hr < 15 THEN '12-15' WHEN x.hr < 18 THEN '15-18' ELSE '18-24' END
               WHEN 'by_branch'         THEN COALESCE(x.branch_id::TEXT, 'none')
               WHEN 'by_owner_position' THEN COALESCE(x.pos_slug, CASE WHEN x.assigned_to IS NULL THEN 'unassigned' ELSE 'no-position' END)
               ELSE 'all'
             END AS gkey
      FROM x
    )
    SELECT jsonb_build_object(
      'cut', p_cut,
      'groups', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'key', s.gkey, 'label', s.glabel, 'n', s.n, 'called_1h', s.called_1h, 'called_1wh', s.called_1wh, 'never', s.never,
          'contact_p50', s.contact_p50, 'contact_p75', s.contact_p75, 'contact_p90', s.contact_p90,
          'wait_p50', s.wait_p50, 'wait_p75', s.wait_p75, 'wait_p90', s.wait_p90
        ) ORDER BY s.gkey)
        FROM (
          SELECT g.gkey,
                 CASE WHEN p_cut = 'by_branch' THEN max(b.name) ELSE NULL END AS glabel,
                 count(*) AS n,
                 count(*) FILTER (WHERE g.w1h) AS called_1h,
                 count(*) FILTER (WHERE g.w1wh) AS called_1wh,
                 count(*) FILTER (WHERE g.contact_at IS NULL) AS never,
                 round((percentile_cont(0.5)  WITHIN GROUP (ORDER BY g.contact_min))::NUMERIC, 1) AS contact_p50,
                 round((percentile_cont(0.75) WITHIN GROUP (ORDER BY g.contact_min))::NUMERIC, 1) AS contact_p75,
                 round((percentile_cont(0.9)  WITHIN GROUP (ORDER BY g.contact_min))::NUMERIC, 1) AS contact_p90,
                 round((percentile_cont(0.5)  WITHIN GROUP (ORDER BY g.wait_min))::NUMERIC, 1) AS wait_p50,
                 round((percentile_cont(0.75) WITHIN GROUP (ORDER BY g.wait_min))::NUMERIC, 1) AS wait_p75,
                 round((percentile_cont(0.9)  WITHIN GROUP (ORDER BY g.wait_min))::NUMERIC, 1) AS wait_p90
          FROM g
          LEFT JOIN branches b ON b.id = g.branch_id AND b.tenant_id = p_tenant
          GROUP BY g.gkey
        ) s
      ), '[]'::JSONB),
      'office_hours', jsonb_build_object('days', v_oh -> 'days', 'start_min', (v_oh ->> 'start_min')::INT, 'end_min', (v_oh ->> 'end_min')::INT)
    ) INTO v_out;
    RETURN v_out;
  END IF;

  -- visa_to_enrolled / dropping_a_student: by_branch over the same current-state set as education_process_metrics().
  WITH b AS (
    SELECT l.id, l.branch_id, ll.slug AS list_slug,
           public.education_lead_terminal(p_tenant, l.pipeline_id, l.status) AS term
    FROM leads l
    LEFT JOIN lead_lists ll ON ll.id = l.list_id
    WHERE l.tenant_id = p_tenant AND l.deleted_at IS NULL AND l.archived_at IS NULL AND COALESCE(l.on_hold, false) = false
      AND (l.list_id IS NULL OR (NOT ll.is_archive AND NOT COALESCE(ll.is_staging, false)))
      AND NOT (COALESCE(l.tags, ARRAY[]::TEXT[]) && ARRAY['other', 'parent']::TEXT[])
  )
  SELECT jsonb_build_object(
    'cut', p_cut,
    'groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'key', s.gkey, 'label', s.glabel,
        'won_not_enrolled', s.won_not_enrolled, 'moved_to_enrolled', s.moved_to_enrolled, 'dropped', s.dropped
      ) ORDER BY s.gkey)
      FROM (
        SELECT COALESCE(b.branch_id::TEXT, 'none') AS gkey, max(br.name) AS glabel,
               count(*) FILTER (WHERE b.term = 'won' AND b.list_slug IS DISTINCT FROM 'enrolled') AS won_not_enrolled,
               count(*) FILTER (WHERE b.term = 'won' AND b.list_slug = 'enrolled') AS moved_to_enrolled,
               count(*) FILTER (WHERE b.term = 'lost') AS dropped
        FROM b
        LEFT JOIN branches br ON br.id = b.branch_id AND br.tenant_id = p_tenant
        WHERE b.term IN ('won', 'lost')
        GROUP BY COALESCE(b.branch_id::TEXT, 'none')
      ) s
    ), '[]'::JSONB)
  ) INTO v_out;
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.education_process_breakdown(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.education_process_breakdown(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('290_education_process_improver.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
