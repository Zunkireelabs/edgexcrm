-- Migration 224: make projects.account_id nullable (internal projects)
--
-- The it_agency delivery surface requires a project to belong to a client
-- account (020_time_tracking.sql:42 set projects.account_id NOT NULL, and
-- POST /api/v1/projects requires it). That blocks internal projects — our own
-- site, R&D, ops work — which is most of what an employee would self-start.
-- "Internal" is derived from account_id IS NULL; no new column, the Client /
-- Internal toggle is pure UI.
--
-- Exact precedent: 032_personal_tasks.sql:5 dropped NOT NULL on
-- tasks.project_id for the same "make it standalone" reason.
--
-- Additive / non-destructive. Wrap in BEGIN/COMMIT. Idempotent (DROP NOT NULL
-- is a no-op once the column is already nullable).
--   Expected before/after row counts: projects: N rows UNCHANGED (constraint
--     change only, no data touched).
--   Rollback (only safe while every projects row still has a non-null
--     account_id): ALTER TABLE projects ALTER COLUMN account_id SET NOT NULL;
--   Applied: stage <PENDING> / prod HELD.

BEGIN;

DO $$
DECLARE
  before_count int;
  after_count  int;
BEGIN
  SELECT count(*) INTO before_count FROM public.projects;

  ALTER TABLE public.projects ALTER COLUMN account_id DROP NOT NULL;

  SELECT count(*) INTO after_count FROM public.projects;
  RAISE NOTICE 'projects row count: % -> % (constraint-only change)', before_count, after_count;
END $$;

INSERT INTO public.schema_migrations (version) VALUES ('224_projects_optional_account.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
