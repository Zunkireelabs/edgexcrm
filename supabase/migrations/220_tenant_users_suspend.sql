-- Migration 220: Suspend team members (block login) without deleting tenant_users
--
-- "Remove from Team" (DELETE tenant_users row) is destructive: it not only
-- revokes access but also silently erases the member's name from every lead/
-- activity/note they're attached to, because names are resolved via a LIVE
-- join against the current tenant_users roster (src/app/(main)/api/v1/team/
-- route.ts GET) — nothing stores a name anywhere permanent. An Admizz client
-- asked to block a few staff from logging in WITHOUT losing that attribution.
--
-- This adds an additive "suspend" state: the tenant_users row stays in place
-- (so every existing name-resolution path keeps working untouched), and
-- authenticateRequest()/buildUserAuthContext() (src/lib/api/auth.ts) is the
-- single enforcement point that treats a suspended row as "not authenticated"
-- for this tenant — same fail-closed shape as "no membership at all", no new
-- response type needed anywhere. suspended_at is a nullable timestamp (not a
-- boolean) to match leads.deleted_at's existing soft-delete convention —
-- self-documenting, and unsuspend is just SET suspended_at = NULL.
--
-- Deliberately NOT touching RLS/is_tenant_admin()/get_user_tenant_ids(): every
-- /api/v1/team mutation goes through scopedClient() (service-role, bypasses
-- RLS), so RLS is not the enforcement point here — filtering suspended rows
-- out of those SECURITY DEFINER functions would be a much broader change
-- (affecting every RLS-gated query tenant-wide, not just login) for no
-- additional benefit over the app-layer check.
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: tenant_users: N rows unchanged (both
--     new columns default to NULL for every existing row).
--   Rollback: ALTER TABLE tenant_users DROP COLUMN IF EXISTS suspended_at;
--             ALTER TABLE tenant_users DROP COLUMN IF EXISTS suspended_by;
--             DROP INDEX IF EXISTS idx_tenant_users_suspended_at;
--   Applied: stage <PENDING> / prod HELD.

BEGIN;

ALTER TABLE tenant_users
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;

-- Who suspended them — nice-to-have for the UI/support, not load-bearing for
-- enforcement (the audit_logs row from src/lib/api/audit.ts already records
-- the acting admin). ON DELETE SET NULL: losing the suspending admin's own
-- account must never cascade into un-suspending someone else.
ALTER TABLE tenant_users
  ADD COLUMN IF NOT EXISTS suspended_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Partial index: only suspended rows are ever queried by this column (the
-- auth check filters on suspended_at IS NOT NULL implicitly via the boolean
-- check), and most tenant_users rows will never be suspended.
CREATE INDEX IF NOT EXISTS idx_tenant_users_suspended_at
  ON tenant_users(tenant_id, suspended_at) WHERE suspended_at IS NOT NULL;

INSERT INTO public.schema_migrations (version) VALUES ('220_tenant_users_suspend.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
