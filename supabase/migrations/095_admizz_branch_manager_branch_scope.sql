-- Migration 095: Admizz Branch Manager → own-branch scope + assign (client confirmed 2026-06-30)
-- Education_consultancy / Admizz-specific position config (data, not schema). No code change.
--
-- Client's confirmed model for branch-manager:
--   * See all leads of their OWN BRANCH only, in the MAIN lists only (staging excluded),
--     limited to leads ASSIGNED to a member of their branch ("assigned to anyone" in-branch).
--   * Able to assign, change lead-list stage, tasks, notes, meetings (canEditLeads already true;
--     add canAssignLeads).
--
-- Implementation: leadScope "all" → "team". getLeads team-scope already filters
--   assigned_to IN (branch members) — i.e. assignee-branch, verified correct: KTM mgr (bijay)
--   resolves to 2523 main-list leads via assignee-branch vs only 6 via leads.branch_id.
--   Staging lists are additionally excluded by the position's existing lists.allow (main-only)
--   and by the master-view excludeListIds path. All 3 BMs have a branch_id (KTM/Birgunj/Janakpur).
--
-- EXPECTED CONSEQUENCE (not a bug): Birgunj & Janakpur each have only the manager as a member
--   and 0 leads assigned to their branch, so those two managers will see 0 leads until Admizz
--   assigns leads to their branch staff. KTM manager sees ~2523. This is the rule the client
--   specified ("only own branch, only assigned").
--
-- Additive + idempotent.

BEGIN;

DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '095 BEFORE: branch-manager';
  FOR r IN
    SELECT p.permissions->>'leadScope' AS leadscope, p.permissions->>'canAssignLeads' AS canassign,
           p.permissions->>'canEditLeads' AS canedit
    FROM positions p JOIN tenants t ON p.tenant_id=t.id
    WHERE t.slug='admizz' AND p.slug='branch-manager'
  LOOP
    RAISE NOTICE '  leadScope=% canAssign=% canEdit=%', r.leadscope, r.canassign, r.canedit;
  END LOOP;
END$$;

-- Guard: every branch-manager member must have a branch_id, else team-scope silently falls
-- back to own-only (§4.1) and the manager would see only their own leads. Abort if any lack it.
DO $$
DECLARE v_missing int;
BEGIN
  SELECT COUNT(*) INTO v_missing
  FROM tenant_users tu JOIN positions p ON tu.position_id=p.id JOIN tenants t ON tu.tenant_id=t.id
  WHERE t.slug='admizz' AND p.slug='branch-manager' AND tu.branch_id IS NULL;
  IF v_missing > 0 THEN
    RAISE EXCEPTION '095 abort: % branch-manager member(s) have no branch_id (team scope would fall back to own-only)', v_missing;
  END IF;
END$$;

UPDATE positions p
SET permissions = p.permissions
      || jsonb_build_object('leadScope', 'team')
      || jsonb_build_object('canAssignLeads', true),
    updated_at = now()
FROM tenants t
WHERE p.tenant_id = t.id AND t.slug = 'admizz' AND p.slug = 'branch-manager';

DO $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM positions p JOIN tenants t ON p.tenant_id=t.id
  WHERE t.slug='admizz' AND p.slug='branch-manager'
    AND p.permissions->>'leadScope'='team'
    AND p.permissions->>'canAssignLeads'='true'
    AND p.permissions->>'canEditLeads'='true';
  IF v_count <> 1 THEN RAISE EXCEPTION '095 failed: branch-manager not in expected state (got %)', v_count; END IF;
  RAISE NOTICE '095 AFTER: branch-manager now team-scope + canAssign + canEdit. OK.';
END$$;

COMMIT;
