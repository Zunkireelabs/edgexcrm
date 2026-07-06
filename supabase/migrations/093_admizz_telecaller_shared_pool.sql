-- Migration 093: Admizz "Lead TeleCaller" — Pre-qualified shared pool + assign rights
-- Education_consultancy / Admizz-specific position config (data, not schema).
-- Enables two newly-built generic capabilities for the lead-caller position:
--   1. sharedPoolListIds = [Pre-qualified] → own-scope holders see their whole BRANCH's
--      leads in the Pre-qualified intake list (shared working pool), not just their own.
--   2. canAssignLeads = true → telecallers can set a lead's assignee (branch/owner stay admin-only).
-- Additive + idempotent: re-running re-sets the same two keys.

BEGIN;

-- Before: snapshot the target row count + current permissions (additive sanity check).
DO $$
DECLARE v_before jsonb; v_count int;
BEGIN
  SELECT COUNT(*), MAX(p.permissions::text)::jsonb INTO v_count, v_before
  FROM positions p JOIN tenants t ON p.tenant_id = t.id
  WHERE t.slug = 'admizz' AND p.slug = 'lead-caller';
  RAISE NOTICE '093 BEFORE: % matching position(s); permissions=%', v_count, v_before;
END$$;

UPDATE positions p
SET permissions = p.permissions
      || jsonb_build_object('canAssignLeads', true)
      || jsonb_build_object(
           'sharedPoolListIds',
           COALESCE(
             (SELECT jsonb_agg(l.id)
                FROM lead_lists l
               WHERE l.tenant_id = p.tenant_id
                 AND l.slug = 'pre-qualified'),
             '[]'::jsonb
           )
         ),
    updated_at = now()
FROM tenants t
WHERE p.tenant_id = t.id
  AND t.slug = 'admizz'
  AND p.slug = 'lead-caller';

-- After: confirm exactly one row changed and show the resulting permissions.
DO $$
DECLARE v_after jsonb; v_count int;
BEGIN
  SELECT COUNT(*), MAX(p.permissions::text)::jsonb INTO v_count, v_after
  FROM positions p JOIN tenants t ON p.tenant_id = t.id
  WHERE t.slug = 'admizz' AND p.slug = 'lead-caller'
    AND p.permissions ? 'sharedPoolListIds' AND p.permissions ? 'canAssignLeads';
  RAISE NOTICE '093 AFTER: % position(s) now carry sharedPoolListIds+canAssignLeads; permissions=%', v_count, v_after;
  IF v_count <> 1 THEN
    RAISE EXCEPTION '093 expected exactly 1 updated lead-caller position, got %', v_count;
  END IF;
END$$;

COMMIT;
