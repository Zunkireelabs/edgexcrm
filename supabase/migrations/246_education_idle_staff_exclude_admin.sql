-- Migration 246: education_idle_staff — exclude owner/admin from the alarm.
-- education_idle_staff (migration 242) iterated every tenant_users row with no
-- role filter — an owner/admin who doesn't personally log calls would see
-- themselves flagged under "No CRM Activity" every time they open their own
-- dashboard. CREATE OR REPLACE on the same signature; 242 itself is left
-- untouched (additive-only per this repo's migration rules) — its header
-- comment now points here for the role exclusion.
--
--   Expected before/after row counts: 0 rows touched (function definition only).
--   Rollback: re-apply 242's original body (drop the `tu.role NOT IN (...)` clause).
--   Applied: stage <YYYY-MM-DD> / prod HELD.

BEGIN;

CREATE OR REPLACE FUNCTION education_idle_staff(p_tenant UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (user_id UUID, user_email TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tu.user_id, u.email
  FROM tenant_users tu
  JOIN auth.users u ON u.id = tu.user_id
  WHERE tu.tenant_id = p_tenant
    AND tu.role NOT IN ('owner', 'admin')
    AND NOT EXISTS (
      SELECT 1 FROM lead_activities la
      WHERE la.tenant_id = p_tenant
        AND la.user_id = tu.user_id
        AND la.activity_type IN ('call', 'email', 'meeting')
        AND la.created_at BETWEEN p_from AND p_to
    )
    AND NOT EXISTS (
      SELECT 1 FROM lead_notes ln
      JOIN leads l ON l.id = ln.lead_id
      WHERE l.tenant_id = p_tenant
        AND ln.user_id = tu.user_id
        AND ln.created_at BETWEEN p_from AND p_to
    );
$$;

GRANT EXECUTE ON FUNCTION education_idle_staff(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('246_education_idle_staff_exclude_admin.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
