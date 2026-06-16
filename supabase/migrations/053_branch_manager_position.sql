-- Seed the one "Branch Manager" system position for every existing education_consultancy tenant.
-- Nav key "/insights/dashboards" (not "/insights") — verified against shell.tsx navAllowed() and
-- the education_consultancy manifest sidebar child href + canSeeNav() call-sites.
INSERT INTO positions (tenant_id, name, slug, base_tier, is_system, permissions)
SELECT t.id,
       'Branch Manager',
       'branch-manager',
       'member',
       true,
       '{"nav":{"mode":"allow","keys":["/home","/leads","/insights/dashboards","/inbox"]},
         "pipelines":{"mode":"all"},
         "leadScope":"team",
         "canEditLeads":true,
         "dashboard":{"widgets":{"mode":"allow","keys":["stats","leads-by-stage","leads-by-source","utm"]}}}'::jsonb
FROM tenants t
WHERE t.industry_id = 'education_consultancy'
  AND NOT EXISTS (
    SELECT 1 FROM positions p
    WHERE p.tenant_id = t.id AND p.slug = 'branch-manager'
  );
