-- Migration 151: Repurpose the it_agency "Overview" dashboard into the exec
-- "Company Overview" (Phase 3 — bird's-eye tiles)
--
-- Additive only (no schema change; data update). Mig 143 seeded "Overview" with
-- 3 lead widgets (stats/leads-by-stage/leads-by-source); that lead detail now
-- lives on the Sales & Outreach dashboard (mig 147), so this final phase turns
-- Overview into a pure cross-function tile surface: rename it "Company Overview"
-- and swap its widgets to the two new composite tile-row widgets
-- (overview-sales, overview-delivery — see widget-catalog.ts / dashboard-renderer.tsx).
--   Expected before/after row counts: dashboards for it_agency tenants named
--   'Overview' (or already-renamed 'Company Overview') lacking the overview-sales
--   widget: N -> 0 rows matched (updated in place; 0 rows inserted/deleted).
--   Idempotent: matches name IN ('Overview','Company Overview') AND NOT
--   widgets @> '["overview-sales"]' — a first run renames + swaps widgets; a
--   second run finds nothing left to touch (name already 'Company Overview' AND
--   widgets already contains 'overview-sales').
--   Rollback: UPDATE dashboards d SET name = 'Overview',
--     widgets = '["stats","leads-by-stage","leads-by-source"]'::jsonb
--     FROM tenants t WHERE d.tenant_id = t.id AND t.industry_id = 'it_agency'
--     AND d.name = 'Company Overview' AND d.widgets @> '["overview-sales"]'::jsonb;
--   Applied: LOCAL ONLY (per-brief guardrail — do not apply to stage/prod from
--   this session; Opus syncs stage in-order).

BEGIN;

UPDATE dashboards d
SET name = 'Company Overview',
    widgets = '["overview-sales","overview-delivery"]'::jsonb
FROM tenants t
WHERE d.tenant_id = t.id
  AND t.industry_id = 'it_agency'
  AND d.name IN ('Overview', 'Company Overview')
  AND NOT (d.widgets @> '["overview-sales"]'::jsonb);

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('152_repurpose_it_agency_overview_dashboard.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
