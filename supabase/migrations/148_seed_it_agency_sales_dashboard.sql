-- Migration 147: Seed a default "Sales & Outreach" dashboard for it_agency tenants
--
-- Additive only. Phase 1 CORE added 6 self-fetching sales widgets (server-side
-- aggregation via migration 146's RPCs); this seeds one shared dashboard so every
-- it_agency tenant gets the CRM funnel cockpit out of the box. Companion to 143
-- (Overview, sort_order 0) and 144 (Delivery, sort_order 1) — this one is sort_order 2.
--   Expected before/after row counts: dashboards named 'Sales & Outreach' for
--   it_agency tenants: 0 -> +1 per it_agency tenant that has none (stage:
--   zunkireelabs-crm + mobilise -> 2).
--   Rollback: DELETE FROM dashboards WHERE tenant_id IN (SELECT id FROM tenants WHERE industry_id = 'it_agency') AND name = 'Sales & Outreach';
--   Applied: stage <YYYY-MM-DD> / prod HELD.

BEGIN;

INSERT INTO dashboards (tenant_id, name, description, widgets, granted_position_ids, sort_order)
SELECT t.id, 'Sales & Outreach', 'CRM funnel — leads created, each stage, through to revenue',
       '["sales-leads-trend","sales-leads-by-source","sales-funnel","sales-leads-by-owner","sales-aging","sales-deals-summary"]'::jsonb,
       '{}', 2
FROM tenants t
WHERE t.industry_id = 'it_agency'
  AND NOT EXISTS (SELECT 1 FROM dashboards d WHERE d.tenant_id = t.id AND d.name = 'Sales & Outreach');

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('148_seed_it_agency_sales_dashboard.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
