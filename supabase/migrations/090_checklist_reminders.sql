-- Migration 090: Task reminders on lead checklists
-- Adds an optional reminder time to a lead task. A scheduled job
-- (/api/internal/reminders/run) finds due reminders and notifies the lead's
-- assignee, then stamps reminded_at so each fires once. Additive + idempotent.

BEGIN;

ALTER TABLE lead_checklists ADD COLUMN IF NOT EXISTS remind_at   TIMESTAMPTZ;
ALTER TABLE lead_checklists ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;

-- Partial index for the due-reminder scan (only un-fired, incomplete tasks).
CREATE INDEX IF NOT EXISTS idx_lead_checklists_remind_due
  ON lead_checklists (remind_at)
  WHERE remind_at IS NOT NULL AND reminded_at IS NULL AND is_completed = false;

COMMIT;
