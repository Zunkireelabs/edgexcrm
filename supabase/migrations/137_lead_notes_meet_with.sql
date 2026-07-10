-- Migration 137: add per-visit "meet with" person to check-in notes, decoupled
-- from lead.assigned_to (the counselor). Fixes check-in history showing a lead's
-- counselor as "Meet with" on every visit even when no one was selected.
--
-- Additive only. Expected before/after: lead_notes gains one nullable column; 0 rows touched.
-- Rollback: ALTER TABLE lead_notes DROP COLUMN IF EXISTS meet_with_id;
-- Applied: stage 2026-07-10 / prod HELD.

BEGIN;

ALTER TABLE lead_notes ADD COLUMN IF NOT EXISTS meet_with_id UUID NULL;

INSERT INTO public.schema_migrations (version) VALUES ('137_lead_notes_meet_with.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
