-- Migration 162: Remove "Certificate" study level; remap its leads to Diploma.
-- Forward-only correction of 161 (which added Certificate). Diploma stays.
--   Rollback: re-INSERT study_levels 'Certificate' (sort_order 3); reset Diploma sort_order 4;
--             (lead remap to Diploma is not reversibly separable — accept as lossy).
--   Applied: stage 2026-07-16 (8 leads remapped Certificate->Diploma, Diploma total 32->40) / prod HELD.

BEGIN;

DO $$ DECLARE c INT; BEGIN
  SELECT count(*) INTO c FROM leads WHERE degree_level = 'Certificate';
  RAISE NOTICE '162 BEFORE: % Certificate leads to remap', c; END $$;

-- (a) Remap the Certificate leads to Diploma.
UPDATE leads SET degree_level = 'Diploma' WHERE degree_level = 'Certificate';

-- (b) Remove Certificate from the catalog (all education tenants). Diploma stays.
DELETE FROM study_levels WHERE name = 'Certificate';

-- (c) Close the sort_order gap left by Certificate (was 3) so Diploma is contiguous.
UPDATE study_levels SET sort_order = 3 WHERE name = 'Diploma';

DO $$ DECLARE c INT; c2 INT; BEGIN
  SELECT count(*) INTO c  FROM leads WHERE degree_level = 'Certificate';
  SELECT count(*) INTO c2 FROM study_levels WHERE name = 'Certificate';
  RAISE NOTICE '162 AFTER: % Certificate leads (expect 0), % Certificate catalog rows (expect 0)', c, c2;
END $$;

INSERT INTO public.schema_migrations (version) VALUES ('162_remove_certificate_level.sql')
  ON CONFLICT (version) DO NOTHING;
COMMIT;
