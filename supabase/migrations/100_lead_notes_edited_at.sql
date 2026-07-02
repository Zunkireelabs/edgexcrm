-- Add edited_at to lead_notes so the UI can show an "Edited" indicator
-- when a note has been modified after its initial creation.
-- Rollback: ALTER TABLE lead_notes DROP COLUMN IF EXISTS edited_at;

ALTER TABLE lead_notes ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ NULL;
