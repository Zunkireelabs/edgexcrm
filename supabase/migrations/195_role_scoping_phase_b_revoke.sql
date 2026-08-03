-- Migration 195: role-scoping Phase B — the revoke + RPC branch-scope fix
--
-- Sequence: Phase A (#354, mig-free — client-side only) -> isolation tests (#355) -> this.
-- This is the step that closes the exposure: anon/authenticated lose direct `public`
-- schema table access (a logged-in user's JWT could otherwise read their whole tenant
-- straight from PostgREST, bypassing app-layer role/branch scoping). SECURITY DEFINER
-- RPCs (leads_visible_to_user, lead_aggregates) are unaffected — they read as `postgres`
-- regardless of caller table privilege, only EXECUTE grants gate them (untouched here).
--
-- Also folds in a real vulnerability found while writing this: leads_visible_to_user's
-- branch-scope arm grants visibility to ANY tenant_users member of the target branch,
-- not just members whose position actually carries branch-manager (leadScope:'team')
-- authority. A counselor (app-restricted to 'own') could call the RPC directly with
-- p_scope='branch' and their own branch_id and receive the whole branch. Fixed by
-- mirroring the app-side gate (src/lib/api/permissions.ts leadQueryScope: branch scope
-- only applies when the caller's resolved leadScope === 'team') inside the function.
--
-- Additive/idempotent DDL only (REVOKE/GRANT/ALTER DEFAULT PRIVILEGES are all safe to
-- re-run; CREATE OR REPLACE FUNCTION is idempotent by nature). 0 data rows touched.
--   Expected before/after grant counts: see report — anon/authenticated role_table_grants
--   drop to 0 rows each except authenticated keeps exactly 1 (SELECT on public.messages).
--   Rollback: re-grant broadly —
--     GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--       ON ALL TABLES IN SCHEMA public TO anon, authenticated;
--     ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--       GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--       ON TABLES TO anon, authenticated;
--     -- and revert the function body to the pre-195 version (migration 179).
--   Applied: stage <YYYY-MM-DD> / prod HELD.

BEGIN;

-- ── 1. Revoke direct public-schema table access from anon + authenticated ──
-- Matches the app's own findings: after Phase A, no remaining `createClient()` site
-- (RLS-context client) does a direct table read — all are RPC-only or auth-only.
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;

-- ── 2. Re-grant the one table that needs it: Inbox realtime ──
-- supabase_realtime publication contains only public.messages (verified stage + prod).
GRANT SELECT ON public.messages TO authenticated;

-- ── 3. Stop new tables from silently reopening the hole ──
-- All public-schema tables are owned/created by role `postgres` (migrations run as
-- postgres) — default privileges are keyed by the creating role, so this is the one
-- that matters for anything this migration pipeline creates going forward.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLES FROM anon, authenticated;

-- ── 4. RPC branch-scope fix ──
-- Branch scope now requires the caller to actually hold branch-manager authority
-- (position.permissions->>'leadScope' = 'team'), not just branch membership — mirrors
-- leadQueryScope() in src/lib/api/permissions.ts so the RPC and the app agree on who
-- gets branch visibility. is_tenant_admin() OR-branch stays as-is (owner/admin already
-- get unrestricted access app-side; this only defends direct RPC callers).
CREATE OR REPLACE FUNCTION public.leads_visible_to_user(
  p_tenant          uuid,
  p_user            uuid  DEFAULT NULL,
  p_scope           text  DEFAULT 'own', -- 'own' | 'branch'
  p_branch_id       uuid  DEFAULT NULL,
  p_user_branch_id  uuid  DEFAULT NULL, -- caller's own branch (cross-branch pool)
  p_cross_pool_slug text  DEFAULT NULL  -- pool list slug; NULL disables the pool clause
)
RETURNS SETOF public.leads
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT l.*
  FROM public.leads l
  WHERE l.tenant_id = p_tenant
    -- ── Fail-closed authorization (DEFINER bypasses RLS) ──
    AND EXISTS (SELECT 1 FROM public.tenant_users me
                WHERE me.user_id = auth.uid() AND me.tenant_id = p_tenant)
    AND (
      (p_scope = 'own' AND p_user = auth.uid())
      OR (p_scope = 'branch' AND p_branch_id IS NOT NULL AND (
            public.is_tenant_admin(p_tenant)
            OR EXISTS (SELECT 1 FROM public.tenant_users me
                       JOIN public.positions pos ON pos.id = me.position_id
                       WHERE me.user_id = auth.uid() AND me.tenant_id = p_tenant
                         AND me.branch_id = p_branch_id
                         AND pos.permissions->>'leadScope' = 'team')))
    )
    -- ── Visibility predicate (mirrors current getLeads OR-logic, UNCAPPED) ──
    AND (
      (p_scope = 'own' AND (
            l.assigned_to = p_user
        OR  EXISTS (SELECT 1 FROM public.lead_collaborators lc
                    WHERE lc.lead_id = l.id AND lc.user_id = p_user AND lc.tenant_id = p_tenant)
        OR  EXISTS (SELECT 1 FROM public.lead_branches lb
                    WHERE lb.lead_id = l.id AND lb.assigned_to = p_user AND lb.tenant_id = p_tenant)
        OR  (p_cross_pool_slug IS NOT NULL AND p_user_branch_id IS NOT NULL
             AND l.assigned_to IS NULL
             AND l.list_id IN (SELECT id FROM public.lead_lists
                               WHERE tenant_id = p_tenant AND slug = p_cross_pool_slug)
             AND EXISTS (SELECT 1 FROM public.lead_branches lb
                         WHERE lb.lead_id = l.id AND lb.tenant_id = p_tenant
                           AND lb.branch_id = p_user_branch_id
                           AND lb.assigned_to IS NULL AND lb.is_origin = false))
      ))
      OR
      (p_scope = 'branch' AND (
            EXISTS (SELECT 1 FROM public.tenant_users tu
                    WHERE tu.tenant_id = p_tenant AND tu.branch_id = p_branch_id
                      AND tu.user_id = l.assigned_to)
        OR  (l.assigned_to IS NULL AND l.branch_id = p_branch_id)
        OR  EXISTS (SELECT 1 FROM public.lead_branches lb
                    WHERE lb.lead_id = l.id AND lb.branch_id = p_branch_id AND lb.tenant_id = p_tenant)
      ))
    );
$$;

GRANT EXECUTE ON FUNCTION public.leads_visible_to_user(uuid,uuid,text,uuid,uuid,text) TO authenticated;

INSERT INTO public.schema_migrations (version) VALUES ('195_role_scoping_phase_b_revoke.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
