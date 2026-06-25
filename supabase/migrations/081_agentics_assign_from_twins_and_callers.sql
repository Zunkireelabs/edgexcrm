-- Migration 081: Assign counsellors to 155 Agentics leads via phone-twin matching and tele-call history
-- Tenant: Admizz Education (febeb37c-521c-4f29-adbb-0195b2eede88)
-- Idempotent: only fills assigned_to IS NULL, never clobbers existing assignments

BEGIN;

-- Before counts
DO $$
DECLARE
  v_total INTEGER;
  v_assigned INTEGER;
BEGIN
  SELECT COUNT(*), COUNT(assigned_to)
  INTO v_total, v_assigned
  FROM leads
  WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
    AND custom_fields->>'import_batch' = 'agentics-2026-06-24'
    AND deleted_at IS NULL;

  RAISE NOTICE 'BEFORE: total_agentics=%, assigned=%, unassigned=%',
    v_total, v_assigned, v_total - v_assigned;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Part A: Phone-twin assignment (≈145 leads)
-- For each Agentics lead whose phone (last 10 digits) matches an engaged lead
-- (has legacy_crm_id and assigned_to), set assigned_to = that counsellor.
-- If one phone maps to multiple counsellors (conflicts), pick deterministically
-- by taking the alphabetically-first assigned_to UUID (rn=1 ORDER BY assigned_to).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_part_a_rows INTEGER;
  v_conflicts   INTEGER;
BEGIN
  -- Report conflicts before assignment
  WITH agentics_norm AS (
    SELECT
      l.id,
      RIGHT(REGEXP_REPLACE(l.phone, '[^0-9]', '', 'g'), 10) AS phone10
    FROM leads l
    WHERE l.tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
      AND l.custom_fields->>'import_batch' = 'agentics-2026-06-24'
      AND l.assigned_to IS NULL
      AND l.deleted_at IS NULL
      AND l.phone IS NOT NULL
      AND LENGTH(REGEXP_REPLACE(l.phone, '[^0-9]', '', 'g')) >= 10
  ),
  engaged_norm AS (
    SELECT
      DISTINCT assigned_to,
      RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) AS phone10
    FROM leads
    WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
      AND custom_fields->>'legacy_crm_id' IS NOT NULL
      AND assigned_to IS NOT NULL
      AND deleted_at IS NULL
      AND phone IS NOT NULL
      AND LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) >= 10
  )
  SELECT COUNT(*) INTO v_conflicts
  FROM (
    SELECT a.id
    FROM agentics_norm a
    JOIN engaged_norm e ON a.phone10 = e.phone10
    GROUP BY a.id
    HAVING COUNT(DISTINCT e.assigned_to) > 1
  ) conflicts;

  RAISE NOTICE 'Part A: phone-to-multiple-counsellor conflicts=%', v_conflicts;

  -- Perform Part A assignment (deterministic: ORDER BY assigned_to, rn=1)
  WITH agentics_norm AS (
    SELECT
      l.id,
      RIGHT(REGEXP_REPLACE(l.phone, '[^0-9]', '', 'g'), 10) AS phone10
    FROM leads l
    WHERE l.tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
      AND l.custom_fields->>'import_batch' = 'agentics-2026-06-24'
      AND l.assigned_to IS NULL
      AND l.deleted_at IS NULL
      AND l.phone IS NOT NULL
      AND LENGTH(REGEXP_REPLACE(l.phone, '[^0-9]', '', 'g')) >= 10
  ),
  engaged_norm AS (
    SELECT
      DISTINCT assigned_to,
      RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) AS phone10
    FROM leads
    WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
      AND custom_fields->>'legacy_crm_id' IS NOT NULL
      AND assigned_to IS NOT NULL
      AND deleted_at IS NULL
      AND phone IS NOT NULL
      AND LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) >= 10
  ),
  ranked AS (
    SELECT
      a.id,
      e.assigned_to,
      ROW_NUMBER() OVER (PARTITION BY a.id ORDER BY e.assigned_to) AS rn
    FROM agentics_norm a
    JOIN engaged_norm e ON a.phone10 = e.phone10
  ),
  assignments AS (
    SELECT id, assigned_to FROM ranked WHERE rn = 1
  )
  UPDATE leads l
  SET assigned_to = a.assigned_to
  FROM assignments a
  WHERE l.id = a.id
    AND l.assigned_to IS NULL;

  GET DIAGNOSTICS v_part_a_rows = ROW_COUNT;
  RAISE NOTICE 'Part A: rows updated=%', v_part_a_rows;

  -- Report counsellor distribution
  RAISE NOTICE 'Part A counsellor distribution (expect Amit≈48, Nikhil≈34, Gautam≈33, Diplov≈30):';
