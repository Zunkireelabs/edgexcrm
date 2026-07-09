-- Migration 129: backfill lead_branches.assigned_to for pool rows desynced from leads.assigned_to
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: lead_branches (is_origin=false, assigned_to IS NULL,
--     joined leads.assigned_to IS NOT NULL): prod ~26 -> 0 (stage count TBD, verify at apply time).
--   Rollback: data-fix only, no structural change. No automatic rollback — the corrected rows
--     now match leads.assigned_to, which is the source of truth.
--   Applied: stage <YYYY-MM-DD> / prod <YYYY-MM-DD or HELD>.
--
-- Context: cross-branch pool (unassignedCrossBranchLeadIds) read lead_branches.assigned_to to
-- decide "is this lead claimable?" instead of the live leads.assigned_to. Prior assign paths
-- (bulk assign, admin/owner single-PATCH) didn't sync non-origin pool rows, so a claimed lead's
-- pool row stayed NULL and leaked into other own-scope users' lists. See docs/POOL-ASSIGN-DESYNC-BRIEF.md.
-- Code paths are fixed separately (branch-membership.ts, bulk/route.ts, [id]/route.ts) — this
-- migration only heals already-desynced rows. Idempotent: WHERE guard makes a re-run a no-op.

BEGIN;

UPDATE lead_branches lb
SET    assigned_to = l.assigned_to
FROM   leads l
WHERE  l.id = lb.lead_id
  AND  lb.is_origin = false
  AND  lb.assigned_to IS NULL
  AND  l.assigned_to IS NOT NULL
  AND  l.deleted_at IS NULL;

INSERT INTO public.schema_migrations (version) VALUES ('129_fix_lead_branches_assigned_desync.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
