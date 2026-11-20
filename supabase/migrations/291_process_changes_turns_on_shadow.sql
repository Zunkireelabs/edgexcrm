-- Migration 291: EDGEX-109 P4a round 2 — a process change may turn smart assignment on in SHADOW mode first.
-- ROLLBACK: ALTER TABLE public.process_changes DROP CONSTRAINT IF EXISTS process_changes_turns_on_check;
--           UPDATE public.process_changes SET turns_on = NULL WHERE turns_on = 'smart_assignment_shadow';   -- only if any row uses it
--           ALTER TABLE public.process_changes ADD CONSTRAINT process_changes_turns_on_check CHECK (turns_on IS NULL OR turns_on IN ('smart_assignment_auto'));
--           (and delete this file's row from schema_migrations)
--
-- WHY: Orca proposed `smart_assignment_auto` while smart assignment was off and had never run in shadow. The mockup's change says "it runs
-- in shadow mode first", so the fixed list of Settings switches a change may point at gains `smart_assignment_shadow`. The application
-- (not this constraint) refuses `_auto` unless shadow ran 14+ days with decisions.
--
-- Additive only: the CHECK is widened, no row is touched. Before/after counts: process_changes rows unchanged; turns_on values still
-- NULL or 'smart_assignment_auto'.
--   Applied: NOT YET (written 2026-11-08).

BEGIN;

ALTER TABLE public.process_changes DROP CONSTRAINT IF EXISTS process_changes_turns_on_check;
ALTER TABLE public.process_changes
  ADD CONSTRAINT process_changes_turns_on_check CHECK (turns_on IS NULL OR turns_on IN ('smart_assignment_shadow', 'smart_assignment_auto'));

INSERT INTO public.schema_migrations (version) VALUES ('291_process_changes_turns_on_shadow.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
