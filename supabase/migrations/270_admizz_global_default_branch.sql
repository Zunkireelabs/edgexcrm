-- Migration 270: Admizz "Global" branch becomes the tenant's DEFAULT branch
--
-- New leads (public forms, integrations, anything without an explicit/own branch) are attributed to
-- the tenant's default branch (migration 060 made that KTM). Admizz wants a dedicated inbox that is
-- not a working branch: a new "Global" branch, owned/admin-visible only (no members), which becomes
-- the default. A Global lead moves to the assignee's branch when it is assigned (application code).
--
-- THIS MIGRATION TOUCHES ONLY THE branches TABLE. It never reads or writes leads, lead_branches or
-- tenant_users — every existing lead (including those in KTM) stays exactly where it is.
--
-- Only Admizz (tenant slug 'admizz'). Idempotent: safe to re-run; does nothing if the tenant is
-- missing (e.g. a fresh local DB) or Global is already the default.
--
-- Order matters: uniq_branches_default_per_tenant (migration 060) allows ONE default per tenant, so
-- the old default is cleared and Global is set in the same transaction.
--
-- Expected before/after (branches for admizz): +1 row ('Global'), exactly one is_default = true,
--   and it is Global; leads: unchanged.
-- Rollback:
--   UPDATE branches SET is_default = true  WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'admizz') AND slug ILIKE 'ktm%';
--   -- (set KTM back first only AFTER clearing Global:)
--   -- UPDATE branches SET is_default = false WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'admizz') AND slug = 'global';
--   -- then re-run the first statement. Deleting the Global branch is optional and safe only while no lead points at it.
-- Applied: stage HELD (rides deploy-staging.yml) / prod HELD (rides the production-db approval gate).

BEGIN;

DO $$
DECLARE
  v_tenant UUID;
  v_global UUID;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE slug = 'admizz' LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE NOTICE 'admizz tenant not found — nothing to do';
    RETURN;
  END IF;

  -- 1. The Global branch (no manager, no members). sort_order -1 keeps it first in lists.
  INSERT INTO branches (tenant_id, name, slug, sort_order)
  VALUES (v_tenant, 'Global', 'global', -1)
  ON CONFLICT (tenant_id, slug) DO NOTHING;

  SELECT id INTO v_global FROM branches WHERE tenant_id = v_tenant AND slug = 'global';

  -- 2. Hand over the default flag: clear the old one first (one default per tenant), then set Global.
  UPDATE branches SET is_default = false
   WHERE tenant_id = v_tenant AND is_default = true AND id <> v_global;
  UPDATE branches SET is_default = true
   WHERE id = v_global AND is_default = false;
END $$;

INSERT INTO public.schema_migrations (version) VALUES ('270_admizz_global_default_branch.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
