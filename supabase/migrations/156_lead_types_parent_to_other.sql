-- Migration 156: rename lead_types "Parent" -> "Other" for education_consultancy
--
-- The Lead Type picker across the app (Check-In, Add Lead, lead detail Tag toggle)
-- has been reduced to two values: "student" and "other" (Parent retired). The
-- Settings > Lead Management > Lead Types table (098_lead_types.sql) was seeded
-- with student + parent per education_consultancy tenant — rename the parent row
-- to "other" so the admin-facing list matches reality. No leads.tags data is
-- touched (existing "parent"-tagged leads already display as "Student" — see
-- LeadTagToggle's fallback logic, unaffected by this migration).
--
-- Additive/reversible: plain UPDATE on a config table, no data loss. Rollback:
-- UPDATE lead_types SET slug = 'parent', label = 'Parent' WHERE slug = 'other'
-- AND tenant_id IN (SELECT id FROM tenants WHERE industry_id = 'education_consultancy');
-- Applied: STAGE ONLY (dymeudcddasqpomfpjvt) — 1 row updated (Admizz Education),
-- verified after-state = student + other. Not yet applied to prod.

BEGIN;

UPDATE lead_types
SET slug = 'other', label = 'Other', updated_at = NOW()
WHERE slug = 'parent'
  AND tenant_id IN (SELECT id FROM tenants WHERE industry_id = 'education_consultancy');

-- Backfill "other" for tenants that never had a parent row to rename (e.g. already
-- deleted it, or seeded after 098 with no per-tenant trigger — see STATUS-BOARD).
INSERT INTO lead_types (tenant_id, slug, label, sort_order, is_default)
SELECT t.id, 'other', 'Other', 2, false
FROM tenants t
WHERE t.industry_id = 'education_consultancy'
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('156_lead_types_parent_to_other.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
