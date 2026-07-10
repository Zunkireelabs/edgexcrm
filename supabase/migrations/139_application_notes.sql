-- Migration 139: application_notes table
--
-- Backs the new "Notes" tab on the Application Detail page. Mirrors lead_notes
-- (mig 001) exactly, but scoped to applications instead of leads — a note here
-- is about one specific university application, not the student generally, so
-- it's deliberately a separate table rather than reusing lead_notes.
-- Additive + idempotent.
--
--   Expected before/after row counts: application_notes 0 -> 0 (new table, no seed).
--   Rollback: DROP TABLE IF EXISTS application_notes;
--   Applied: stage <PENDING> / prod <PENDING>.

BEGIN;

CREATE TABLE IF NOT EXISTS application_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  user_email  VARCHAR(255) NOT NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  edited_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_application_notes_application_id ON application_notes(application_id);

ALTER TABLE application_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view tenant application notes" ON application_notes;
CREATE POLICY "Users can view tenant application notes" ON application_notes
  FOR SELECT USING (
    application_id IN (
      SELECT applications.id FROM applications
      WHERE applications.tenant_id IN (SELECT get_user_tenant_ids())
    )
  );

DROP POLICY IF EXISTS "Users can add application notes" ON application_notes;
CREATE POLICY "Users can add application notes" ON application_notes
  FOR INSERT WITH CHECK (
    application_id IN (
      SELECT applications.id FROM applications
      WHERE applications.tenant_id IN (SELECT get_user_tenant_ids())
    )
  );

DROP POLICY IF EXISTS "Users can delete own application notes" ON application_notes;
CREATE POLICY "Users can delete own application notes" ON application_notes
  FOR DELETE USING (user_id = auth.uid());

INSERT INTO public.schema_migrations (version) VALUES ('139_application_notes.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
