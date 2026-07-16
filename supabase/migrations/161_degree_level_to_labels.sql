-- Migration 161: Normalize leads.degree_level onto the study_levels catalog labels
--
-- Data-only, transactional, additive + reversible.
--   Expected before/after row counts: 0 rows created/dropped; leads.degree_level values
--     rewritten in place (see RAISE NOTICE for counts); study_levels +2 rows per
--     education tenant (Certificate, Diploma — appended, existing 3 rows untouched).
--   Rollback: reverse each UPDATE below (map catalog label back to its original slug/
--     variant) and DELETE FROM study_levels WHERE name IN ('Certificate','Diploma').
--   Applied: stage 2026-07-16 (710 rows rewritten: 135 UG, 64 PG, 3 PhD, 5 PHD, 380 Under
--     Graduate, 123 Post Graduate; +2 study_levels rows/tenant) / prod HELD.
--
-- Pre-migration check on stage found 5 non-null degree_level values beyond the original
-- UG/PG/PhD slugs: Certificate(8), Diploma(32), 'Post Graduate'(123), 'Under Graduate'(380),
-- 'PHD'(5, case variant). Decision (2026-07-16): fold the case/spacing variants into the
-- 3 existing catalog labels, and add Certificate + Diploma as real catalog entries (5
-- levels total) rather than leaving those 40 rows unmapped. custom_fields->>'degree_level'
-- (81 rows) is untouched — out of scope.

BEGIN;

-- (a) Seed the 2 new catalog entries, appended after the existing 3 (sort_order 0-2 from
--     migration 160 are left untouched — additive only, no renumbering of existing rows).
INSERT INTO study_levels (tenant_id, name, sort_order)
SELECT t.id, v.name, v.sort_order
FROM tenants t
CROSS JOIN (VALUES
  ('Certificate', 3),
  ('Diploma', 4)
) AS v(name, sort_order)
WHERE t.industry_id = 'education_consultancy'
ON CONFLICT (tenant_id, name) DO NOTHING;

-- (b) Before counts
DO $$
DECLARE c_slugs INT; c_variants INT;
BEGIN
  SELECT count(*) INTO c_slugs FROM leads WHERE degree_level IN ('UG', 'PG', 'PhD', 'PHD', 'Under Graduate', 'Post Graduate');
  SELECT count(*) INTO c_variants FROM leads WHERE degree_level IN ('PHD', 'Under Graduate', 'Post Graduate');
  RAISE NOTICE '161 BEFORE: % slug/variant rows total (% case/spacing variants)', c_slugs, c_variants;
END $$;

-- (c) Rewrite onto catalog labels. Certificate/Diploma need no UPDATE — they already
--     equal their catalog name.
UPDATE leads SET degree_level = 'Undergraduate'              WHERE degree_level = 'UG';
UPDATE leads SET degree_level = 'Postgraduate'               WHERE degree_level = 'PG';
UPDATE leads SET degree_level = 'Doctor of Philosophy (PhD)' WHERE degree_level = 'PhD';
UPDATE leads SET degree_level = 'Doctor of Philosophy (PhD)' WHERE degree_level = 'PHD';
UPDATE leads SET degree_level = 'Undergraduate'              WHERE degree_level = 'Under Graduate';
UPDATE leads SET degree_level = 'Postgraduate'               WHERE degree_level = 'Post Graduate';

-- (d) After counts (expect 0)
DO $$
DECLARE c INT;
BEGIN
  SELECT count(*) INTO c FROM leads WHERE degree_level IN ('UG', 'PG', 'PhD', 'PHD', 'Under Graduate', 'Post Graduate');
  RAISE NOTICE '161 AFTER: % slug/variant rows (expect 0)', c;
END $$;

INSERT INTO public.schema_migrations (version) VALUES ('161_degree_level_to_labels.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
