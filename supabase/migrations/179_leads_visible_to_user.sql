-- Migration 179: leads_visible_to_user() — uncapped counselor/branch lead visibility
--
-- Additive only (new function + grant). Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: 0 rows touched (function DDL only).
--   Rollback: DROP FUNCTION IF EXISTS public.leads_visible_to_user(uuid,uuid,text,uuid,uuid,text);
--   Applied: stage <YYYY-MM-DD> / prod HELD.

BEGIN;

-- NOTE (added during Step-0 POC verification, not in the original brief draft):
-- p_user and p_scope carry DEFAULTs too, not just the trailing params. PostgREST's
-- GET/HEAD calling convention (used whenever supabase-js is asked for {head:true} /
-- count-only, e.g. the D1 stage-count badges) serializes a JS `null` arg as the
-- literal 3-character string "null" in the query string, which fails to cast to
-- `uuid` (22P02) — it does NOT mean SQL NULL there the way it does in a JSON POST
-- body. The only reliable fix is to let callers OMIT the argument entirely for the
-- irrelevant branch (visibleLeadsBase() never sends an explicit null — see
-- src/lib/leads/visibility-query.ts), which requires every param a caller might
-- skip to have a DEFAULT. Postgres requires defaults to be trailing in the
-- declared parameter list, so p_scope also gets one to satisfy that ordering rule.
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
                       WHERE me.user_id = auth.uid() AND me.tenant_id = p_tenant
                         AND me.branch_id = p_branch_id)))
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

INSERT INTO public.schema_migrations (version) VALUES ('179_leads_visible_to_user.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
