-- Set canManageApplications = true on the seeded system Counselor and Branch Manager positions
-- for all education_consultancy tenants. These positions pre-exist from migrations 030 and 053.
-- Additive: only touches the two named slugs; does not alter any custom positions.
UPDATE positions
SET permissions = jsonb_set(permissions, '{canManageApplications}', 'true'::jsonb, true)
WHERE is_system = true
  AND slug IN ('counselor', 'branch-manager')
  AND tenant_id IN (
    SELECT id FROM tenants WHERE industry_id = 'education_consultancy'
  );
