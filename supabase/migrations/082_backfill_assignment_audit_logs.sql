-- Migration 082: Backfill assignment timeline events for all assigned Admizz leads
-- Tenant: Admizz Education (febeb37c-521c-4f29-adbb-0195b2eede88)
-- Inserts one audit_logs row per assigned lead that has no existing assignment event.
-- The NOT EXISTS guard makes this fully idempotent (re-run inserts 0 rows).

BEGIN;

DO $$
DECLARE
  v_before INTEGER;
  v_inserted INTEGER;
  v_after INTEGER;
  v_owner_id UUID;
BEGIN
  -- Resolve owner user_id for admizzdotcom2020@gmail.com (the tenant admin)
  SELECT tu.user_id INTO v_owner_id
  FROM tenant_users tu
  JOIN auth.users u ON u.id = tu.user_id
  WHERE tu.tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
    AND u.email = 'admizzdotcom2020@gmail.com'
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Owner user admizzdotcom2020@gmail.com not found in tenant';
  END IF;

  RAISE NOTICE 'Owner user_id=%', v_owner_id;

  -- Before count: how many assigned leads currently have NO assignment audit event
  SELECT COUNT(*) INTO v_before
  FROM leads l
  WHERE l.tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
    AND l.deleted_at IS NULL
    AND l.assigned_to IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM audit_logs a
      WHERE a.entity_id = l.id
        AND a.entity_type = 'lead'
        AND a.tenant_id = l.tenant_id
        AND a.changes ? 'assigned_to'
    );

  RAISE NOTICE 'BEFORE: assigned leads without assignment audit event=%', v_before;

  -- Insert backfill rows
  INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, changes, created_at)
  SELECT
    gen_random_uuid(),
    l.tenant_id,
    v_owner_id,
    'lead.updated',
    'lead',
    l.id,
    jsonb_build_object(
      'assigned_to', jsonb_build_object(
        'old', null,
        'new', l.assigned_to::text
      )
    ),
    l.created_at
  FROM leads l
  WHERE l.tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
    AND l.deleted_at IS NULL
    AND l.assigned_to IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM audit_logs a
      WHERE a.entity_id = l.id
        AND a.entity_type = 'lead'
        AND a.tenant_id = l.tenant_id
        AND a.changes ? 'assigned_to'
    );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE 'INSERTED: % assignment audit rows', v_inserted;

  -- After count: verify all assigned leads now have an assignment event
  SELECT COUNT(*) INTO v_after
  FROM leads l
  WHERE l.tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
    AND l.deleted_at IS NULL
    AND l.assigned_to IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM audit_logs a
      WHERE a.entity_id = l.id
        AND a.entity_type = 'lead'
        AND a.tenant_id = l.tenant_id
        AND a.changes ? 'assigned_to'
    );

  RAISE NOTICE 'AFTER: assigned leads still without assignment audit event=%', v_after;

  IF v_after > 0 THEN
    RAISE EXCEPTION 'VALIDATION FAILED: % assigned leads still lack an assignment audit event', v_after;
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: all assigned leads have assignment audit events';
END $$;

COMMIT;
