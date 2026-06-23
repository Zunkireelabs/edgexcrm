-- 067_staging_lists.sql
-- Adds is_staging flag to lead_lists so staging/import lists can be
-- excluded from the "All Leads" master view and surfaced under "Leads Organise".
--
-- Rollback: ALTER TABLE lead_lists DROP COLUMN IF EXISTS is_staging;

BEGIN;

-- Before count (just total lists; is_staging column doesn't exist yet)
DO $$
DECLARE
  total_lists INT;
BEGIN
  SELECT COUNT(*) INTO total_lists FROM lead_lists;
  RAISE NOTICE '067 BEFORE: total_lists=%', total_lists;
END $$;

ALTER TABLE lead_lists
  ADD COLUMN IF NOT EXISTS is_staging BOOLEAN NOT NULL DEFAULT false;

-- Mark the Admizz migration-qc list as a staging list.
-- Tenant-scoped: only touches the one row that matches slug + tenant.
UPDATE lead_lists
SET is_staging = true
WHERE slug = 'migration-qc';

-- After counts — verify exactly 1 row was flipped
DO $$
DECLARE
  total_lists   INT;
  staging_count INT;
BEGIN
  SELECT COUNT(*) INTO total_lists   FROM lead_lists;
  SELECT COUNT(*) INTO staging_count FROM lead_lists WHERE is_staging = true;
  RAISE NOTICE '067 AFTER:  total_lists=%, staging_count=%', total_lists, staging_count;
  IF staging_count <> 1 THEN
    RAISE EXCEPTION '067 ABORT: expected exactly 1 staging row, got %', staging_count;
  END IF;
END $$;

COMMIT;