END $$;

-- Report Part A distribution (separate query for visibility)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tu.user_id, au.email, COUNT(*) AS cnt
    FROM leads l
    JOIN tenant_users tu ON tu.user_id = l.assigned_to AND tu.tenant_id = l.tenant_id
    JOIN auth.users au ON au.id = tu.user_id
    WHERE l.tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
      AND l.custom_fields->>'import_batch' = 'agentics-2026-06-24'
      AND l.assigned_to IS NOT NULL
      AND l.deleted_at IS NULL
    GROUP BY tu.user_id, au.email
    ORDER BY cnt DESC
  LOOP
    RAISE NOTICE '  counsellor: % (%) — leads: %', r.email, r.user_id, r.cnt;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Part B: Tele-call assignment (≈10 leads, minus any overlapping with A)
-- For each remaining unassigned Agentics lead that has a tele-call activity
-- (import_batch='admizz-activities-2026-06-25', subject='Tele-call remark',
-- non-admin user), set assigned_to = that activity's user_id (earliest call).
-- Admin fallback user excluded: bfff9897-3ab4-4e94-90d8-e0517528edf6
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_part_b_rows INTEGER;
BEGIN
  WITH tele_calls AS (
    SELECT
      la.lead_id,
      la.user_id,
      ROW_NUMBER() OVER (PARTITION BY la.lead_id ORDER BY la.created_at) AS rn
    FROM lead_activities la
    WHERE la.metadata->>'import_batch' = 'admizz-activities-2026-06-25'
      AND la.subject = 'Tele-call remark'
      AND la.user_id IS NOT NULL
      AND la.user_id != 'bfff9897-3ab4-4e94-90d8-e0517528edf6'
  ),
  earliest_caller AS (
    SELECT lead_id, user_id FROM tele_calls WHERE rn = 1
  )
  UPDATE leads l
  SET assigned_to = ec.user_id
  FROM earliest_caller ec
  WHERE l.id = ec.lead_id
    AND l.tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
    AND l.custom_fields->>'import_batch' = 'agentics-2026-06-24'
    AND l.deleted_at IS NULL
    AND l.assigned_to IS NULL;

  GET DIAGNOSTICS v_part_b_rows = ROW_COUNT;
  RAISE NOTICE 'Part B: tele-call rows updated=%', v_part_b_rows;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- After counts + validation
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_total      INTEGER;
  v_assigned   INTEGER;
  v_unassigned INTEGER;
  v_invalid    INTEGER;
BEGIN
  SELECT COUNT(*), COUNT(assigned_to)
  INTO v_total, v_assigned
  FROM leads
  WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
    AND custom_fields->>'import_batch' = 'agentics-2026-06-24'
    AND deleted_at IS NULL;

  v_unassigned := v_total - v_assigned;

  RAISE NOTICE 'AFTER: total_agentics=%, assigned=%, unassigned=%',
    v_total, v_assigned, v_unassigned;

  -- Validate: no Agentics lead assigned to a user outside tenant membership
  SELECT COUNT(*) INTO v_invalid
  FROM leads l
  WHERE l.tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
    AND l.custom_fields->>'import_batch' = 'agentics-2026-06-24'
    AND l.deleted_at IS NULL
    AND l.assigned_to IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM tenant_users tu
      WHERE tu.tenant_id = l.tenant_id
        AND tu.user_id = l.assigned_to
    );

  IF v_invalid > 0 THEN
    RAISE EXCEPTION 'VALIDATION FAILED: % Agentics leads assigned to non-tenant users', v_invalid;
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: all assigned leads have valid tenant members';
  RAISE NOTICE 'Expected: assigned≈152 (145 Part A + 7 Part B), unassigned≈2334';
END $$;

COMMIT;
