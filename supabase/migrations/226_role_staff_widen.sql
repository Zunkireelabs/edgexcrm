-- Migration 226: widen the role CHECK constraints to accept BOTH 'counselor' and 'staff'
--
-- WHY: Phase B of the it_agency role rename renames the tenant_users.role VALUE
-- "counselor" -> "staff" (the access tier "a member scoped to their own leads").
-- It does NOT touch positions.slug — Admizz's "Counselor" JOB TITLE stays as-is.
--
-- This migration is the first of two:
--   B1 (this file, 226): widen both CHECK constraints to accept 'counselor' OR 'staff'.
--     NO DATA IS CHANGED HERE. Application code (this same PR) starts writing 'staff'
--     for new member+own rows and normalizes any legacy 'counselor' row to 'staff' on
--     read (normalizeRole() at the five DB read boundaries).
--   B2 (later, 227): UPDATE the legacy 'counselor' rows -> 'staff', then narrow the
--     constraints to drop 'counselor'.
--
-- Original constraints:
--   tenant_users_role_check  — 001_initial_schema.sql:23, re-defined 003_phase2a_saas_ops.sql:27
--     CHECK (role IN ('owner','admin','viewer','counselor'))
--   invite_tokens_role_check — 003_phase2a_saas_ops.sql:35 (inline, auto-named)
--     CHECK (role IN ('admin','viewer','counselor'))
--
-- Additive only. Reversible. Wrapped in BEGIN/COMMIT. Idempotent (DROP ... IF EXISTS
-- + ADD with a fixed name; re-run replaces with the identical definition).
--   Expected before/after row counts: 0 rows touched in both tables.
--   RAISE NOTICE logs the current 'counselor' row count in both tables so B2 has the
--   real number to check its backfill against.
--   Rollback:
--     ALTER TABLE tenant_users DROP CONSTRAINT IF EXISTS tenant_users_role_check;
--     ALTER TABLE tenant_users ADD CONSTRAINT tenant_users_role_check
--       CHECK (role IN ('owner','admin','viewer','counselor'));
--     ALTER TABLE invite_tokens DROP CONSTRAINT IF EXISTS invite_tokens_role_check;
--     ALTER TABLE invite_tokens ADD CONSTRAINT invite_tokens_role_check
--       CHECK (role IN ('admin','viewer','counselor'));
--     (safe only while no 'staff' rows exist yet — true at B1 deploy time.)
--   Applied: stage <PENDING> / prod HELD.

BEGIN;

ALTER TABLE tenant_users DROP CONSTRAINT IF EXISTS tenant_users_role_check;
ALTER TABLE tenant_users ADD CONSTRAINT tenant_users_role_check
  CHECK (role IN ('owner', 'admin', 'viewer', 'counselor', 'staff'));

ALTER TABLE invite_tokens DROP CONSTRAINT IF EXISTS invite_tokens_role_check;
ALTER TABLE invite_tokens ADD CONSTRAINT invite_tokens_role_check
  CHECK (role IN ('admin', 'viewer', 'counselor', 'staff'));

-- Post-condition: exactly ONE role CHECK per table. invite_tokens.role's original
-- constraint was inline + auto-named (003_phase2a_saas_ops.sql:35). If Postgres
-- named it anything other than `invite_tokens_role_check`, the DROP above was a
-- no-op, the ADD landed under a free name, and the table now carries TWO role
-- checks — the surviving old one still rejecting 'staff'. Fail the migrate job
-- here instead of shipping a latent 500 on the first own-scope invite.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'invite_tokens'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%role%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'mig 226: expected exactly 1 role check on invite_tokens, found %', n;
  END IF;

  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'tenant_users'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%role%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'mig 226: expected exactly 1 role check on tenant_users, found %', n;
  END IF;
END $$;

DO $$
DECLARE
  tu_counselor  int;
  it_counselor  int;
BEGIN
  SELECT count(*) INTO tu_counselor FROM tenant_users  WHERE role = 'counselor';
  SELECT count(*) INTO it_counselor FROM invite_tokens WHERE role = 'counselor';
  RAISE NOTICE 'mig 226: tenant_users.role = counselor: % row(s)', tu_counselor;
  RAISE NOTICE 'mig 226: invite_tokens.role = counselor: % row(s)', it_counselor;
END $$;

INSERT INTO public.schema_migrations (version) VALUES ('226_role_staff_widen.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
