-- Migration 284: EDGEX-87 A2 — education Home for owners / managers ("Needs you", Nudge, "Is the new Home helping?").
-- ROLLBACK: DROP FUNCTION IF EXISTS public.education_home_impact(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT);
--           DROP TABLE IF EXISTS public.lead_nudges; DROP TABLE IF EXISTS public.home_settings;
--           (and delete this file's row from schema_migrations)
--
-- 1. home_settings: one row per tenant. `home_launched_at` is the date the new Home went live; "Is the new Home
--    helping?" compares the 3 weeks after it with the 4 weeks before it. Empty = measuring has not started.
-- 2. lead_nudges: "Nudge <name>" records who nudged whom about which leads. The next day, if the same leads are still
--    untouched (no touch since `created_at`), the manager's item returns as "Nudged yesterday, still N". Resolved when
--    every lead has been touched (lazily stamped by the loader).
-- 3. education_home_impact(): the three numbers behind "Is the new Home helping?" for ONE period, tenant-wide or for
--    one branch. Called twice (before / after). SQL because it spans a tenant's leads / calls / applications.
--      first_hour  leads received in the period (coalesce(assigned_at, created_at)) that got a call (any user) within
--                  60 minutes of that moment.
--      callbacks   call-backs booked with their due time inside the period, that got any touch (call / email / meeting)
--                  after the booking and before the end of the due day (tenant-local). A booking is either
--                  (a) a no-answer / busy call (the migration-250 trigger sets callback_due_at = created_at +
--                  callback_reminder_minutes, default 10; it leaves no audit row, so this is the only way to see
--                  the baseline), or (b) a hand-booked call-back from the lead patch (audit_logs 'lead.updated' with
--                  changes.callback_due_at.new; only exists after A1).
--      deadlines   applications whose deadline fell in the period and has passed: `missed` = not submitted. Submitted =
--                  applied_date set, OR terminal stage, OR stage at / after the pipeline's submit stage
--                  (application_stages.is_submit_stage, migration 283). A pipeline with no submit stage is "unknown"
--                  and counted in neither number (never a false alarm).
--
-- Additive only. Before/after counts: home_settings (new) 0 rows, lead_nudges (new) 0 rows, 1 new function.
--   Applied: stage <date> / prod HELD.

BEGIN;

CREATE TABLE IF NOT EXISTS public.home_settings (
  tenant_id         UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  home_launched_at  TIMESTAMPTZ,
  updated_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.home_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "home_settings_select" ON public.home_settings;
CREATE POLICY "home_settings_select" ON public.home_settings
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
DROP POLICY IF EXISTS "home_settings_service_all" ON public.home_settings;
CREATE POLICY "home_settings_service_all" ON public.home_settings
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.lead_nudges (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_ids     UUID[] NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lead_nudges_open ON public.lead_nudges (tenant_id, from_user_id) WHERE resolved_at IS NULL;

ALTER TABLE public.lead_nudges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lead_nudges_select_involved" ON public.lead_nudges;
CREATE POLICY "lead_nudges_select_involved" ON public.lead_nudges
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()) AND (from_user_id = auth.uid() OR to_user_id = auth.uid()));
DROP POLICY IF EXISTS "lead_nudges_service_all" ON public.lead_nudges;
CREATE POLICY "lead_nudges_service_all" ON public.lead_nudges
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.education_home_impact(
  p_tenant UUID, p_branch UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tz TEXT
)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH recv AS (
    SELECT l.id, COALESCE(l.assigned_at, l.created_at) AS at
    FROM leads l
    WHERE l.tenant_id = p_tenant AND l.deleted_at IS NULL
      AND (p_branch IS NULL OR l.branch_id = p_branch)
      AND COALESCE(l.assigned_at, l.created_at) >= p_from AND COALESCE(l.assigned_at, l.created_at) < p_to
  ),
  fh AS (
    SELECT r.id,
           EXISTS (
             SELECT 1 FROM lead_activities a
             WHERE a.tenant_id = p_tenant AND a.lead_id = r.id AND a.activity_type = 'call'
               AND a.created_at >= r.at AND a.created_at <= r.at + INTERVAL '60 minutes'
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
           EXISTS (
             SELECT 1 FROM lead_activities a2
             WHERE a2.tenant_id = p_tenant AND a2.lead_id = b.lead_id AND a2.activity_type IN ('call', 'email', 'meeting')
               AND a2.created_at > b.booked_at
               AND a2.created_at < ((date_trunc('day', b.due_at AT TIME ZONE p_tz) + INTERVAL '1 day') AT TIME ZONE p_tz)
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

REVOKE ALL ON FUNCTION public.education_home_impact(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.education_home_impact(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('284_education_home_a2.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
