-- Migration 212: re-grant SELECT on lead_collaborators to `authenticated`
--
-- Bug: the "Collaborators" leads filter (src/lib/filters/registry/leads.ts) filters via
-- a PostgREST resource embed — `lead_collaborators!inner(user_id)` added to `.select()`
-- in the leads list route — instead of a SECURITY DEFINER RPC. For any non-owner/admin
-- caller (own-scope counselor, branch-scope manager), the base query is the
-- `leads_visible_to_user()` RPC run through the RLS-context client. PostgREST composes
-- ONE outer SQL statement joining that RPC's output straight to the real
-- `lead_collaborators` table — that join executes as the connecting `authenticated`
-- role, NOT as the RPC's SECURITY DEFINER owner. Migration 195 revoked SELECT on ALL
-- public-schema tables from `authenticated` (re-granting only `public.messages`), so
-- that join hits "permission denied for table lead_collaborators" (42501), which
-- surfaces to the client as the leads route's 503 "Failed to fetch leads" the moment a
-- restricted-scope user (e.g. a branch manager) applies the Collaborators filter.
-- Confirmed live: KTM branch-manager Bijay Dahal, "Collaborators is any of: <user>" +
-- "Stage: Applications" -> "Failed to fetch leads" toast, empty table.
--
-- Owner/admin never hit this: they query via the service-role client
-- (createServiceClient()), which bypasses table grants entirely. The dropdown's own
-- "(27)"-style counts also don't hit this: getCollaboratorFacet() goes through the
-- lead_aggregates() RPC (also SECURITY DEFINER), which queries lead_collaborators from
-- inside its own function body, same bypass as leads_visible_to_user().
--
-- Fix: re-grant SELECT on lead_collaborators to `authenticated`, mirroring migration
-- 195's own precedent for `public.messages` — identify the one table a real embed/
-- realtime need requires, grant it back, and let that table's own RLS policy carry the
-- safety instead of the blanket revoke. lead_collaborators has had RLS enabled since
-- migration 090 with policy `lead_collaborators_select`: `tenant_id IN (SELECT
-- get_user_tenant_ids())` — a caller can only ever see their OWN tenant's collaborator
-- rows, so this does not reopen the cross-tenant exposure 195 closed. The embedded join
-- only ever surfaces `user_id` (already known to the caller — it's the person they
-- filtered by) scoped to leads the RPC already decided are visible to them; no new lead
-- data is exposed.
--
-- Additive/idempotent: GRANT is safe to re-run. 0 data rows touched.
--   Expected before/after grant counts: authenticated gains exactly 1 new
--   information_schema.role_table_grants row (SELECT on public.lead_collaborators).
--   Rollback: REVOKE SELECT ON public.lead_collaborators FROM authenticated;
--   Applied: stage <YYYY-MM-DD> / prod HELD.

BEGIN;

GRANT SELECT ON public.lead_collaborators TO authenticated;

INSERT INTO public.schema_migrations (version) VALUES ('212_grant_lead_collaborators_select.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
