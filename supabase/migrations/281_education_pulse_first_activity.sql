-- Migration 281: Pulse — per-person first activity, for coverage-aware "usual" (EDGEX-82).
--
-- Additive only: one read-only SECURITY DEFINER function, no table or data change.
--   Expected before/after row counts: 0 rows touched.
--   Rollback: DROP FUNCTION IF EXISTS education_pulse_first_activity(UUID);
--   Applied: stage HELD / prod HELD (rides the deploy pipelines; depends on 280).
--
-- A person's "usual" may only average windows their data covers. Join dates lie (staff whose legacy activity was
-- imported have accounts created AFTER their first activity), so the app takes the EARLIEST of this value and
-- tenant_users.created_at. One index probe per member per source (user_id indexes exist), all in ONE call.

BEGIN;

CREATE OR REPLACE FUNCTION education_pulse_first_activity(p_tenant UUID)
RETURNS TABLE (user_id UUID, first_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tu.user_id,
         LEAST(
           (SELECT x.created_at FROM lead_activities x WHERE x.tenant_id = p_tenant AND x.user_id = tu.user_id ORDER BY x.created_at ASC LIMIT 1),
           (SELECT n.created_at FROM lead_notes n JOIN leads l ON l.id = n.lead_id AND l.tenant_id = p_tenant WHERE n.user_id = tu.user_id ORDER BY n.created_at ASC LIMIT 1),
           (SELECT a.created_at FROM audit_logs a WHERE a.tenant_id = p_tenant AND a.user_id = tu.user_id ORDER BY a.created_at ASC LIMIT 1)
         ) AS first_at
  FROM tenant_users tu
  WHERE tu.tenant_id = p_tenant;
$$;

REVOKE ALL ON FUNCTION education_pulse_first_activity(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION education_pulse_first_activity(UUID) TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('281_education_pulse_first_activity.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
