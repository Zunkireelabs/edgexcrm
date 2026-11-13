-- Migration 284: EDGEX-87 A2b — "contact" includes notes in education_home_impact().
-- ROLLBACK: re-run the CREATE OR REPLACE FUNCTION public.education_home_impact(...) from migration 283 (calls-only
--           first_hour, activity-only callbacks). No table or column changes, so nothing else to undo.
--
-- Staff log contact as NOTES (real Admizz data, last 21 days: 913 lead_notes vs 133 call activities), so counting only
-- calls made "contacted within 1 hour" read 2 of 75 instead of 26 of 75. The ONE definition of "contact" (also used by
-- the Home rules via leads.last_touched_at, and required of A3's smart assignment): a lead_activities row (call / email /
-- meeting) OR a human lead_notes row (ai_tool_call_id IS NULL, as Pulse counts notes). TS twin: home/lib/contact.ts.
--   first_hour  now: the first activity OR note within 60 minutes of coalesce(assigned_at, created_at).
--   callbacks   now: "done" = any activity OR note after the booking and before the end of the due day (tenant-local).
-- Booked call-backs, deadlines and the return shape are unchanged.
--
-- Additive: replaces one function body. Before/after counts: 0 rows touched.
--   Applied: stage <date> / prod HELD.

BEGIN;

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
           (
             EXISTS (
               SELECT 1 FROM lead_activities a
               WHERE a.tenant_id = p_tenant AND a.lead_id = r.id
                 AND a.created_at >= r.at AND a.created_at <= r.at + INTERVAL '60 minutes'
             )
             OR EXISTS (
               SELECT 1 FROM lead_notes n
               WHERE n.lead_id = r.id AND n.ai_tool_call_id IS NULL
                 AND n.created_at >= r.at AND n.created_at <= r.at + INTERVAL '60 minutes'
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

REVOKE ALL ON FUNCTION public.education_home_impact(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.education_home_impact(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('284_education_home_contact.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
