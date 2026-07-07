-- Migration 126: give Branch Manager the Contacts sidebar item.
-- The Contacts page (education_consultancy) is now branch-scoped: every branch user sees
-- their own branch's "other"-tagged walk-in contacts; admin/owner see all branches. The
-- chain positions (lead-caller, counselor, lead-executive, application-executive) already
-- pass canSeeNav("/contacts") — lead-executive & application-executive list "/contacts"
-- explicitly, the rest run nav.mode="all". Branch Manager (nav.mode="allow") is the only
-- position whose allow-list omits "/contacts", so it alone needs the key appended.
--
-- Additive + deduped + idempotent: only appends "/contacts" if missing; touches nothing else.

BEGIN;

-- ── BEFORE snapshot ─────────────────────────────────────────────────────────
DO $$
DECLARE v_have int;
BEGIN
  SELECT COUNT(*) INTO v_have
  FROM positions
  WHERE is_system = true AND slug = 'branch-manager'
    AND permissions -> 'nav' ->> 'mode' = 'allow'
    AND (permissions -> 'nav' -> 'keys') ? '/contacts'
    AND tenant_id IN (SELECT id FROM tenants WHERE industry_id = 'education_consultancy');
  RAISE NOTICE '126 BEFORE: % branch-manager position(s) already have /contacts', v_have;
END$$;

UPDATE positions
SET permissions = jsonb_set(
  permissions,
  '{nav,keys}',
  (
    SELECT jsonb_agg(DISTINCT k)
    FROM jsonb_array_elements_text(
      COALESCE(permissions -> 'nav' -> 'keys', '[]'::jsonb) || '["/contacts"]'::jsonb
    ) AS k
  ),
  true
)
WHERE is_system = true
  AND slug = 'branch-manager'
  AND permissions -> 'nav' ->> 'mode' = 'allow'
  AND tenant_id IN (
    SELECT id FROM tenants WHERE industry_id = 'education_consultancy'
  );

-- ── AFTER verification (every education branch-manager now has /contacts) ─────
DO $$
DECLARE v_missing int;
BEGIN
  SELECT COUNT(*) INTO v_missing
  FROM positions
  WHERE is_system = true AND slug = 'branch-manager'
    AND permissions -> 'nav' ->> 'mode' = 'allow'
    AND NOT ((permissions -> 'nav' -> 'keys') ? '/contacts')
    AND tenant_id IN (SELECT id FROM tenants WHERE industry_id = 'education_consultancy');
  IF v_missing <> 0 THEN
    RAISE EXCEPTION '126 failed: % branch-manager position(s) still missing /contacts', v_missing;
  END IF;
  RAISE NOTICE '126 AFTER: all education branch-manager positions have /contacts';
END$$;

COMMIT;

-- Rollback (removes the key again):
-- UPDATE positions
-- SET permissions = jsonb_set(
--   permissions, '{nav,keys}',
--   (SELECT jsonb_agg(k) FROM jsonb_array_elements_text(permissions -> 'nav' -> 'keys') AS k WHERE k <> '/contacts'),
--   true)
-- WHERE is_system = true AND slug = 'branch-manager'
--   AND permissions -> 'nav' ->> 'mode' = 'allow'
--   AND tenant_id IN (SELECT id FROM tenants WHERE industry_id = 'education_consultancy');
