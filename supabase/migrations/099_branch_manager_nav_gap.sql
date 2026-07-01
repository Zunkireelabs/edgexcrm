-- Branch Manager's nav allow-list (set in 053) was never updated when later migrations
-- granted canManageApplications (058) and canManageClasses (065). Applications, Classes,
-- Check-In, and Pipeline are hidden from the sidebar (getIndustrySidebarItems / canSeeNav /
-- navAllowed) even though the position already has the underlying capability (or no
-- minRoles restriction, for Check-In and Pipeline).
-- Additive + deduped: only appends the four missing keys, does not touch existing ones.
UPDATE positions
SET permissions = jsonb_set(
  permissions,
  '{nav,keys}',
  (
    SELECT jsonb_agg(DISTINCT k)
    FROM jsonb_array_elements_text(
      COALESCE(permissions -> 'nav' -> 'keys', '[]'::jsonb) || '["/applications","/classes","/check-in","/pipeline"]'::jsonb
    ) AS k
  ),
  true
)
WHERE is_system = true
  AND slug = 'branch-manager'
  AND permissions -> 'nav' ->> 'mode' = 'allow'
  AND tenant_id IN (
    SELECT id FROM tenants WHERE industry_id = 'education_consultancy'
  );
