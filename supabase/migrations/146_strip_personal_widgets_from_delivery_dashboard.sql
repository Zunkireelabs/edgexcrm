-- Migration 145: Strip personal widgets (my-utilization/my-tasks/my-time) from
-- existing it_agency dashboards
--
-- Additive-only (no schema change; data cleanup). Phase 0 of the dashboard-OS
-- plan reclassifies my-utilization/my-tasks/my-time as personal widgets that
-- belong on Home, not on company dashboards. Companion code change removes
-- them from IT_AGENCY_WIDGET_KEYS (src/industries/_shared/features/insights/lib/widget-catalog.ts)
-- so they're no longer selectable going forward; this migration cleans up the
-- "Delivery" dashboard row seeded by mig 144 (and any other it_agency dashboard
-- that picked them up) so existing rows match.
--   Expected before/after row counts: dashboards for it_agency tenants whose
--   widgets array contains any of my-utilization/my-tasks/my-time: N -> 0
--   (stage: 1 row — the 'Delivery' dashboard seeded by 144 — updated in place,
--   its widgets array shrinking from 10 entries to 7; 0 rows deleted).
--   Idempotent: the WHERE clause (?| match) naturally becomes false once the
--   keys are stripped, so re-running touches 0 rows.
--   Rollback: not meaningful to auto-reverse (would require re-inserting the
--   exact removed keys at their original array positions); if needed, re-seed
--   via UPDATE dashboards SET widgets = widgets || '["my-utilization","my-tasks","my-time"]'::jsonb
--   WHERE tenant_id IN (SELECT id FROM tenants WHERE industry_id = 'it_agency') AND name = 'Delivery'.
--   Applied: stage 2026-07-12 / prod HELD.

BEGIN;

UPDATE dashboards d
SET widgets = COALESCE(
  (
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements(d.widgets) elem
    WHERE elem #>> '{}' NOT IN ('my-utilization', 'my-tasks', 'my-time')
  ),
  '[]'::jsonb
)
FROM tenants t
WHERE d.tenant_id = t.id
  AND t.industry_id = 'it_agency'
  AND d.widgets ?| array['my-utilization', 'my-tasks', 'my-time'];

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('146_strip_personal_widgets_from_delivery_dashboard.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
