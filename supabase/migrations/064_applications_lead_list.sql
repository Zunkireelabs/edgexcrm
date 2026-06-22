-- 064_applications_lead_list.sql
-- Add "Applications" as a system lifecycle list for education_consultancy tenants,
-- slotted between Prospects (3) and Archived (4):
--   Pre-qualified → Qualified → Prospects → Applications → Archived
-- Additive + idempotent. Renumbers Archived (and any later custom list) to make room.
-- Scope: education_consultancy only. Other industries untouched.

BEGIN;

-- ── 1. Make room: shift Archived 4 → 5 for education tenants ──────────────────
UPDATE lead_lists
SET sort_order = 5, updated_at = now()
WHERE slug = 'archived'
  AND sort_order = 4
  AND tenant_id IN (SELECT id FROM tenants WHERE industry_id = 'education_consultancy');

-- ── 2. Push any list currently at the freed slot range past Archived ─────────
-- Stage carries a temporary custom "Migration (QC)" list at sort_order 5; keep it
-- last so ordering stays clean. Generic by slug; no-op where it doesn't exist.
UPDATE lead_lists
SET sort_order = 6, updated_at = now()
WHERE slug = 'migration-qc'
  AND tenant_id IN (SELECT id FROM tenants WHERE industry_id = 'education_consultancy');

-- ── 3. Insert Applications at sort_order 4 (system list) ─────────────────────
-- ON CONFLICT DO NOTHING makes this idempotent on re-apply.
INSERT INTO lead_lists (tenant_id, name, slug, sort_order, is_system, is_intake, is_archive, access)
SELECT
  t.id,
  'Applications',
  'applications',
  4,
  true,
  false,
  false,
  '{"mode":"all"}'::jsonb
FROM tenants t
WHERE t.industry_id = 'education_consultancy'
ON CONFLICT (tenant_id, slug) DO NOTHING;

COMMIT;
