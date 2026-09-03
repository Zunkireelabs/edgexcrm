-- Migration 223: grant AI to the Admizz tenant (per-tenant consent flag)
--
-- Migration 174 added tenants.ai_enabled defaulting false and required the
-- rollout order "Admizz last, and only after written client consent" (Admizz is
-- data controller for student PII; EdgeX is processor). That consent was
-- obtained in writing 2026-09-03, including disclosure of the 2026-07-17
-- historical training exposure. This is the per-tenant grant.
--
-- Env flag AI_ASSISTANT_ENABLED must ALSO be true for anything to light up
-- (see src/lib/ai/flag.ts) — that lands separately via PR #289. Either order is
-- safe: whichever applies first, the other gate keeps Orca dark.
--
-- Expected before/after: public.tenants row count UNCHANGED. Exactly 1 row
-- flipped false -> true (slug 'admizz'). Re-running is a no-op.
--
-- Rollback:
--   UPDATE public.tenants SET ai_enabled = false WHERE slug = 'admizz';
--
-- Applied: stage <date> / prod HELD

BEGIN;

DO $$
DECLARE
  before_count int;
  after_count  int;
  matched      int;
BEGIN
  SELECT count(*) INTO before_count FROM public.tenants WHERE ai_enabled;
  SELECT count(*) INTO matched      FROM public.tenants WHERE slug = 'admizz';

  IF matched <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 tenant with slug=admizz, found %', matched;
  END IF;

  UPDATE public.tenants
     SET ai_enabled = true
   WHERE slug = 'admizz'
     AND ai_enabled IS DISTINCT FROM true;   -- guard: re-run is a no-op

  SELECT count(*) INTO after_count FROM public.tenants WHERE ai_enabled;
  RAISE NOTICE 'ai_enabled tenants: % -> %', before_count, after_count;
END $$;

INSERT INTO public.schema_migrations (version) VALUES ('223_admizz_ai_enabled.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
