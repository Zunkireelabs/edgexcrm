-- Migration 142: drop unreachable application_notes admin mutation policies
--
-- Migration 141 added is_tenant_admin() UPDATE/DELETE policies for
-- application_notes anticipating a note-moderation UI. No PATCH/DELETE route
-- or UI was ever built for individual notes (only GET list + POST create
-- exist) — these policies are dead code with no reachable code path. Dropping
-- them now; re-add alongside the real feature if/when note edit/delete ships.
-- Additive-only in spirit (removes unused surface, doesn't touch data).
--
--   Expected before/after row counts: application_notes unaffected (policy-only change).
--   Rollback: re-run migration 141's two CREATE POLICY statements.
--   Applied: stage <PENDING> / prod <PENDING>.

BEGIN;

DROP POLICY IF EXISTS "Admins can update application notes" ON application_notes;
DROP POLICY IF EXISTS "Admins can delete application notes" ON application_notes;

INSERT INTO public.schema_migrations (version) VALUES ('142_drop_unreachable_application_notes_admin_policies.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
