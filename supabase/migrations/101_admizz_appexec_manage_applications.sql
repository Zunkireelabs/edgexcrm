-- Migration 101: grant Application Executive canManageApplications (Admizz).
-- Data-only (positions.permissions). Additive + idempotent. Pairs with code change
-- adding application-executive to CLASS_ENROLL_POSITIONS in src/lib/api/permissions.ts.
BEGIN;

DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '101 BEFORE:';
  FOR r IN
    SELECT p.slug, p.permissions->>'canManageApplications' AS canmanageapps
    FROM positions p JOIN tenants t ON p.tenant_id = t.id
    WHERE t.slug = 'admizz' AND p.slug = 'application-executive'
  LOOP
    RAISE NOTICE '  %: canManageApplications=%', r.slug, r.canmanageapps;
  END LOOP;
END$$;

UPDATE positions p
SET permissions = p.permissions || jsonb_build_object('canManageApplications', true),
    updated_at = now()
FROM tenants t
WHERE p.tenant_id = t.id
  AND t.slug = 'admizz'
  AND p.slug = 'application-executive';

DO $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM positions p JOIN tenants t ON p.tenant_id = t.id
  WHERE t.slug = 'admizz'
    AND p.slug = 'application-executive'
    AND p.permissions->>'canManageApplications' = 'true';
  IF v_count <> 1 THEN
    RAISE EXCEPTION '101 failed: application-executive canManageApplications not set (got %)', v_count;
  END IF;
  RAISE NOTICE '101 AFTER: application-executive canManageApplications=true';
END$$;

COMMIT;
