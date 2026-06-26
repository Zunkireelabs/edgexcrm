-- DO NOT APPLY manually — Opus applies after branch review.
-- Migration 062: Seed default lead lists for travel_agency tenants + backfill existing leads.
-- Additive only (INSERT ON CONFLICT DO NOTHING + UPDATE with WHERE guard). Safe to re-run.

-- Seed 4 system lists for all travel_agency tenants.
-- Names are admin-renameable in Settings — these are defaults.
INSERT INTO lead_lists (tenant_id, name, slug, sort_order, is_intake, is_archive, is_system, access, created_at, updated_at)
SELECT
  t.id AS tenant_id,
  lists.name,
  lists.slug,
  lists.sort_order,
  lists.is_intake,
  lists.is_archive,
  true AS is_system,
  '{"mode":"all"}'::jsonb AS access,
  now(),
  now()
FROM tenants t
CROSS JOIN (
  VALUES
    ('Inquiries',     'inquiries',      1, true,  false),
    ('Qualified',     'qualified',      2, false, false),
    ('Active Clients','active-clients', 3, false, false),
    ('Archived',      'archived',       4, false, true)
) AS lists(name, slug, sort_order, is_intake, is_archive)
WHERE t.industry_id = 'travel_agency'
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- Backfill: assign existing travel leads with no list_id to their tenant's intake list.
UPDATE leads l
SET list_id = ll.id,
    updated_at = now()
FROM lead_lists ll
JOIN tenants t ON t.id = ll.tenant_id
WHERE ll.tenant_id = l.tenant_id
  AND ll.is_intake = true
  AND l.list_id IS NULL
  AND l.deleted_at IS NULL
  AND t.industry_id = 'travel_agency';
