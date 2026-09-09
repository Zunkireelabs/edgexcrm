-- Migration 230: project-task due reminders — tasks.reminded_at fire-once stamp
--
-- Adds a nullable stamp to `tasks` so the ops-reminders-scan Inngest function
-- (src/lib/inngest/functions/reminders.ts) can notify a task's assignee once when
-- its due_date passes, mirroring lead_checklists.reminded_at (migration 091).
-- Additive only. Partial index mirrors idx_lead_checklists_remind_due.
--
--   Expected before/after row counts: tasks — ADD COLUMN touches 0 rows; the
--     backlog-suppression UPDATE stamps every currently-overdue unfinished task
--     (local Docker Supabase: 2 rows). Report the prod count at apply time.
--   Rollback:
--     DROP INDEX IF EXISTS idx_tasks_reminder_due;
--     ALTER TABLE tasks DROP COLUMN IF EXISTS reminded_at;
--   Applied: stage <HELD> / prod <HELD>.

BEGIN;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;

-- Suppress the launch burst: anything already overdue at install time is treated
-- as already reminded, so only tasks that go overdue AFTER this ships will notify.
-- Without this, the first ops-reminders-scan pass fires a months-deep backlog at
-- the assignee in one batch.
UPDATE tasks SET reminded_at = now()
WHERE due_date < CURRENT_DATE AND status <> 'done' AND reminded_at IS NULL;

-- Partial index for the due-reminder scan: only past-due, unfinished, assigned,
-- not-yet-reminded tasks. (due_date is a DATE; the scan compares it to today.)
CREATE INDEX IF NOT EXISTS idx_tasks_reminder_due
  ON tasks (due_date)
  WHERE due_date IS NOT NULL AND reminded_at IS NULL
        AND status <> 'done' AND assignee_id IS NOT NULL;

INSERT INTO public.schema_migrations (version) VALUES ('230_tasks_reminded_at.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
