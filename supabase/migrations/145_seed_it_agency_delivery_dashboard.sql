-- Migration 144: Seed a default "Delivery" dashboard for it_agency tenants
--
-- Additive only. Phase 2 added 10 self-fetching delivery widgets; this seeds one
-- shared "Delivery" dashboard so every it_agency tenant gets the delivery cockpit
-- out of the box (the my-* widgets are per-viewer, so one shared dashboard shows
-- each user their own data). Companion to 143 (which seeds "Overview").
--   144 chosen: 138-142 held by an unmerged education branch on the stage ledger,
--   143 is this feature's Overview seed.
--   Expected before/after row counts: dashboards named 'Delivery' for it_agency
--   tenants: 0 -> +1 per it_agency tenant that has none (stage: zunkireelabs-crm
--   + mobilise -> 2).
--   Guard is name = 'Delivery' (NOT "any dashboard") because every it_agency
--   tenant already has Overview from 143.
--   Rollback: DELETE FROM dashboards WHERE tenant_id IN (SELECT id FROM tenants WHERE industry_id = 'it_agency') AND name = 'Delivery';
--   Applied: stage 2026-07-12 / prod HELD.

BEGIN;

INSERT INTO dashboards (tenant_id, name, description, widgets, granted_position_ids, sort_order)
SELECT t.id, 'Delivery', 'Delivery health, utilization, tasks and approvals',
       '["delivery-health","projects-by-status","team-utilization","who-working-on-what","task-progress","approvals-pending","delivery-by-department","my-utilization","my-tasks","my-time"]'::jsonb,
       '{}', 1
FROM tenants t
WHERE t.industry_id = 'it_agency'
  AND NOT EXISTS (SELECT 1 FROM dashboards d WHERE d.tenant_id = t.id AND d.name = 'Delivery');

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('145_seed_it_agency_delivery_dashboard.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
