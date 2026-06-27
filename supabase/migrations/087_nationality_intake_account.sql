-- Migration 087: Add nationality + intake_account columns; backfill from custom_fields
-- Additive + non-destructive. Run in a transaction with before/after counts.
-- DO NOT APPLY MANUALLY — Opus runs this on stage DB after reviewing the diff.

BEGIN;

-- ── 1. Add columns (idempotent) ──────────────────────────────────────────────

ALTER TABLE leads ADD COLUMN IF NOT EXISTS nationality    TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS intake_account TEXT;

-- ── 2. Count before ──────────────────────────────────────────────────────────

DO $$
DECLARE
  before_nationality    INTEGER;
  before_intake_account INTEGER;
BEGIN
  SELECT COUNT(*) INTO before_nationality    FROM leads WHERE nationality    IS NOT NULL AND deleted_at IS NULL;
  SELECT COUNT(*) INTO before_intake_account FROM leads WHERE intake_account IS NOT NULL AND deleted_at IS NULL;
  RAISE NOTICE 'BEFORE: nationality=%, intake_account=%', before_nationality, before_intake_account;
END $$;

-- ── 3. Backfill nationality from custom_fields.nationality ───────────────────
-- If still null, derive from phone country code (+977 → Nepal, etc.).
-- The derive CASE covers the most common Agentics dial codes; all others stay null.

UPDATE leads
SET nationality = custom_fields ->> 'nationality'
WHERE nationality IS NULL
  AND (custom_fields ->> 'nationality') IS NOT NULL
  AND (custom_fields ->> 'nationality') <> ''
  AND deleted_at IS NULL;

-- Derive from phone dial code for rows still null after direct copy
UPDATE leads
SET nationality = CASE
  WHEN phone LIKE '+977%' THEN 'Nepal'
  WHEN phone LIKE '+91%'  THEN 'India'
  WHEN phone LIKE '+880%' THEN 'Bangladesh'
  WHEN phone LIKE '+975%' THEN 'Bhutan'
  WHEN phone LIKE '+94%'  THEN 'Sri Lanka'
  WHEN phone LIKE '+92%'  THEN 'Pakistan'
  WHEN phone LIKE '+93%'  THEN 'Afghanistan'
  WHEN phone LIKE '+61%'  THEN 'Australia'
  WHEN phone LIKE '+44%'  THEN 'United Kingdom'
  WHEN phone LIKE '+1%'   THEN 'United States'
  ELSE NULL
END
WHERE nationality IS NULL
  AND phone IS NOT NULL
  AND deleted_at IS NULL;

-- ── 4. Backfill intake_account from custom_fields.source_page ────────────────

UPDATE leads
SET intake_account = custom_fields ->> 'source_page'
WHERE intake_account IS NULL
  AND (custom_fields ->> 'source_page') IS NOT NULL
  AND (custom_fields ->> 'source_page') <> ''
  AND deleted_at IS NULL;

-- ── 5. Backfill intake_source from custom_fields.source_category ─────────────
-- Only where intake_source is null or empty (Agentics import set "Agentics leads").

UPDATE leads
SET intake_source = custom_fields ->> 'source_category'
WHERE (intake_source IS NULL OR intake_source = '')
  AND (custom_fields ->> 'source_category') IS NOT NULL
  AND (custom_fields ->> 'source_category') <> ''
  AND deleted_at IS NULL;

-- ── 6. Backfill intake_medium from custom_fields.source_channel ──────────────

UPDATE leads
SET intake_medium = custom_fields ->> 'source_channel'
WHERE (intake_medium IS NULL OR intake_medium = '')
  AND (custom_fields ->> 'source_channel') IS NOT NULL
  AND (custom_fields ->> 'source_channel') <> ''
  AND deleted_at IS NULL;

-- ── 7. Backfill intake_campaign from custom_fields.campaign ──────────────────

UPDATE leads
SET intake_campaign = custom_fields ->> 'campaign'
WHERE intake_campaign IS NULL
  AND (custom_fields ->> 'campaign') IS NOT NULL
  AND (custom_fields ->> 'campaign') <> ''
  AND deleted_at IS NULL;

-- ── 8. Backfill degree_level from custom_fields.program_level ────────────────

UPDATE leads
SET degree_level = custom_fields ->> 'program_level'
WHERE degree_level IS NULL
  AND (custom_fields ->> 'program_level') IS NOT NULL
  AND (custom_fields ->> 'program_level') <> ''
  AND deleted_at IS NULL;

-- ── 9. Backfill field_of_study from custom_fields.program_category ───────────

UPDATE leads
SET field_of_study = custom_fields ->> 'program_category'
WHERE field_of_study IS NULL
  AND (custom_fields ->> 'program_category') IS NOT NULL
  AND (custom_fields ->> 'program_category') <> ''
  AND deleted_at IS NULL;

-- ── 10. Backfill destinations from custom_fields.interested_country ───────────
-- Append only where destinations is empty array {}.

UPDATE leads
SET destinations = ARRAY[custom_fields ->> 'interested_country']
WHERE destinations = '{}'
  AND (custom_fields ->> 'interested_country') IS NOT NULL
  AND (custom_fields ->> 'interested_country') <> ''
  AND deleted_at IS NULL;

-- ── 11. Count after ──────────────────────────────────────────────────────────

DO $$
DECLARE
  after_nationality    INTEGER;
  after_intake_account INTEGER;
BEGIN
  SELECT COUNT(*) INTO after_nationality    FROM leads WHERE nationality    IS NOT NULL AND deleted_at IS NULL;
  SELECT COUNT(*) INTO after_intake_account FROM leads WHERE intake_account IS NOT NULL AND deleted_at IS NULL;
  RAISE NOTICE 'AFTER:  nationality=%, intake_account=%', after_nationality, after_intake_account;
END $$;

COMMIT;
