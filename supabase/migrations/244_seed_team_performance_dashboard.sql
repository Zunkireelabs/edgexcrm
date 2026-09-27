-- Migration 244: Seed the "Team & Lead Performance" Insights dashboard for
-- education_consultancy tenants. Owner/admin-only via granted_position_ids: '{}'
-- (empty grant list + isAdmin bypass, same as every other seeded dashboard).
--
--   Expected before/after row counts: dashboards +N (one per education_consultancy
--     tenant lacking a dashboard of this name).
--   Rollback: DELETE FROM dashboards WHERE name = 'Team & Lead Performance';
--   Applied: stage <YYYY-MM-DD> / prod HELD.

BEGIN;

INSERT INTO dashboards (tenant_id, name, description, widgets, granted_position_ids, sort_order)
SELECT
  t.id,
  'Team & Lead Performance',
  'Where the relay line is stuck, who is holding it, and where leads are being lost',
  '["edu-intake-alarm","edu-team-relay","edu-leakage-funnel","edu-branch-breakdown","edu-coverage-meter"]'::jsonb,
  '{}',
  1
FROM tenants t
WHERE t.industry_id = 'education_consultancy'
  AND NOT EXISTS (
    SELECT 1 FROM dashboards d WHERE d.tenant_id = t.id AND d.name = 'Team & Lead Performance'
  );

INSERT INTO public.schema_migrations (version) VALUES ('244_seed_team_performance_dashboard.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
