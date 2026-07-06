-- Migration 115: positive-hours guard on project_allocations
-- Additive only. Not applied by Sonnet — Opus applies to stage after review.

BEGIN;

ALTER TABLE project_allocations
  ADD CONSTRAINT project_allocations_hours_positive CHECK (hours_per_week > 0);

COMMIT;
