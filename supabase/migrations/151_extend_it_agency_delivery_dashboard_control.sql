-- Migration 150: Append the 4 Phase-2 control widgets to the seeded "Delivery"
-- dashboard for it_agency tenants.
--
-- LOCAL ONLY THIS PHASE — do not apply to stage/prod. Opus manages stage sync
-- (a piecemeal out-of-order stage-apply just caused a ledger-drift incident);
-- applying only to local avoids reintroducing that.
--
-- Additive only. Idempotent: guarded on the dashboard NOT already containing
-- "delivery-overrun" (all 4 keys are appended together, so checking one is
-- sufficient — re-running this migration is then a no-op, never duplicates).
--   Expected before/after row counts: dashboards.widgets updated for every
--   it_agency tenant's "Delivery" row that doesn't already have the 4 control
--   keys (local: zunkireelabs-crm + test-agency -> 2 rows updated).
--   Rollback:
--     UPDATE dashboards SET widgets = widgets - 'delivery-overrun' - 'delivery-bench'
--       - 'delivery-overdue-tasks' - 'delivery-scope-creep'
--     WHERE tenant_id IN (SELECT id FROM tenants WHERE industry_id = 'it_agency')
--       AND name = 'Delivery';
--   Applied: local 2026-07-13 / stage HELD (this phase) / prod HELD.

BEGIN;

UPDATE dashboards d
SET widgets = d.widgets || '["delivery-overrun","delivery-bench","delivery-overdue-tasks","delivery-scope-creep"]'::jsonb,
    updated_at = now()
FROM tenants t
WHERE t.id = d.tenant_id
  AND t.industry_id = 'it_agency'
  AND d.name = 'Delivery'
  AND NOT (d.widgets @> '["delivery-overrun"]'::jsonb);

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('151_extend_it_agency_delivery_dashboard_control.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
