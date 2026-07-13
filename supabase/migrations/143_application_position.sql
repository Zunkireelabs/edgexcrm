-- 143_application_position.sql
-- Adds a manual sort order (`position`) to applications so the lead-detail
-- APPLICATIONS panel can be drag-reordered. Additive + reversible.
--
-- Before/after: `position` is NULL for all rows pre-migration; after backfill
-- every non-deleted application has a 0-based position within its lead.

BEGIN;

ALTER TABLE applications ADD COLUMN IF NOT EXISTS position INTEGER;

-- Backfill per lead by creation order (0-based).
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY lead_id ORDER BY created_at, id) - 1 AS rn
  FROM applications
  WHERE deleted_at IS NULL
)
UPDATE applications a SET position = o.rn FROM ordered o WHERE a.id = o.id;

CREATE INDEX IF NOT EXISTS idx_applications_lead_position ON applications (lead_id, position);

COMMIT;

-- Rollback:
-- DROP INDEX IF EXISTS idx_applications_lead_position;
-- ALTER TABLE applications DROP COLUMN IF EXISTS position;
