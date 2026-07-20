-- Migration 141: add tenant_id to application_notes + admin mutation policies
--
-- application_notes (mig 140) was scoped only indirectly via a join to
-- applications.tenant_id, inconsistent with every other tenant-owned table in
-- this codebase (CLAUDE.md: "every new table with tenant data must have
-- tenant_id"). Adds the column (backfilled from the parent application),
-- and gives tenant admins a mutation path — today only the note's own author
-- could delete it, with no owner/admin override to moderate a note.
-- Additive + idempotent.
--
--   Expected before/after row counts: application_notes 0 -> 0 (schema-only;
--   no real rows exist yet since this table shipped in the same branch).
--   Rollback: ALTER TABLE application_notes DROP COLUMN IF EXISTS tenant_id;
--             DROP POLICY IF EXISTS "Admins can update application notes" ON application_notes;
--             DROP POLICY IF EXISTS "Admins can delete application notes" ON application_notes;
--   Applied: stage <PENDING> / prod <PENDING>.

BEGIN;

ALTER TABLE application_notes ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- Backfill any existing rows (none expected yet, but safe/idempotent either way).
UPDATE application_notes n
SET tenant_id = a.tenant_id
FROM applications a
WHERE n.application_id = a.id AND n.tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_application_notes_tenant ON application_notes (tenant_id);

-- Admin mutation policies — CLAUDE.md's standard is_tenant_admin(tenant_id)
-- pattern for mutations, alongside the existing own-user-only delete policy
-- (RLS OR's multiple policies of the same command together, so either the
-- author or a tenant admin can delete/update a note).
DROP POLICY IF EXISTS "Admins can update application notes" ON application_notes;
CREATE POLICY "Admins can update application notes" ON application_notes
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Admins can delete application notes" ON application_notes;
CREATE POLICY "Admins can delete application notes" ON application_notes
  FOR DELETE USING (is_tenant_admin(tenant_id));

INSERT INTO public.schema_migrations (version) VALUES ('141_application_notes_tenant_id.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
