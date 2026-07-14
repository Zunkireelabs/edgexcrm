-- Migration 149: Append the 5 Phase-1.5 depth widgets to the seeded
-- "Sales & Outreach" dashboard for it_agency tenants.
--
-- Additive only. Idempotent: guarded on the dashboard NOT already containing
-- "sales-conversion" (all 5 keys are appended together, so checking one is
-- sufficient — re-running this migration is then a no-op, never duplicates).
--   Expected before/after row counts: dashboards.widgets updated for every
--   it_agency tenant's "Sales & Outreach" row that doesn't already have the
--   5 depth keys (stage: zunkireelabs-crm + mobilise -> 2 rows updated).
--   Rollback:
--     UPDATE dashboards SET widgets = widgets - 'sales-conversion' - 'sales-cycle'
--       - 'sales-proposals' - 'sales-first-contact' - 'sales-win-loss'
--     WHERE tenant_id IN (SELECT id FROM tenants WHERE industry_id = 'it_agency')
--       AND name = 'Sales & Outreach';
--   Applied: stage <YYYY-MM-DD> / prod HELD.

BEGIN;

UPDATE dashboards d
SET widgets = d.widgets || '["sales-conversion","sales-cycle","sales-proposals","sales-first-contact","sales-win-loss"]'::jsonb,
    updated_at = now()
FROM tenants t
WHERE t.id = d.tenant_id
  AND t.industry_id = 'it_agency'
  AND d.name = 'Sales & Outreach'
  AND NOT (d.widgets @> '["sales-conversion"]'::jsonb);

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('150_extend_it_agency_sales_dashboard_depth.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
