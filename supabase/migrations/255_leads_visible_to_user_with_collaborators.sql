-- Migration 255: leads_visible_to_user_with_collaborators() — the Collaborators filter for scoped users, in SQL.
--
-- Why: branch managers and counselors read leads through the leads_visible_to_user() RPC (migration 179).
-- The Collaborators filter used to be applied on top of that RPC as a PostgREST *embedded-resource*
-- filter (`lead_collaborators!inner(user_id)` + `lead_collaborators.user_id.in.(…)`). PostgREST resolves a
-- filter on an embedded table against the RPC's own `pgrst_call` alias instead of the joined table, so the
-- request fails with 42703 "column pgrst_call.user_id does not exist" and the whole list 503s
-- ("Failed to fetch leads"). First seen in prod 2026-08-25; the count-only workaround (#446) never covered
-- the data request, and it does not help on every PostgREST version (reproduced on the dev project with a
-- plain data request — no count at all — and on prod by a branch manager applying the filter).
-- Every spelling of an embedded filter over an RPC base fails the same way, so the filter has to move into SQL.
--
-- What it does: returns exactly the rows leads_visible_to_user() returns for the same arguments, narrowed to
-- leads that have at least one of the given collaborators (the same semantics as the old embed filter:
-- "Collaborators is any of …"). It CALLS leads_visible_to_user() — it does not re-implement or widen
-- visibility, so every scoping rule (own / branch / cross-branch pool) and its fail-closed auth.uid() gate
-- still applies unchanged. SECURITY INVOKER (the default): the extra lead_collaborators read runs as the
-- caller under that table's RLS (tenant members only, migration 090/212), plus an explicit tenant_id match.
--
-- Additive only: a NEW function under a NEW name. leads_visible_to_user() and every other function are
-- untouched, and no table, column, policy or row changes (no overload risk either — different name).
--   Expected before/after row counts: 0 rows touched (function DDL only).
--   Rollback: DROP FUNCTION IF EXISTS public.leads_visible_to_user_with_collaborators(uuid[],uuid,uuid,text,uuid,uuid,text);
--             (the app falls back to the old embed filter only if the code that calls it is also reverted.)
--   Applied: stage <PENDING> / prod HELD.

BEGIN;

CREATE OR REPLACE FUNCTION public.leads_visible_to_user_with_collaborators(
  p_collaborator_ids uuid[],
  p_tenant           uuid,
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
  WHERE  EXISTS (
           SELECT 1
           FROM   public.lead_collaborators lc
           WHERE  lc.lead_id   = l.id
             AND  lc.tenant_id = p_tenant
             AND  lc.user_id   = ANY (p_collaborator_ids)
         );
$$;

GRANT EXECUTE ON FUNCTION public.leads_visible_to_user_with_collaborators(uuid[],uuid,uuid,text,uuid,uuid,text) TO authenticated;

INSERT INTO public.schema_migrations (version) VALUES ('255_leads_visible_to_user_with_collaborators.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
