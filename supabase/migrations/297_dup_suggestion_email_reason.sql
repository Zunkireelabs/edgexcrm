-- Migration 297: allow "email" as a reason on lead_duplicate_suggestions.
--
-- When someone edits a lead's email to one another lead already has, the app now records a duplicate suggestion (reason
-- 'email') for the admins' "Possible duplicates" card, instead of staying silent. The reason column only allowed
-- 'phone' and 'name' (migration 033), so the check constraint is widened. No row changes; existing rows stay valid.
--
-- Additive only (a CHECK constraint is relaxed, never tightened).
-- Expected before/after row counts: lead_duplicate_suggestions: 0 rows touched.
-- Rollback: ALTER TABLE lead_duplicate_suggestions DROP CONSTRAINT IF EXISTS lead_duplicate_suggestions_reason_check;
--           ALTER TABLE lead_duplicate_suggestions ADD CONSTRAINT lead_duplicate_suggestions_reason_check CHECK (reason IN ('phone','name'));
--           (only valid while no 'email' rows exist)
-- Applied: stage HELD / prod HELD.

BEGIN;

ALTER TABLE public.lead_duplicate_suggestions DROP CONSTRAINT IF EXISTS lead_duplicate_suggestions_reason_check;
ALTER TABLE public.lead_duplicate_suggestions
  ADD CONSTRAINT lead_duplicate_suggestions_reason_check CHECK (reason IN ('phone', 'name', 'email'));

INSERT INTO public.schema_migrations (version) VALUES ('297_dup_suggestion_email_reason.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
