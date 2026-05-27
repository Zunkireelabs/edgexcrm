-- Migration 023: project board stages
-- Adds 'in_review' + 'delivered' to projects.status enum.
-- Backfills 'done' → 'delivered' (semantic merge: a "done" project IS a delivered one).

ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_status_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_status_check
  CHECK (status IN ('planning','active','in_review','delivered','on_hold','cancelled','done'));

-- Note: 'done' kept in the constraint to avoid breaking any in-flight transactions during
-- the brief window between this migration and the backfill UPDATE below. Backfill nukes it.

UPDATE projects SET status = 'delivered' WHERE status = 'done';

-- Now tighten the constraint to drop 'done'.
ALTER TABLE projects
  DROP CONSTRAINT projects_status_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_status_check
  CHECK (status IN ('planning','active','in_review','delivered','on_hold','cancelled'));
