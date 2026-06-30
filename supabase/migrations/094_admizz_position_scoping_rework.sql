-- Migration 094: Admizz position scoping rework (client request 2026-06-29)
-- Education_consultancy / Admizz-specific position config (data, not schema).
-- All changes are to existing, already-shipped generic capabilities — NO code change required.
--
-- Client's target model (this migration ships the two UNAMBIGUOUS, safe parts):
--   1. Lead TeleCaller (lead-caller): own leads ONLY, everywhere. REMOVE the Pre-qualified
--      shared pool added in mig 093. Keep canEditLeads + canAssignLeads.
--   2. Lead Executive / Counselor / Application Executive: own leads only (already so) PLUS
--      the telecaller capability set → set canEditLeads + canAssignLeads.
--
-- DEFERRED — NOT in this migration: Branch Manager (branch-manager) "own branch only"
--   (leadScope all→team). Held because prod data shows Admizz leads are not branch-segmented
--   (9003/9016 active leads have NO branch_id; 6493 assigned to branch-less users) → flipping
--   to team scope would drop Birgunj & Janakpur managers to 0 leads. Pending client decision on
--   branch model + lead-to-branch distribution. Tracked separately.
--
-- Additive + idempotent: re-running re-applies the same keys / removes the same key.

BEGIN;

-- ── BEFORE snapshot ────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '094 BEFORE (admizz positions):';
  FOR r IN
    SELECT p.slug,
           p.permissions->>'leadScope'        AS leadscope,
           (p.permissions ? 'sharedPoolListIds') AS has_sharedpool,
           p.permissions->>'canAssignLeads'   AS canassign,
           p.permissions->>'canEditLeads'     AS canedit
    FROM positions p JOIN tenants t ON p.tenant_id = t.id
    WHERE t.slug = 'admizz'
      AND p.slug IN ('lead-caller','branch-manager','lead-executive','counselor','application-executive')
    ORDER BY p.slug
  LOOP
    RAISE NOTICE '  %: leadScope=% sharedPool=% canAssign=% canEdit=%',
      r.slug, r.leadscope, r.has_sharedpool, r.canassign, r.canedit;
  END LOOP;
END$$;

-- ── Step 1: Lead TeleCaller — drop the shared pool (own leads only) ─────────
-- Removes the sharedPoolListIds key entirely; keeps canEditLeads + canAssignLeads intact.
UPDATE positions p
SET permissions = (p.permissions - 'sharedPoolListIds'),
    updated_at = now()
FROM tenants t
WHERE p.tenant_id = t.id AND t.slug = 'admizz' AND p.slug = 'lead-caller';

-- ── Step 2: Lead Executive / Counselor / Application Executive — telecaller caps ─
-- Target: own leads only (already so) + can edit (stage/tasks/notes) + can assign.
-- Set BOTH canEditLeads and canAssignLeads explicitly so the position is correct
-- regardless of current state (stage's counselor lacked canEditLeads; prod had it).
UPDATE positions p
SET permissions = p.permissions
      || jsonb_build_object('canEditLeads', true)
      || jsonb_build_object('canAssignLeads', true),
    updated_at = now()
FROM tenants t
WHERE p.tenant_id = t.id AND t.slug = 'admizz'
  AND p.slug IN ('lead-executive','counselor','application-executive');

-- ── Step 3 (Branch Manager all→team) DEFERRED — see header note. ────────────

-- ── AFTER verification (assert every target ended in the intended state) ────
DO $$
DECLARE v_count int;
BEGIN
  RAISE NOTICE '094 AFTER (admizz positions):';

  -- 1. lead-caller: NO sharedPool, still has canAssign + canEdit.
  SELECT COUNT(*) INTO v_count
  FROM positions p JOIN tenants t ON p.tenant_id = t.id
  WHERE t.slug='admizz' AND p.slug='lead-caller'
    AND NOT (p.permissions ? 'sharedPoolListIds')
    AND p.permissions->>'canAssignLeads' = 'true'
    AND p.permissions->>'canEditLeads' = 'true'
    AND p.permissions->>'leadScope' = 'own';
  IF v_count <> 1 THEN RAISE EXCEPTION '094 step1 failed: lead-caller not in expected state (got %)', v_count; END IF;

  -- 2. lead-executive / counselor / application-executive: own + canAssign + canEdit.
  SELECT COUNT(*) INTO v_count
  FROM positions p JOIN tenants t ON p.tenant_id = t.id
  WHERE t.slug='admizz' AND p.slug IN ('lead-executive','counselor','application-executive')
    AND p.permissions->>'leadScope' = 'own'
    AND p.permissions->>'canAssignLeads' = 'true'
    AND p.permissions->>'canEditLeads' = 'true';
  IF v_count <> 3 THEN RAISE EXCEPTION '094 step2 failed: expected 3 own-scope+assign positions, got %', v_count; END IF;

  RAISE NOTICE '  all assertions passed (1 telecaller own-only, 3 own+edit+assign). Branch-manager deferred.';
END$$;

COMMIT;
