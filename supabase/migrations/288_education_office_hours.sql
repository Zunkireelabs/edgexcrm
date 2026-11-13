-- Migration 288: EDGEX-109 P3a — office hours as a tenant setting, one working-time clock, and the live process driving the product.
-- ROLLBACK: DROP FUNCTION IF EXISTS public.education_home_impact(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN);
--           then restore education_home_impact(5 args) by re-running its CREATE OR REPLACE from 284_education_home_contact.sql,
--           and education_process_metrics() by re-running its CREATE OR REPLACE from 287_education_process_changes.sql;
--           DROP FUNCTION IF EXISTS public.education_working_deadline(UUID, TIMESTAMPTZ, INT), public.education_working_deadline_oh(JSONB, TEXT, TIMESTAMPTZ, INT),
--             public.education_in_office_hours(JSONB, TEXT, TIMESTAMPTZ), public.education_office_hours(UUID), public.education_office_hours_evidence(UUID);
--           DROP TABLE IF EXISTS public.tenant_office_hours;  (and delete this file's row from schema_migrations)
--
-- WHY (real Admizz data, 90 days of calls and notes): Sun 1,533 · Mon 1,264 · Tue 1,613 · Wed 1,513 · Thu 1,548 · Fri 801 · Sat 11. The team
-- works Sunday to Friday, 9:30-17:30 or so. The 287 clock (9-18 EVERY day) counted the Saturday leads as late.
--
-- 1. tenant_office_hours: one row per tenant. days smallint[] (0 = Sunday ... 6 = Saturday, non-empty), start_min / end_min = minutes after
--    midnight in the TENANT's timezone (tenants.timezone). RLS like 286/287: tenant members read, only the service role writes.
-- 2. education_office_hours_evidence(tenant): { by_weekday[7] (Sunday first), by_hour[24], total, window_days } over the last 90 days of
--    lead_activities (call, meeting) + human lead_notes, in the tenant's timezone. EMAILS ARE EXCLUDED: one Admizz day holds 2,966 bulk
--    emails at 08:00 that say nothing about when people work.
-- 3. education_office_hours(tenant): { days, start_min, end_min, source: 'saved' | 'learned', events }. The saved row, else LEARNED: a weekday
--    works when it has >= 10% of the busiest weekday's events; fewer than 200 events in total -> all 7 days. Start and end STAY 9:00-18:00
--    when learned (the hour counts are evidence for the owner to read, not a rule). TS twin: processes/lib/working-hours.ts learnOfficeHours.
-- 4. education_in_office_hours(oh, tz, at) and education_working_deadline_oh(oh, tz, at, minutes): the PURE clock (no table reads), so a caller
--    with many rows reads the office hours once. The clock starts at `at` if it falls inside office hours on a working day (start <= time < end),
--    else at the next opening; minutes are added in working time, rolling over closing time into the next working day. Wall-clock arithmetic in the
--    tenant's tz. TS twin: processes/lib/working-hours.ts workingDeadline; the shared fixture table is processes/lib/working-hours.fixtures.ts.
--    education_working_deadline(tenant, at, minutes) is the convenience wrapper that looks up the tenant's tz and office hours.
-- 5. education_process_metrics(): same signature, same keys. within_1wh now uses education_working_deadline_oh(..., 60); `outside_office_hours`
--    uses the real days + hours; `office_hours` becomes { days, start, end, start_min, end_min, source } (start/end stay hour numbers).
-- 6. education_home_impact() gains p_working BOOLEAN DEFAULT FALSE. When true, "contacted within the hour" = before the working deadline.
--    The 5-argument function is DROPPED first: a second overload with a default would make named-argument RPC calls ambiguous.
--
-- PARITY CHECK (the lead runs this on a database; expected values are in lib/working-hours.fixtures.ts):
--   SELECT public.education_working_deadline_oh('{"days":[0,1,2,3,4,5],"start_min":540,"end_min":1080}'::jsonb, 'Asia/Kathmandu',
--          '2026-11-07T14:25:00Z'::timestamptz, 60);   -- expect 2026-11-08 04:15:00+00
--
-- Additive only (1 table, 0 rows; 5 new functions; 2 replaced). No existing row touched.
--   Applied: NOT YET (written 2026-11-08).

BEGIN;

CREATE TABLE IF NOT EXISTS public.tenant_office_hours (
  tenant_id   UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  days        SMALLINT[] NOT NULL,
  start_min   INT NOT NULL,
  end_min     INT NOT NULL,
  updated_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenant_office_hours_days_chk  CHECK (cardinality(days) >= 1 AND days <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::SMALLINT[]),
  CONSTRAINT tenant_office_hours_hours_chk CHECK (start_min >= 0 AND start_min < end_min AND end_min <= 1440)
);

-- RLS like 286/287: readable by tenant members, every write is server-only (service role).
ALTER TABLE public.tenant_office_hours ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_office_hours_select" ON public.tenant_office_hours;
CREATE POLICY "tenant_office_hours_select" ON public.tenant_office_hours FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
DROP POLICY IF EXISTS "tenant_office_hours_service_all" ON public.tenant_office_hours;
CREATE POLICY "tenant_office_hours_service_all" ON public.tenant_office_hours FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.education_office_hours_evidence(p_tenant UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH tz AS (
    SELECT COALESCE((SELECT timezone FROM tenants WHERE id = p_tenant), 'UTC') AS name
  ),
  ev AS (
    SELECT (a.created_at AT TIME ZONE (SELECT name FROM tz)) AS at_local
    FROM lead_activities a
    WHERE a.tenant_id = p_tenant AND a.activity_type IN ('call', 'meeting') AND a.created_at >= now() - INTERVAL '90 days'
    UNION ALL
    SELECT (n.created_at AT TIME ZONE (SELECT name FROM tz))
    FROM lead_notes n
    JOIN leads l ON l.id = n.lead_id AND l.tenant_id = p_tenant
    WHERE n.ai_tool_call_id IS NULL AND n.created_at >= now() - INTERVAL '90 days'
  )
  SELECT jsonb_build_object(
    'by_weekday', (
      SELECT jsonb_agg(COALESCE(c.n, 0) ORDER BY g.d)
      FROM generate_series(0, 6) AS g(d)
      LEFT JOIN (SELECT EXTRACT(DOW FROM at_local)::INT AS k, count(*) AS n FROM ev GROUP BY 1) c ON c.k = g.d
    ),
    'by_hour', (
      SELECT jsonb_agg(COALESCE(c.n, 0) ORDER BY g.h)
      FROM generate_series(0, 23) AS g(h)
      LEFT JOIN (SELECT EXTRACT(HOUR FROM at_local)::INT AS k, count(*) AS n FROM ev GROUP BY 1) c ON c.k = g.h
    ),
    'total', (SELECT count(*) FROM ev),
    'window_days', 90
  );
$$;

CREATE OR REPLACE FUNCTION public.education_office_hours(p_tenant UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row   public.tenant_office_hours%ROWTYPE;
  v_ev    JSONB;
  v_total INT;
  v_max   INT;
  v_days  JSONB;
BEGIN
  SELECT * INTO v_row FROM public.tenant_office_hours WHERE tenant_id = p_tenant;
  IF FOUND THEN
    RETURN jsonb_build_object('days', to_jsonb(v_row.days), 'start_min', v_row.start_min, 'end_min', v_row.end_min, 'source', 'saved');
  END IF;

  v_ev := public.education_office_hours_evidence(p_tenant);
  v_total := (v_ev ->> 'total')::INT;
  IF v_total < 200 THEN
    -- Too little to learn from: today's behaviour (every day, 9-18).
    RETURN jsonb_build_object('days', '[0,1,2,3,4,5,6]'::JSONB, 'start_min', 540, 'end_min', 1080, 'source', 'learned', 'events', v_total);
  END IF;

  SELECT max(x::INT) INTO v_max FROM jsonb_array_elements_text(v_ev -> 'by_weekday') AS x;
  SELECT jsonb_agg((t.ord - 1)::INT ORDER BY t.ord) INTO v_days
  FROM jsonb_array_elements_text(v_ev -> 'by_weekday') WITH ORDINALITY AS t(n, ord)
  WHERE t.n::INT >= 0.1 * v_max;

  RETURN jsonb_build_object('days', v_days, 'start_min', 540, 'end_min', 1080, 'source', 'learned', 'events', v_total);
END $$;

CREATE OR REPLACE FUNCTION public.education_in_office_hours(p_oh JSONB, p_tz TEXT, p_at TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE STRICT SET search_path = public AS $$
DECLARE
  v_local TIMESTAMP := p_at AT TIME ZONE p_tz;
  v_mins  NUMERIC := EXTRACT(EPOCH FROM (v_local - date_trunc('day', v_local))) / 60.0;
BEGIN
  RETURN (p_oh -> 'days') @> to_jsonb(EXTRACT(DOW FROM v_local)::INT)
     AND v_mins >= (p_oh ->> 'start_min')::INT
     AND v_mins <  (p_oh ->> 'end_min')::INT;
END $$;

CREATE OR REPLACE FUNCTION public.education_working_deadline_oh(p_oh JSONB, p_tz TEXT, p_at TIMESTAMPTZ, p_minutes INT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql STABLE STRICT SET search_path = public AS $$
DECLARE
  v_days  INT[];
  v_start INT := (p_oh ->> 'start_min')::INT;
  v_end   INT := (p_oh ->> 'end_min')::INT;
  v_cur   TIMESTAMP := p_at AT TIME ZONE p_tz;   -- the tenant's wall clock
  v_day   TIMESTAMP;
  v_mins  NUMERIC;
  v_avail NUMERIC;
  v_rem   NUMERIC := p_minutes;
  v_dow   INT;
  v_working BOOLEAN;
BEGIN
  SELECT array_agg(x::INT) INTO v_days FROM jsonb_array_elements_text(p_oh -> 'days') AS x;
  IF v_days IS NULL OR cardinality(v_days) = 0 THEN
    RETURN p_at + make_interval(mins => p_minutes);
  END IF;
  FOR i IN 1..400 LOOP
    v_day := date_trunc('day', v_cur);
    v_mins := EXTRACT(EPOCH FROM (v_cur - v_day)) / 60.0;
    v_dow := EXTRACT(DOW FROM v_cur)::INT;
    v_working := v_dow = ANY (v_days);
    IF v_working AND v_mins >= v_start AND v_mins < v_end THEN
      v_avail := v_end - v_mins;
      IF v_rem <= v_avail THEN
        RETURN (v_cur + make_interval(secs => (v_rem * 60)::DOUBLE PRECISION)) AT TIME ZONE p_tz;
      END IF;
      v_rem := v_rem - v_avail;
      v_cur := v_day + INTERVAL '1 day';
    ELSIF v_working AND v_mins < v_start THEN
      v_cur := v_day + make_interval(mins => v_start);
    ELSE
      v_cur := v_day + INTERVAL '1 day';
    END IF;
  END LOOP;
  RETURN p_at + make_interval(mins => p_minutes);
END $$;

CREATE OR REPLACE FUNCTION public.education_working_deadline(p_tenant UUID, p_at TIMESTAMPTZ, p_minutes INT)
RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.education_working_deadline_oh(
    public.education_office_hours(p_tenant),
    COALESCE((SELECT timezone FROM tenants WHERE id = p_tenant), 'UTC'),
    p_at, p_minutes
  );
$$;

-- education_process_metrics(): replaced (same signature). Differences from 287: office hours come from education_office_hours(), the working
-- deadline from education_working_deadline_oh(), and `office_hours` / `outside_office_hours` use the real days and hours.
CREATE OR REPLACE FUNCTION public.education_process_metrics(
  p_tenant UUID, p_key TEXT, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tz TEXT
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_oh   JSONB;      -- the tenant's office hours (education_office_hours), read ONCE per call
  v_out JSONB;
BEGIN
  v_oh := public.education_office_hours(p_tenant);
  IF p_key = 'new_lead_first_call' THEN
    WITH qual AS (
      SELECT sort_order AS qsort FROM lead_lists WHERE tenant_id = p_tenant AND slug = 'qualified' LIMIT 1
    ),
    -- The cohort: leads that ARRIVED in the window. Not deleted, not a walk-in (tags other/parent).
    c AS (
      SELECT l.id, l.created_at, l.assigned_to, l.assigned_at, l.intake_medium, l.list_id
      FROM leads l
      WHERE l.tenant_id = p_tenant AND l.deleted_at IS NULL
        AND l.created_at >= p_from AND l.created_at < p_to
        AND NOT (COALESCE(l.tags, ARRAY[]::TEXT[]) && ARRAY['other', 'parent']::TEXT[])
    ),
    own AS (
      -- First assignment time = earliest of leads.assigned_at and the first audit row whose changes carry assigned_to.
      -- A lead that is assigned but has neither (created already assigned) counts as assigned at created_at -> wait 0.
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
      -- First CONTACT at/after created_at: lead_activities row OR human lead_notes row (ai_tool_call_id IS NULL). Migration 284.
      -- `wdeadline` = created_at + 60 WORKING minutes on the tenant's office hours (migration 288, education_working_deadline_oh):
      -- the clock starts at created_at if it falls inside office hours on a working day, else at the next opening.
      SELECT c.id,
             public.education_working_deadline_oh(v_oh, p_tz, c.created_at, 60) AS wdeadline,
             (SELECT min(t) FROM (
                SELECT min(a.created_at) AS t FROM lead_activities a WHERE a.tenant_id = p_tenant AND a.lead_id = c.id AND a.created_at >= c.created_at
                UNION ALL
                SELECT min(n.created_at) FROM lead_notes n WHERE n.lead_id = c.id AND n.ai_tool_call_id IS NULL AND n.created_at >= c.created_at
              ) x) AS at,
             c.created_at
      FROM c
    ),
    -- Call-backs: the EXACT definition of education_home_impact() (migration 284), over the same window, whole tenant (no branch).
    booked AS (
      SELECT a.lead_id, a.created_at AS booked_at,
             a.created_at + make_interval(mins => COALESCE((t.config -> 'team_performance_thresholds' ->> 'callback_reminder_minutes')::INT, 10)) AS due_at
      FROM lead_activities a
      JOIN tenants t ON t.id = a.tenant_id
      JOIN leads l ON l.id = a.lead_id AND l.deleted_at IS NULL
      WHERE a.tenant_id = p_tenant AND a.activity_type = 'call' AND a.call_outcome IN ('no_answer', 'busy')
      UNION ALL
      SELECT g.entity_id, g.created_at, (g.changes -> 'callback_due_at' ->> 'new')::TIMESTAMPTZ
      FROM audit_logs g
      JOIN leads l ON l.id = g.entity_id AND l.deleted_at IS NULL
      WHERE g.tenant_id = p_tenant AND g.entity_type = 'lead' AND g.action = 'lead.updated'
        AND g.changes ? 'callback_due_at' AND (g.changes -> 'callback_due_at' ->> 'new') IS NOT NULL
    ),
    cb AS (
      SELECT b.lead_id,
             (
               EXISTS (
                 SELECT 1 FROM lead_activities a2
                 WHERE a2.tenant_id = p_tenant AND a2.lead_id = b.lead_id
                   AND a2.created_at > b.booked_at
                   AND a2.created_at < ((date_trunc('day', b.due_at AT TIME ZONE p_tz) + INTERVAL '1 day') AT TIME ZONE p_tz)
               )
               OR EXISTS (
                 SELECT 1 FROM lead_notes n2
                 WHERE n2.lead_id = b.lead_id AND n2.ai_tool_call_id IS NULL
                   AND n2.created_at > b.booked_at
                   AND n2.created_at < ((date_trunc('day', b.due_at AT TIME ZONE p_tz) + INTERVAL '1 day') AT TIME ZONE p_tz)
               )
             ) AS ok
      FROM booked b
      WHERE b.due_at >= p_from AND b.due_at < p_to AND b.due_at < now()
    )
    SELECT jsonb_build_object(
      'arrived', (SELECT count(*) FROM c),
      'by_source', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('medium', m, 'n', n) ORDER BY n DESC, m NULLS FIRST)
        FROM (SELECT intake_medium AS m, count(*) AS n FROM c GROUP BY intake_medium) s
      ), '[]'::JSONB),
      'outside_office_hours', (
        SELECT count(*) FROM c WHERE NOT public.education_in_office_hours(v_oh, p_tz, c.created_at)
      ),
      'office_hours', jsonb_build_object(
        'days', v_oh -> 'days', 'start', (v_oh ->> 'start_min')::INT / 60.0, 'end', (v_oh ->> 'end_min')::INT / 60.0,
        'start_min', (v_oh ->> 'start_min')::INT, 'end_min', (v_oh ->> 'end_min')::INT, 'source', v_oh ->> 'source'
      ),
      'owner_assigned', (SELECT count(*) FROM own WHERE wait_min IS NOT NULL),
      'owner_within_5min', (SELECT count(*) FROM own WHERE wait_min IS NOT NULL AND wait_min <= 5),
      'owner_wait_median_min', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY wait_min))::NUMERIC, 1) FROM own WHERE wait_min IS NOT NULL),
      'owner_wait_p75_min', (SELECT round((percentile_cont(0.75) WITHIN GROUP (ORDER BY wait_min))::NUMERIC, 1) FROM own WHERE wait_min IS NOT NULL),
      'contacted', (SELECT count(*) FROM fc WHERE at IS NOT NULL),
      'within_1h', (SELECT count(*) FROM fc WHERE at IS NOT NULL AND at <= created_at + INTERVAL '60 minutes'),
      'within_1wh', (SELECT count(*) FROM fc WHERE at IS NOT NULL AND at <= wdeadline),
      'first_contact_median_min', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (at - created_at)) / 60.0))::NUMERIC, 1) FROM fc WHERE at IS NOT NULL),
      'never', (SELECT count(*) FROM fc WHERE at IS NULL),
      'callbacks_booked', (SELECT count(*) FROM cb),
      'callbacks_kept', (SELECT count(*) FILTER (WHERE ok) FROM cb),
      'reached_qualified', (
        SELECT count(*) FROM c
        JOIN lead_lists ll ON ll.id = c.list_id
        JOIN qual ON TRUE
        WHERE NOT ll.is_archive AND ll.sort_order >= qual.qsort
      ),
      'drops_with_reason', NULL,
      'reason_field_missing', TRUE
    ) INTO v_out;

  ELSIF p_key = 'visa_to_enrolled' THEN
    -- "Workable" minus its terminal clause: not deleted / archived / on hold / walk-in, in an active (non-archive, non-staging) list.
    WITH b AS (
      SELECT l.id, ll.slug AS list_slug,
             education_lead_terminal(p_tenant, l.pipeline_id, l.status) AS term
      FROM leads l
      LEFT JOIN lead_lists ll ON ll.id = l.list_id
      WHERE l.tenant_id = p_tenant AND l.deleted_at IS NULL AND l.archived_at IS NULL AND COALESCE(l.on_hold, false) = false
        AND (l.list_id IS NULL OR (NOT ll.is_archive AND NOT COALESCE(ll.is_staging, false)))
        AND NOT (COALESCE(l.tags, ARRAY[]::TEXT[]) && ARRAY['other', 'parent']::TEXT[])
    )
    SELECT jsonb_build_object(
      'won_not_enrolled', (SELECT count(*) FROM b WHERE term = 'won' AND list_slug IS DISTINCT FROM 'enrolled'),
      'moved_to_enrolled', (SELECT count(*) FROM b WHERE term = 'won' AND list_slug = 'enrolled')
    ) INTO v_out;

  ELSIF p_key = 'dropping_a_student' THEN
    WITH b AS (
      SELECT l.id, education_lead_terminal(p_tenant, l.pipeline_id, l.status) AS term
      FROM leads l
      LEFT JOIN lead_lists ll ON ll.id = l.list_id
      WHERE l.tenant_id = p_tenant AND l.deleted_at IS NULL AND l.archived_at IS NULL AND COALESCE(l.on_hold, false) = false
        AND (l.list_id IS NULL OR (NOT ll.is_archive AND NOT COALESCE(ll.is_staging, false)))
        AND NOT (COALESCE(l.tags, ARRAY[]::TEXT[]) && ARRAY['other', 'parent']::TEXT[])
    )
    SELECT jsonb_build_object(
      'dropped', (SELECT count(*) FROM b WHERE term = 'lost'),
      'with_reason', NULL,
      'reason_field_missing', TRUE
    ) INTO v_out;

  ELSIF p_key = 'leaver_handover' THEN
    WITH held AS (
      SELECT l.id, l.assigned_to,
             (l.archived_at IS NULL AND COALESCE(l.on_hold, false) = false
              AND (l.list_id IS NULL OR (NOT ll.is_archive AND NOT COALESCE(ll.is_staging, false)))
              AND education_lead_terminal(p_tenant, l.pipeline_id, l.status) IS NULL) AS workable
      FROM leads l
      LEFT JOIN lead_lists ll ON ll.id = l.list_id
      WHERE l.tenant_id = p_tenant AND l.deleted_at IS NULL AND l.assigned_to IS NOT NULL
        AND NOT (COALESCE(l.tags, ARRAY[]::TEXT[]) && ARRAY['other', 'parent']::TEXT[])
        AND NOT EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = p_tenant AND tu.user_id = l.assigned_to)
    )
    SELECT jsonb_build_object(
      'leavers_holding', (SELECT count(DISTINCT assigned_to) FROM held),
      'live_leads_held', (SELECT count(*) FROM held WHERE workable),
      'all_leads_held', (SELECT count(*) FROM held)
    ) INTO v_out;

  ELSE
    RAISE EXCEPTION 'education_process_metrics: unknown process key %', p_key USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN v_out;
