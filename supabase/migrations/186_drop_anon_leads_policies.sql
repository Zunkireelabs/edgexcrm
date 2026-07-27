-- 180: Remove permissive TO anon policies on leads.
-- These date to 001_initial_schema.sql; their names imply session-scoping but
-- their bodies are `true`, so the PUBLIC anon key (inlined in the client
-- bundle) could read/update/insert leads across ALL tenants.
-- Vestigial: public submit runs on the service-role client, and no browser
-- code touches the leads table. Nothing in the app loses access.
--
-- ROLLBACK:
--   CREATE POLICY "Anon can read own session leads" ON leads FOR SELECT TO anon USING (true);
--   CREATE POLICY "Anon can update own session"     ON leads FOR UPDATE TO anon USING (true) WITH CHECK (true);
--   CREATE POLICY "Anon can insert leads"           ON leads FOR INSERT TO anon WITH CHECK (true);
--   GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO anon;

BEGIN;

-- BEFORE: expect 6 policies on leads, 3 of them TO anon
SELECT count(*) AS policies_before FROM pg_policies WHERE schemaname='public' AND tablename='leads';

DROP POLICY IF EXISTS "Anon can read own session leads" ON leads;
DROP POLICY IF EXISTS "Anon can update own session"     ON leads;
DROP POLICY IF EXISTS "Anon can insert leads"           ON leads;

-- Defense in depth: with no anon policies, RLS already denies everything, but
-- removing the table grant means a future policy added TO anon can't silently
-- re-open the door. Precedent: 123_schema_migrations.sql.
-- anon ONLY — authenticated grants are untouched.
REVOKE ALL ON public.leads FROM anon;

-- AFTER: expect 3 policies, 0 of them TO anon
SELECT count(*) AS policies_after FROM pg_policies WHERE schemaname='public' AND tablename='leads';
SELECT count(*) AS anon_policies_after FROM pg_policies
  WHERE schemaname='public' AND tablename='leads' AND 'anon' = ANY(roles);

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('186_drop_anon_leads_policies.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
