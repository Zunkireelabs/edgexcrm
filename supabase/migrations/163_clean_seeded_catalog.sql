-- Migration 163: Clean the auto-seeded academic catalog (universities + programs)
--
-- Data-only, transactional. Never touches the applications table.
--   Expected before/after row counts: partner_colleges 148 -> ~87; study_programs 80 -> ~3
--     (dry-run verified on stage before applying — see PR description).
--   Rollback: none — deletes junk seed data; re-add via UI if needed. Applications untouched.
--   Applied: stage 2026-07-17 (148->87 partner_colleges, 80->3 study_programs; applications 513->513 unchanged) / prod HELD.
--
-- Migration 160's backfill inserted name-only partner_colleges rows (no country, no
-- description) from applications.university_name for any name without an existing
-- case-insensitive match. That source data is dirty (multi-university strings like
-- "1. Arden University\n2. UEL" landed as single rows) — this migration removes those
-- backfilled rows (CASCADEs their study_programs via FK ON DELETE CASCADE) and, as a
-- second pass, removes any remaining junk-pattern program names on surviving universities.

BEGIN;

DO $$ DECLARE u INT; p INT; BEGIN
  SELECT count(*) INTO u FROM partner_colleges; SELECT count(*) INTO p FROM study_programs;
  RAISE NOTICE '163 BEFORE: % partner_colleges, % study_programs', u, p; END $$;

-- (a) Delete the auto-added (backfilled by mig 160) universities. The backfill inserted
--     name-only rows (no country, no description) from applications.university_name.
--     Deleting these CASCADEs their study_programs (FK ON DELETE CASCADE).
DELETE FROM partner_colleges pc
WHERE pc.country IS NULL
  AND pc.description IS NULL
  AND EXISTS (
    SELECT 1 FROM applications a
    WHERE a.tenant_id = pc.tenant_id
      AND LOWER(TRIM(a.university_name)) = LOWER(pc.name)
  );

-- (b) Delete any remaining junk-pattern programs still attached to surviving (original-87) unis.
DELETE FROM study_programs
WHERE name ~ '(^|\s)[0-9]+\.'        -- "1." "2." concatenations
   OR name ILIKE '%not specified%'
   OR TRIM(name) = '';

DO $$ DECLARE u INT; p INT; BEGIN
  SELECT count(*) INTO u FROM partner_colleges; SELECT count(*) INTO p FROM study_programs;
  RAISE NOTICE '163 AFTER: % partner_colleges (expect ~87), % study_programs (expect clean only)', u, p;
END $$;

INSERT INTO public.schema_migrations (version) VALUES ('163_clean_seeded_catalog.sql') ON CONFLICT (version) DO NOTHING;
COMMIT;
