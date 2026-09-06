-- Migration 225: seed system positions for it_agency tenants + behaviour-neutral backfill
--
-- WHY: 030_positions.sql seeds positions only WHERE industry_id = 'education_consultancy',
-- so it_agency tenants (Zunkiree Labs, Mobilise) have ZERO rows in `positions`. Consequences:
--   1. POST /api/v1/invites requires a resolvable position_id and 404s -> nobody can be invited.
--   2. team-management.tsx renders the change-role control only when assignablePositions.length > 0
--      -> access can never be changed, and no scoped non-admin can be constructed to test against.
-- This migration seeds five system positions per it_agency tenant and backfills existing
-- tenant_users onto them by current role. It is STRICTLY BEHAVIOUR-NEUTRAL:
--   - tenant_users.role is LEFT UNCHANGED (role is a denormalized shadow of the position;
--     only position_id is populated here).
--   - Every seeded permissions blob uses {"mode":"all"} for nav / pipelines / dashboard.widgets,
--     matching what a position-less member resolves to today (permissions.ts:66-83). Education's
--     restricted widget allowlists are deliberately NOT copied.
--   - Team Member (leadScope "own") carries canManageApplications/canManageClasses = true to match
--     a position-less counselor's defaults (permissions.ts:77-78). canEditLeads is omitted because
--     the resolver forces it true for own-scope (permissions.ts:96).
--   - Viewer (leadScope "all") carries no capability flags -> matches a position-less viewer.
--
-- FORWARD-LOOKING KEYS (not a typo): the Delivery Lead seed carries canManageProjects,
-- canApproveTime, canManageBilling. Those keys do not exist on PositionPermissions until Phase C.
-- `permissions` is JSONB and resolvePermissions ignores unknown keys, so seeding them now lets
-- Phase C activate them with NO second migration.
--
-- Additive only. Wrap in BEGIN/COMMIT. Idempotent (INSERT ... ON CONFLICT DO NOTHING;
-- UPDATE guarded by position_id IS NULL).
--   Expected before/after row counts:
--     positions (it_agency tenants): 0 -> 5 per tenant.
--     tenant_users.position_id IS NOT NULL (it_agency tenants): 0 -> N (all existing rows
--       whose role is one of owner/admin/counselor/viewer).
--     tenant_users.role: UNCHANGED (0 rows touched).
--   Rollback:
--     UPDATE tenant_users tu SET position_id = NULL
--       FROM positions p JOIN tenants t ON t.id = p.tenant_id
--       WHERE p.id = tu.position_id AND t.industry_id = 'it_agency' AND p.is_system;
--     DELETE FROM positions p USING tenants t
--       WHERE t.id = p.tenant_id AND t.industry_id = 'it_agency' AND p.is_system;
--   Applied: stage <PENDING> / prod HELD.

BEGIN;

DO $$
DECLARE
  pos_before  int;
  pos_after   int;
  tu_before   int;
  tu_after    int;
BEGIN
  SELECT count(*) INTO pos_before
  FROM positions p JOIN tenants t ON t.id = p.tenant_id
  WHERE t.industry_id = 'it_agency';

  SELECT count(*) INTO tu_before
  FROM tenant_users tu JOIN tenants t ON t.id = tu.tenant_id
  WHERE t.industry_id = 'it_agency' AND tu.position_id IS NOT NULL;

  -- ── Seed five system positions for every it_agency tenant ──
  -- permissions JSONB shape is documented in src/lib/api/permissions.ts (PositionPermissions).
  INSERT INTO positions (tenant_id, name, slug, base_tier, is_system, permissions)
  SELECT t.id, v.name, v.slug, v.base_tier, true, v.permissions::jsonb
  FROM tenants t
  CROSS JOIN (VALUES
    ('Owner',         'owner',         'owner',
      '{"nav":{"mode":"all"},"pipelines":{"mode":"all"},"leadScope":"all","dashboard":{"widgets":{"mode":"all"}}}'),
    ('Admin',         'admin',         'admin',
      '{"nav":{"mode":"all"},"pipelines":{"mode":"all"},"leadScope":"all","dashboard":{"widgets":{"mode":"all"}}}'),
    ('Delivery Lead', 'delivery-lead', 'member',
      '{"nav":{"mode":"all"},"pipelines":{"mode":"all"},"leadScope":"all","dashboard":{"widgets":{"mode":"all"}},"canManageProjects":true,"canApproveTime":true,"canManageBilling":true,"canAssignLeads":true,"canEditLeads":true}'),
    ('Team Member',   'team-member',   'member',
      '{"nav":{"mode":"all"},"pipelines":{"mode":"all"},"leadScope":"own","dashboard":{"widgets":{"mode":"all"}},"canManageApplications":true,"canManageClasses":true}'),
    ('Viewer',        'viewer',        'member',
      '{"nav":{"mode":"all"},"pipelines":{"mode":"all"},"leadScope":"all","dashboard":{"widgets":{"mode":"all"}}}')
  ) AS v(name, slug, base_tier, permissions)
  WHERE t.industry_id = 'it_agency'
  ON CONFLICT (tenant_id, slug) DO NOTHING;

  -- ── Backfill existing it_agency members onto the matching system position ──
  -- Maps tenant_users.role -> positions.slug. role itself is left UNCHANGED.
  --   owner -> owner, admin -> admin, counselor -> team-member, viewer -> viewer
  -- Counselors MUST land on 'team-member' (leadScope "own") — this is the one place a
  -- bug would silently widen lead access. Verify after applying.
  UPDATE tenant_users tu
  SET position_id = p.id
  FROM positions p, tenants t
  WHERE tu.tenant_id = t.id
    AND t.industry_id = 'it_agency'
    AND p.tenant_id = tu.tenant_id
    AND p.slug = CASE tu.role
                   WHEN 'owner'     THEN 'owner'
                   WHEN 'admin'     THEN 'admin'
                   WHEN 'counselor' THEN 'team-member'
                   WHEN 'viewer'    THEN 'viewer'
                 END
    AND tu.position_id IS NULL;

  SELECT count(*) INTO pos_after
  FROM positions p JOIN tenants t ON t.id = p.tenant_id
  WHERE t.industry_id = 'it_agency';

  SELECT count(*) INTO tu_after
  FROM tenant_users tu JOIN tenants t ON t.id = tu.tenant_id
  WHERE t.industry_id = 'it_agency' AND tu.position_id IS NOT NULL;

  RAISE NOTICE 'it_agency positions: % -> %', pos_before, pos_after;
  RAISE NOTICE 'it_agency tenant_users with position_id: % -> %', tu_before, tu_after;
END $$;

INSERT INTO public.schema_migrations (version) VALUES ('225_it_agency_positions.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
