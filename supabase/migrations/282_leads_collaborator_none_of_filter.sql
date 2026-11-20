-- Migration 282: Collaborators filter "is none of" — two NEW functions that narrow the lead set by collaborator,
-- including EXCLUSION ("leads where none of these people is a collaborator").
--
-- Why: client request (Manish / Admizz, Nov 2026) — the leads Collaborators filter only offers "is any of /
-- is empty / is not empty"; they need "is not of" to hide specific people's leads. It was left out on purpose:
-- an exclusion cannot be expressed as a PostgREST embedded-resource filter (an `!inner` join + not.in means
-- "has SOME collaborator who isn't X", not "has none of X"), and an embedded filter over an RPC base 503s anyway
-- (42703 pgrst_call — see migration 255). So, like 255, the filter moves into SQL.
--
-- What they do — both take an optional include list and an optional exclude list (NULL or empty = no constraint):
--   include: lead has AT LEAST ONE of these collaborators      (the existing "is any of" meaning)
--   exclude: lead has NONE of these collaborators              (NEW; leads with no collaborators at all qualify)
--
--   1) leads_visible_to_user_with_collaborator_filter(...) — own / branch scope (branch managers, counselors).
--      CALLS leads_visible_to_user() exactly like migration 255 does — it does not re-implement or widen visibility,
--      so every scoping rule and its fail-closed auth.uid() gate still applies. SECURITY INVOKER. Same GRANT shape as 255.
--   2) leads_for_tenant_with_collaborator_filter(...) — owner/admin (unrestricted) scope: every lead in ONE tenant
--      (explicit tenant_id match). The app calls it only through the service-role client, so EXECUTE is granted to
--      service_role ONLY (revoked from PUBLIC/anon/authenticated). Defence in depth: SECURITY INVOKER, and migration 195
--      already revoked SELECT on leads from `authenticated`, so even a direct call by a logged-in user would fail.
--
-- Argument order: required p_tenant first, every other argument defaulted, so the app can OMIT unused ones
-- (never send an explicit null — see src/lib/leads/visibility-query.ts).
--
-- Additive only: two NEW function names. leads_visible_to_user(), leads_visible_to_user_with_collaborators() and every
-- other function are untouched; no table, column, policy, trigger or row changes. The app calls these ONLY when a
-- request contains an "is none of" collaborator condition — every other request keeps its current code path.
--   Expected before/after row counts: 0 rows touched (function DDL only).
--   Rollback: DROP FUNCTION IF EXISTS public.leads_visible_to_user_with_collaborator_filter(uuid,uuid[],uuid[],uuid,text,uuid,uuid,text);
--             DROP FUNCTION IF EXISTS public.leads_for_tenant_with_collaborator_filter(uuid,uuid[],uuid[]);
--             (the "is not of" option errors cleanly (422) only if the code that calls them is also reverted.)
--   Applied: stage <PENDING> / prod HELD.

BEGIN;

CREATE OR REPLACE FUNCTION public.leads_visible_to_user_with_collaborator_filter(
  p_tenant           uuid,
  p_include_ids      uuid[] DEFAULT NULL,
  p_exclude_ids      uuid[] DEFAULT NULL,
  p_user             uuid  DEFAULT NULL,
  p_scope            text  DEFAULT 'own', -- 'own' | 'branch' — passed straight through
  p_branch_id        uuid  DEFAULT NULL,
  p_user_branch_id   uuid  DEFAULT NULL,
  p_cross_pool_slug  text  DEFAULT NULL
)
RETURNS SETOF public.leads
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT l.*
  FROM   public.leads_visible_to_user(
           p_tenant, p_user, p_scope, p_branch_id, p_user_branch_id, p_cross_pool_slug
         ) l
  WHERE  (
           p_include_ids IS NULL OR cardinality(p_include_ids) = 0
           OR EXISTS (
                SELECT 1 FROM public.lead_collaborators lc
                WHERE  lc.lead_id = l.id AND lc.tenant_id = p_tenant AND lc.user_id = ANY (p_include_ids)
              )
         )
    AND  (
           p_exclude_ids IS NULL OR cardinality(p_exclude_ids) = 0
           OR NOT EXISTS (
                SELECT 1 FROM public.lead_collaborators lc
                WHERE  lc.lead_id = l.id AND lc.tenant_id = p_tenant AND lc.user_id = ANY (p_exclude_ids)
              )
         );
$$;

GRANT EXECUTE ON FUNCTION public.leads_visible_to_user_with_collaborator_filter(uuid,uuid[],uuid[],uuid,text,uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.leads_for_tenant_with_collaborator_filter(
  p_tenant      uuid,
  p_include_ids uuid[] DEFAULT NULL,
  p_exclude_ids uuid[] DEFAULT NULL
)
RETURNS SETOF public.leads
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT l.*
  FROM   public.leads l
  WHERE  l.tenant_id = p_tenant
    AND  (
           p_include_ids IS NULL OR cardinality(p_include_ids) = 0
           OR EXISTS (
                SELECT 1 FROM public.lead_collaborators lc
                WHERE  lc.lead_id = l.id AND lc.tenant_id = p_tenant AND lc.user_id = ANY (p_include_ids)
              )
         )
    AND  (
           p_exclude_ids IS NULL OR cardinality(p_exclude_ids) = 0
           OR NOT EXISTS (
                SELECT 1 FROM public.lead_collaborators lc
                WHERE  lc.lead_id = l.id AND lc.tenant_id = p_tenant AND lc.user_id = ANY (p_exclude_ids)
              )
         );
$$;

-- Service-role only: Supabase's default privileges grant EXECUTE on new public functions to anon + authenticated,
-- so revoke those explicitly (REVOKE FROM PUBLIC alone does not remove role-specific default grants).
REVOKE ALL ON FUNCTION public.leads_for_tenant_with_collaborator_filter(uuid,uuid[],uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leads_for_tenant_with_collaborator_filter(uuid,uuid[],uuid[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leads_for_tenant_with_collaborator_filter(uuid,uuid[],uuid[]) TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('282_leads_collaborator_none_of_filter.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
