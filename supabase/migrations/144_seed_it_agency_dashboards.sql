-- Migration 143: Seed a default "Overview" dashboard for it_agency tenants
--
-- Additive only. Promotes the education Insights → Dashboards engine to it_agency
-- (industry-agnostic since mig 048); this seeds each existing it_agency tenant with
-- a default Overview dashboard of the lead/deal widgets that already apply.
--   Renumbered from 138 -> 143 (2026-07-12): 138 collided with an unmerged education
--   branch's 138_partner_college_country.sql already applied to stage; the stray
--   138_seed_it_agency_dashboards.sql ledger row was deleted and this file re-applied
--   under 143 (idempotent WHERE NOT EXISTS — no re-seed, just the self-record).
--   Expected before/after row counts: dashboards (it_agency tenants): 0 -> +1 per
--   it_agency tenant with no existing dashboards (stage: zunkireelabs-crm + mobilise -> 2 inserted).
--   Rollback: DELETE FROM dashboards WHERE tenant_id IN (SELECT id FROM tenants WHERE industry_id = 'it_agency') AND name = 'Overview' AND description = 'Default overview dashboard';
--   Applied: stage 2026-07-12 / prod HELD.

BEGIN;

INSERT INTO dashboards (tenant_id, name, description, widgets, granted_position_ids, sort_order)
SELECT t.id, 'Overview', 'Default overview dashboard',
       '["stats","leads-by-stage","leads-by-source"]'::jsonb, '{}', 0
FROM tenants t
WHERE t.industry_id = 'it_agency'
  AND NOT EXISTS (SELECT 1 FROM dashboards d WHERE d.tenant_id = t.id);

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('144_seed_it_agency_dashboards.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
