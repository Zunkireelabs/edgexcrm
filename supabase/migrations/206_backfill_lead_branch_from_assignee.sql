-- Migration 206: backfill leads.branch_id from assignee's branch
--
-- Additive-only, idempotent (WHERE clause naturally excludes already-fixed rows
-- on re-run). Wrap in BEGIN/COMMIT.
--
-- Context: a branch manager (KTM branch) got "Insufficient permissions" acting
-- on a lead already assigned to their own branch's telecaller, because the
-- lead's branch_id was NULL and it had no lead_branches origin row. The
-- permission-check logic was fixed separately (apply-lead-patch.ts §4.2 +
-- bulk/route.ts now also check the assignee's branch), but branch_id also
-- feeds branch-scoped list/reporting views and lead_branches sync, so it
-- should be correctly populated going forward too.
--
-- Backfill rule: for leads with branch_id IS NULL, deleted_at IS NULL, and a
-- real assignee, set branch_id = the assignee's tenant_users.branch_id — but
-- ONLY when the assignee actually has a non-null branch_id. Leads with no
-- assignee, or whose assignee has no branch_id, are left untouched
-- deliberately — no guessing.
--
-- Expected before/after row counts (verified read-only against stage
-- 2026-08-18): 2453 leads matched the backfill WHERE clause on stage
-- (dymeudcddasqpomfpjvt). Exact prod count TBD at promotion time — this
-- migration is not applied to any live DB as part of this change; it rides
-- the normal migrate-before-code stage/prod pipeline.
--
-- Rollback: cannot be reversed automatically (no snapshot table — this is a
-- pure "fill the NULL from correct source" backfill, not a value change from
-- a known prior state). To roll back conceptually, re-NULL any row this
-- migration touched: there is no side-effect table to diff against, so if a
-- rollback is ever needed, identify rows via `updated_at` proximity to the
-- migration's apply time instead.

BEGIN;

-- ─── 1. Logging: before counts ──────────────────────────────────────────────

DO $$
DECLARE
  v_affected INT;
BEGIN
  SELECT COUNT(*) INTO v_affected
  FROM leads l
  JOIN tenant_users tu ON tu.user_id = l.assigned_to AND tu.tenant_id = l.tenant_id
  WHERE l.branch_id IS NULL
    AND l.deleted_at IS NULL
    AND l.assigned_to IS NOT NULL
    AND tu.branch_id IS NOT NULL;
  RAISE NOTICE '206 BEFORE: % leads have NULL branch_id but a resolvable branch via their assignee', v_affected;
END$$;

-- ─── 2. Backfill ─────────────────────────────────────────────────────────────

UPDATE leads l
SET branch_id = tu.branch_id
FROM tenant_users tu
WHERE tu.user_id = l.assigned_to
  AND tu.tenant_id = l.tenant_id
  AND l.branch_id IS NULL
  AND l.deleted_at IS NULL
  AND l.assigned_to IS NOT NULL
  AND tu.branch_id IS NOT NULL;

-- ─── 3. Logging: after counts ────────────────────────────────────────────────

DO $$
DECLARE
  v_still_null_resolvable INT;
  v_still_null_total      INT;
BEGIN
  SELECT COUNT(*) INTO v_still_null_resolvable
  FROM leads l
  JOIN tenant_users tu ON tu.user_id = l.assigned_to AND tu.tenant_id = l.tenant_id
  WHERE l.branch_id IS NULL
    AND l.deleted_at IS NULL
    AND l.assigned_to IS NOT NULL
    AND tu.branch_id IS NOT NULL;
  SELECT COUNT(*) INTO v_still_null_total
  FROM leads l
  WHERE l.branch_id IS NULL AND l.deleted_at IS NULL AND l.assigned_to IS NOT NULL;
  RAISE NOTICE '206 AFTER: % resolvable-but-still-NULL (expect 0), % total assigned leads still NULL branch_id (unresolvable — assignee has no branch, left untouched by design)', v_still_null_resolvable, v_still_null_total;
END$$;

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('206_backfill_lead_branch_from_assignee.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
