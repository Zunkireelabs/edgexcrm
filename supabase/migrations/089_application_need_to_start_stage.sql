BEGIN;

-- before count
SELECT count(*) AS before_count FROM application_stages WHERE slug = 'need_to_start';

-- 1. Insert the new stage at position 0 for every education_consultancy tenant
INSERT INTO application_stages (tenant_id, name, slug, position, color, is_default, terminal_type)
SELECT t.id, 'Need to Start', 'need_to_start', 0, '#94a3b8', false, NULL
FROM tenants t
WHERE t.industry_id = 'education_consultancy'
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- 2. Re-number the standard stages deterministically (idempotent: re-running sets the same values)
UPDATE application_stages s
SET position = m.pos
FROM (VALUES
  ('need_to_start',0),('shortlisted',1),('documents_pending',2),('applied',3),
  ('conditional_offer',4),('unconditional_offer',5),('offer_accepted',6),
  ('visa_applied',7),('visa_approved',8),('enrolled',9),('rejected',10),('withdrawn',11)
) AS m(slug,pos)
WHERE s.slug = m.slug
  AND s.tenant_id IN (SELECT id FROM tenants WHERE industry_id = 'education_consultancy');

-- after count + ordering sanity
SELECT count(*) AS after_count FROM application_stages WHERE slug = 'need_to_start';

SELECT name, slug, position FROM application_stages
  WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'admizz') ORDER BY position;

COMMIT;
