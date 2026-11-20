-- Migration 287: EDGEX-109 P1 — Processes: records, immutable versions, nightly metric snapshots, and the metrics SQL.
-- ROLLBACK: DROP FUNCTION IF EXISTS public.education_process_metrics(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT);
--           DROP FUNCTION IF EXISTS public.education_lead_terminal(UUID, UUID, TEXT);
--           DROP TABLE IF EXISTS public.process_metric_snapshots; ALTER TABLE public.processes DROP CONSTRAINT IF EXISTS processes_live_version_fk;
--           DROP TABLE IF EXISTS public.process_versions; DROP TABLE IF EXISTS public.processes;
--           DROP FUNCTION IF EXISTS public.process_versions_guard_spec();
--           (and delete this file's row from schema_migrations)
--
-- 1. processes: one row per (tenant, key). Keys: new_lead_first_call | visa_to_enrolled | dropping_a_student | leaver_handover.
--    live_version_id points at the version that is live now (NULL until the owner approves one).
-- 2. process_versions: the body (`spec`, Zod-validated in the app) of each version. A version whose status is live or retired can
--    NEVER have its spec edited: a trigger raises, so a bug or a hand-run UPDATE cannot rewrite history. At most one live version
--    per process (partial unique index). draft -> live is the approval; live -> retired when a newer one goes live.
-- 3. process_metric_snapshots: one row per process per day (nightly job), the metrics JSON as of that night, for trends and
--    before -> after.
-- 4. education_process_metrics(p_tenant, p_key, p_from, p_to, p_tz): the deterministic numbers behind each process, one function,
--    JSONB out. Reuses Home's definitions: a WORKABLE lead (home/lib/workable.ts) and CONTACT = activity or human note (migration 285,
--    home/lib/contact.ts). Walk-ins (tags other / parent) and deleted leads never count.
--    Window: p_from/p_to apply to the "new lead" cohort (created in the window) and to call-backs (due in the window). The other three
--    processes are current-state counts and ignore the window.
--
-- Additive only. Before/after counts: 3 new tables (0 rows), 2 new functions, no existing row touched.
--   Applied: stage <date> / prod HELD.

BEGIN;

CREATE TABLE IF NOT EXISTS public.processes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  key              TEXT NOT NULL CHECK (key IN ('new_lead_first_call', 'visa_to_enrolled', 'dropping_a_student', 'leaver_handover')),
  name             TEXT NOT NULL,
  owner_user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  live_version_id  UUID,
  review_due_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT processes_tenant_key_unique UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS public.process_versions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  process_id       UUID NOT NULL REFERENCES public.processes(id) ON DELETE CASCADE,
  version          INT NOT NULL CHECK (version >= 1),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'retired', 'rejected')),
  spec             JSONB NOT NULL,
  source           TEXT NOT NULL CHECK (source IN ('system', 'person', 'agent')),
  proposed_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  change_summary   TEXT,
  evidence         JSONB NOT NULL DEFAULT '{}'::JSONB,
  approved_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT process_versions_process_version_unique UNIQUE (process_id, version)
);

-- processes.live_version_id -> process_versions (added after both tables exist; the two reference each other).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'processes_live_version_fk') THEN
    ALTER TABLE public.processes
      ADD CONSTRAINT processes_live_version_fk FOREIGN KEY (live_version_id) REFERENCES public.process_versions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- At most one live version per process.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_process_versions_one_live ON public.process_versions (process_id) WHERE status = 'live';
CREATE INDEX IF NOT EXISTS idx_process_versions_tenant_process ON public.process_versions (tenant_id, process_id, version DESC);

-- Immutability: the spec of a live or retired version can never change. (Status moves draft -> live -> retired are allowed.)
CREATE OR REPLACE FUNCTION public.process_versions_guard_spec()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('live', 'retired') AND NEW.spec IS DISTINCT FROM OLD.spec THEN
    RAISE EXCEPTION 'process_versions: the spec of a % version is immutable (version %)', OLD.status, OLD.version
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_process_versions_guard_spec ON public.process_versions;
CREATE TRIGGER trg_process_versions_guard_spec
  BEFORE UPDATE ON public.process_versions
  FOR EACH ROW EXECUTE FUNCTION public.process_versions_guard_spec();

CREATE TABLE IF NOT EXISTS public.process_metric_snapshots (
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  process_id  UUID NOT NULL REFERENCES public.processes(id) ON DELETE CASCADE,
  version_id  UUID REFERENCES public.process_versions(id) ON DELETE SET NULL,
  day         DATE NOT NULL,
  metrics     JSONB NOT NULL,
  PRIMARY KEY (process_id, day)
);
CREATE INDEX IF NOT EXISTS idx_process_metric_snapshots_tenant_day ON public.process_metric_snapshots (tenant_id, day DESC);

-- RLS: readable by tenant members (get_user_tenant_ids); every write is server-only (service role). The pages are owner/admin and read
-- through the service client, so no embed reads these tables as `authenticated` (no migration-195 GRANT needed).
ALTER TABLE public.processes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "processes_select" ON public.processes;
CREATE POLICY "processes_select" ON public.processes FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
DROP POLICY IF EXISTS "processes_service_all" ON public.processes;
CREATE POLICY "processes_service_all" ON public.processes FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

ALTER TABLE public.process_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "process_versions_select" ON public.process_versions;
CREATE POLICY "process_versions_select" ON public.process_versions FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
DROP POLICY IF EXISTS "process_versions_service_all" ON public.process_versions;
CREATE POLICY "process_versions_service_all" ON public.process_versions FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

ALTER TABLE public.process_metric_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "process_metric_snapshots_select" ON public.process_metric_snapshots;
CREATE POLICY "process_metric_snapshots_select" ON public.process_metric_snapshots FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
DROP POLICY IF EXISTS "process_metric_snapshots_service_all" ON public.process_metric_snapshots;
CREATE POLICY "process_metric_snapshots_service_all" ON public.process_metric_snapshots FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Is this lead's status terminal for ITS pipeline? Returns the stage's terminal_type ('won' | 'lost'), 'other' when terminal with no type,
-- NULL when open. Same rule as home/lib/workable.ts: a slug that is terminal in EVERY pipeline that has it is terminal for any lead
-- (including a lead with no pipeline); a slug terminal in only some pipelines is terminal only for those pipelines.
CREATE OR REPLACE FUNCTION public.education_lead_terminal(p_tenant UUID, p_pipeline UUID, p_status TEXT)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_status IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.tenant_id = p_tenant AND ps.slug = p_status AND ps.is_terminal
                   AND ps.pipeline_id IS NOT DISTINCT FROM p_pipeline)
      OR (EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.tenant_id = p_tenant AND ps.slug = p_status AND ps.is_terminal)
          AND NOT EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.tenant_id = p_tenant AND ps.slug = p_status AND NOT ps.is_terminal))
    THEN COALESCE(
      (SELECT ps.terminal_type FROM pipeline_stages ps
        WHERE ps.tenant_id = p_tenant AND ps.slug = p_status AND ps.is_terminal AND ps.terminal_type IS NOT NULL
        ORDER BY (ps.pipeline_id IS NOT DISTINCT FROM p_pipeline) DESC LIMIT 1),
      'other')
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.education_lead_terminal(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.education_lead_terminal(UUID, UUID, TEXT) TO service_role;

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
      SELECT c.id,
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

INSERT INTO public.schema_migrations (version) VALUES ('287_education_processes.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
