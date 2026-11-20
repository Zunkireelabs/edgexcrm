-- Migration 288: EDGEX-109 P2a — Processes: suggested changes, review/reject, and the "1 working hour" metric.
-- ROLLBACK: DROP INDEX IF EXISTS public.uniq_process_versions_one_draft;
--           ALTER TABLE public.process_versions DROP COLUMN IF EXISTS rejected_reason, DROP COLUMN IF EXISTS rejected_by, DROP COLUMN IF EXISTS rejected_at;
--           DROP TABLE IF EXISTS public.process_changes;
--           and restore education_process_metrics() by re-running its CREATE OR REPLACE from 287_education_processes.sql
--           (and delete this file's row from schema_migrations)
--
-- 1. process_changes: a draft is a list of CHANGES, one row each (one author per change, edits audited, the same rows serve Orca in P4).
--    part = trigger | step:<stepKey> | done | exceptions ; field = target | wording | who. `before` is the live value when suggested,
--    `after` the proposed one, `taken` the reviewer's tick, `status` open -> taken | not_taken once the draft is approved.
--    FK NAMING: this table points at BOTH processes and process_versions, and processes/process_versions already have two FKs between
--    them. Every PostgREST embed must name its FK (PGRST201). The app reads this table with plain queries, no embeds.
-- 2. process_versions: rejected_reason / rejected_by / rejected_at, and ONE open draft per process (partial unique index).
-- 3. education_process_metrics(): same signature; new_lead_first_call gains `within_1wh` = leads whose first contact is <= 60 minutes
--    after the WORKING clock start (see the fc CTE). Every other key in the JSON is unchanged.
--
-- Additive only. Before/after counts: 1 new table (0 rows), 3 new nullable columns, 1 index, 1 function replaced; no existing row touched.
--   Applied: NOT YET (written 2026-11-07).

BEGIN;

-- A pre-existing second draft would make the unique index fail with an opaque error; say why instead.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.process_versions WHERE status = 'draft' GROUP BY process_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'migration 288: a process has more than one draft version; reject or approve the extras first';
  END IF;
END $$;

ALTER TABLE public.process_versions
  ADD COLUMN IF NOT EXISTS rejected_reason TEXT,
  ADD COLUMN IF NOT EXISTS rejected_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_at     TIMESTAMPTZ;

-- One open draft per process: a new suggestion adds a change to it.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_process_versions_one_draft ON public.process_versions (process_id) WHERE status = 'draft';

CREATE TABLE IF NOT EXISTS public.process_changes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  process_id      UUID NOT NULL REFERENCES public.processes(id) ON DELETE CASCADE,
  version_id      UUID NOT NULL REFERENCES public.process_versions(id) ON DELETE CASCADE,
  part            TEXT NOT NULL CHECK (part IN ('trigger', 'done', 'exceptions') OR part LIKE 'step:%'),
  field           TEXT NOT NULL CHECK (field IN ('target', 'wording', 'who')),
  before          JSONB,
  after           JSONB NOT NULL,
  why             TEXT NOT NULL CHECK (length(btrim(why)) > 0),
  evidence        JSONB NOT NULL DEFAULT '[]'::JSONB,
  author_kind     TEXT NOT NULL CHECK (author_kind IN ('person', 'agent')),
  author_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'taken', 'not_taken')),
  taken           BOOLEAN NOT NULL DEFAULT TRUE,
  edited_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  edited_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_process_changes_version ON public.process_changes (version_id);
CREATE INDEX IF NOT EXISTS idx_process_changes_tenant_process ON public.process_changes (tenant_id, process_id, created_at DESC);

-- RLS like 287: readable by tenant members, every write is server-only (service role).
ALTER TABLE public.process_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "process_changes_select" ON public.process_changes;
CREATE POLICY "process_changes_select" ON public.process_changes FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
DROP POLICY IF EXISTS "process_changes_service_all" ON public.process_changes;
CREATE POLICY "process_changes_service_all" ON public.process_changes FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.education_process_metrics(
  p_tenant UUID, p_key TEXT, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tz TEXT
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_office_start CONSTANT INT := 9;   -- default office hours 09:00-18:00 until a tenant setting exists
  v_office_end   CONSTANT INT := 18;
  v_out JSONB;
BEGIN
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
      -- First CONTACT at/after created_at: lead_activities row OR human lead_notes row (ai_tool_call_id IS NULL). Migration 285.
      -- `wstart` = the WORKING clock start (migration 288): created_at when it falls inside office hours (tenant tz), else the next
      -- 09:00 (same day if before 09:00, next day if at/after 18:00). EVERY day counts as a working day (no weekend rule yet).
      SELECT c.id,
             ((CASE
                 WHEN EXTRACT(HOUR FROM (c.created_at AT TIME ZONE p_tz)) < v_office_start
                   THEN date_trunc('day', c.created_at AT TIME ZONE p_tz) + make_interval(hours => v_office_start)
                 WHEN EXTRACT(HOUR FROM (c.created_at AT TIME ZONE p_tz)) >= v_office_end
                   THEN date_trunc('day', c.created_at AT TIME ZONE p_tz) + INTERVAL '1 day' + make_interval(hours => v_office_start)
                 ELSE c.created_at AT TIME ZONE p_tz
               END) AT TIME ZONE p_tz) AS wstart,
             (SELECT min(t) FROM (
                SELECT min(a.created_at) AS t FROM lead_activities a WHERE a.tenant_id = p_tenant AND a.lead_id = c.id AND a.created_at >= c.created_at
                UNION ALL
                SELECT min(n.created_at) FROM lead_notes n WHERE n.lead_id = c.id AND n.ai_tool_call_id IS NULL AND n.created_at >= c.created_at
              ) x) AS at,
             c.created_at
      FROM c
    ),
    -- Call-backs: the EXACT definition of education_home_impact() (migration 285), over the same window, whole tenant (no branch).
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
        SELECT count(*) FROM c
        WHERE EXTRACT(HOUR FROM (c.created_at AT TIME ZONE p_tz)) < v_office_start
           OR EXTRACT(HOUR FROM (c.created_at AT TIME ZONE p_tz)) >= v_office_end
      ),
      'office_hours', jsonb_build_object('start', v_office_start, 'end', v_office_end),
      'owner_assigned', (SELECT count(*) FROM own WHERE wait_min IS NOT NULL),
      'owner_within_5min', (SELECT count(*) FROM own WHERE wait_min IS NOT NULL AND wait_min <= 5),
      'owner_wait_median_min', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY wait_min))::NUMERIC, 1) FROM own WHERE wait_min IS NOT NULL),
      'owner_wait_p75_min', (SELECT round((percentile_cont(0.75) WITHIN GROUP (ORDER BY wait_min))::NUMERIC, 1) FROM own WHERE wait_min IS NOT NULL),
      'contacted', (SELECT count(*) FROM fc WHERE at IS NOT NULL),
      'within_1h', (SELECT count(*) FROM fc WHERE at IS NOT NULL AND at <= created_at + INTERVAL '60 minutes'),
      'within_1wh', (SELECT count(*) FROM fc WHERE at IS NOT NULL AND at <= wstart + INTERVAL '60 minutes'),
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

REVOKE ALL ON FUNCTION public.education_process_metrics(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.education_process_metrics(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('288_education_process_changes.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