END $$;

-- education_home_impact(): the 5-argument function goes first (see header), then the 6-argument one with p_working.
DROP FUNCTION IF EXISTS public.education_home_impact(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT);

CREATE OR REPLACE FUNCTION public.education_home_impact(
  p_tenant UUID, p_branch UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tz TEXT, p_working BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH oh AS (
    -- Office hours are read only when the caller asks for the working clock (the learned branch scans 90 days of events).
    SELECT CASE WHEN p_working THEN public.education_office_hours(p_tenant) END AS j
  ),
  recv AS (
    SELECT l.id, COALESCE(l.assigned_at, l.created_at) AS at,
           -- "within the hour": clock time (p_working false, today's behaviour) or 60 office minutes (migration 288).
           CASE WHEN p_working
                THEN public.education_working_deadline_oh((SELECT j FROM oh), p_tz, COALESCE(l.assigned_at, l.created_at), 60)
                ELSE COALESCE(l.assigned_at, l.created_at) + INTERVAL '60 minutes'
           END AS dl
    FROM leads l
    WHERE l.tenant_id = p_tenant AND l.deleted_at IS NULL
      AND (p_branch IS NULL OR l.branch_id = p_branch)
      AND COALESCE(l.assigned_at, l.created_at) >= p_from AND COALESCE(l.assigned_at, l.created_at) < p_to
  ),
  fh AS (
    SELECT r.id,
           (
             EXISTS (
               SELECT 1 FROM lead_activities a
               WHERE a.tenant_id = p_tenant AND a.lead_id = r.id
                 AND a.created_at >= r.at AND a.created_at <= r.dl
             )
             OR EXISTS (
               SELECT 1 FROM lead_notes n
               WHERE n.lead_id = r.id AND n.ai_tool_call_id IS NULL
                 AND n.created_at >= r.at AND n.created_at <= r.dl
             )
           ) AS ok
    FROM recv r
  ),
  booked AS (
    SELECT a.lead_id, a.created_at AS booked_at,
           a.created_at + make_interval(mins => COALESCE((t.config -> 'team_performance_thresholds' ->> 'callback_reminder_minutes')::INT, 10)) AS due_at
    FROM lead_activities a
    JOIN tenants t ON t.id = a.tenant_id
    JOIN leads l ON l.id = a.lead_id AND l.deleted_at IS NULL AND (p_branch IS NULL OR l.branch_id = p_branch)
    WHERE a.tenant_id = p_tenant AND a.activity_type = 'call' AND a.call_outcome IN ('no_answer', 'busy')
    UNION ALL
    SELECT g.entity_id, g.created_at, (g.changes -> 'callback_due_at' ->> 'new')::TIMESTAMPTZ
    FROM audit_logs g
    JOIN leads l ON l.id = g.entity_id AND l.deleted_at IS NULL AND (p_branch IS NULL OR l.branch_id = p_branch)
    WHERE g.tenant_id = p_tenant AND g.entity_type = 'lead' AND g.action = 'lead.updated'
      AND g.changes ? 'callback_due_at' AND (g.changes -> 'callback_due_at' ->> 'new') IS NOT NULL
  ),
  cb AS (
    SELECT b.lead_id, b.booked_at, b.due_at,
           (
             EXISTS (
               SELECT 1 FROM lead_activities a2
               WHERE a2.tenant_id = p_tenant AND a2.lead_id = b.lead_id
                 AND a2.created_at > b.booked_at
                 AND a2.created_at < ((date_trunc('day', b.due_at AT TIME ZONE p_tz) + INTERVAL '1 day') AT TIME ZONE p_tz)
             )
             OR EXISTS (
               SELECT 1 FROM lead_notes n2
               WHERE n2.lead_id = b.lead_id AND n2.ai_tool_call_id IS NULL
                 AND n2.created_at > b.booked_at
                 AND n2.created_at < ((date_trunc('day', b.due_at AT TIME ZONE p_tz) + INTERVAL '1 day') AT TIME ZONE p_tz)
             )
           ) AS ok
    FROM booked b
    WHERE b.due_at >= p_from AND b.due_at < p_to AND b.due_at < now()
  ),
  dl AS (
    SELECT (a.applied_date IS NOT NULL OR s.terminal_type IS NOT NULL OR (sub.pos IS NOT NULL AND s.position >= sub.pos)) AS submitted,
           (a.applied_date IS NOT NULL OR s.terminal_type IS NOT NULL OR sub.pos IS NOT NULL) AS known
    FROM applications a
    JOIN application_stages s ON s.id = a.stage_id
    JOIN leads l ON l.id = a.lead_id AND (p_branch IS NULL OR l.branch_id = p_branch)
    LEFT JOIN LATERAL (
      SELECT st.position AS pos FROM application_stages st
      WHERE st.tenant_id = a.tenant_id AND st.is_submit_stage AND st.pipeline_id IS NOT DISTINCT FROM s.pipeline_id
      LIMIT 1
    ) sub ON TRUE
    WHERE a.tenant_id = p_tenant AND a.deleted_at IS NULL AND a.application_deadline IS NOT NULL
      AND a.application_deadline >= (p_from AT TIME ZONE p_tz)::DATE
      AND a.application_deadline < LEAST((p_to AT TIME ZONE p_tz)::DATE, (now() AT TIME ZONE p_tz)::DATE)
  )
  SELECT jsonb_build_object(
    'first_hour', jsonb_build_object('called', (SELECT count(*) FILTER (WHERE ok) FROM fh), 'total', (SELECT count(*) FROM fh)),
    'callbacks',  jsonb_build_object('done',   (SELECT count(*) FILTER (WHERE ok) FROM cb), 'total', (SELECT count(*) FROM cb)),
    'deadlines',  jsonb_build_object('missed', (SELECT count(*) FILTER (WHERE known AND NOT submitted) FROM dl), 'total', (SELECT count(*) FILTER (WHERE known) FROM dl))
  );
$$;


REVOKE ALL ON FUNCTION public.education_office_hours_evidence(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.education_office_hours_evidence(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.education_office_hours(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.education_office_hours(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.education_in_office_hours(JSONB, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.education_in_office_hours(JSONB, TEXT, TIMESTAMPTZ) TO service_role;
REVOKE ALL ON FUNCTION public.education_working_deadline_oh(JSONB, TEXT, TIMESTAMPTZ, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.education_working_deadline_oh(JSONB, TEXT, TIMESTAMPTZ, INT) TO service_role;
REVOKE ALL ON FUNCTION public.education_working_deadline(UUID, TIMESTAMPTZ, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.education_working_deadline(UUID, TIMESTAMPTZ, INT) TO service_role;
REVOKE ALL ON FUNCTION public.education_process_metrics(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.education_process_metrics(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.education_home_impact(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.education_home_impact(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN) TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('288_education_office_hours.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
