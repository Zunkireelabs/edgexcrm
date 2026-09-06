-- Migration 227: backfill legacy `counselor` role rows -> `staff`, then narrow the
-- two role CHECK constraints to drop `counselor`.
--
-- WHY: Phase B / PR B2 — closes the it_agency role rename. B1 (mig 226) widened both
-- CHECK constraints to accept BOTH `counselor` and `staff` and taught the code to
-- write `staff` + normalize legacy rows on read. This migration flips the data and
-- removes the legacy value for good.
--
-- This does NOT touch positions.slug — Admizz's "Counselor" JOB TITLE stays as-is.
-- It also does NOT touch: the `leads-by-counselor` dashboard widget key
-- (048_dashboards.sql), the `counselor` position slug (058/030), the `counselor`
-- aggregates dimension label in the lead_aggregates RPC (migs 194/207/208), or
-- migration 225's `WHEN 'counselor' THEN 'team-member'` CASE — 225 is not on prod
-- yet and migrate-apply.sh runs migrations in numeric order, so 225 backfills
-- positions BEFORE 227 renames the role. That ordering is correct as-is.
--
-- DB-layer audit (done after B1 merged): no RLS policy, no SECURITY DEFINER
-- function, and no constraint other than the two role CHECKs compares
-- tenant_users.role / invite_tokens.role to 'counselor'. The backfill is safe at
-- the DB layer.
--
-- ORDER MATTERS INSIDE THIS FILE: UPDATE first, THEN narrow. Narrowing before the
-- backfill would fail the CHECK on the surviving 'counselor' rows.
--
-- Reference before-counts (read verbatim from B1's stage migrate log, deploy run
-- for b3e3a29e, the "Apply pending migrations" step):
--   mig 226: tenant_users.role  = counselor: 19 row(s)
--   mig 226: invite_tokens.role = counselor: 12 row(s)
-- Step 1 logs the observed 'counselor' counts next to those numbers as
-- informational output. It does NOT hard-fail on a mismatch: prod is a different
-- database (stage is a 2026-06-21 clone; the two have diverged for months), so a
-- different — including higher — count on the prod promotion is legitimate, not a
-- failure. The real guarantees are step 4 (exactly-one role check per table) and
-- step 5 (zero counselor rows remain, or RAISE). More legacy rows than expected is
-- not a hazard — the backfill converts every one of them, which is the goal.
--
-- Additive-to-data only in the sense that no row is deleted; the role VALUE is
-- rewritten in place. Wrapped in BEGIN/COMMIT. Idempotent: a re-run finds 0
-- 'counselor' rows, the UPDATEs are no-ops, and the narrowed constraints re-add to
-- the identical definition.
--
-- Rollback (only correct while NO genuinely-new `staff` rows have been written
-- since this backfill — which is why B2 follows B1 promptly, not after weeks):
--   ALTER TABLE tenant_users  DROP CONSTRAINT IF EXISTS tenant_users_role_check;
--   ALTER TABLE tenant_users  ADD CONSTRAINT tenant_users_role_check
--     CHECK (role IN ('owner','admin','viewer','counselor','staff'));
--   ALTER TABLE invite_tokens DROP CONSTRAINT IF EXISTS invite_tokens_role_check;
--   ALTER TABLE invite_tokens ADD CONSTRAINT invite_tokens_role_check
--     CHECK (role IN ('admin','viewer','counselor','staff'));
--   UPDATE tenant_users  SET role = 'counselor' WHERE role = 'staff';
--   UPDATE invite_tokens SET role = 'counselor' WHERE role = 'staff';
--
-- Applied: stage <PENDING> / prod HELD.

BEGIN;

-- ── 1. Observed 'counselor' counts — INFORMATIONAL ONLY ───────────────────────
-- Logs the observed counts next to B1's stage numbers so the promotion reviewer
-- can eyeball them. Deliberately does NOT RAISE on a mismatch: prod is a
-- different database from stage (stage is a 2026-06-21 clone and the two have
-- diverged for months), so a different — including higher — 'counselor' count on
-- the prod promotion is legitimate, not a failure condition. A higher count just
-- means more legacy rows for step 2 to convert, which is exactly the goal.
-- Correctness is enforced by step 4 and step 5, not here.
DO $$
DECLARE
  tu_counselor int;
  it_counselor int;
  tu_expected  int := 19;  -- B1 stage log: mig 226: tenant_users.role = counselor
  it_expected  int := 12;  -- B1 stage log: mig 226: invite_tokens.role = counselor
BEGIN
  SELECT count(*) INTO tu_counselor FROM tenant_users  WHERE role = 'counselor';
  SELECT count(*) INTO it_counselor FROM invite_tokens WHERE role = 'counselor';

  RAISE NOTICE 'mig 227: BEFORE — tenant_users.role = counselor: % row(s) (B1 stage log: %)', tu_counselor, tu_expected;
  RAISE NOTICE 'mig 227: BEFORE — invite_tokens.role = counselor: % row(s) (B1 stage log: %)', it_counselor, it_expected;
END $$;

-- ── 2. Backfill: counselor -> staff (UPDATE BEFORE narrowing) ──────────────────
UPDATE tenant_users  SET role = 'staff' WHERE role = 'counselor';
UPDATE invite_tokens SET role = 'staff' WHERE role = 'counselor';

-- ── 3. Narrow both CHECK constraints to drop 'counselor' ───────────────────────
-- Reuse the exact names B1 established.
ALTER TABLE tenant_users DROP CONSTRAINT IF EXISTS tenant_users_role_check;
ALTER TABLE tenant_users ADD CONSTRAINT tenant_users_role_check
  CHECK (role IN ('owner', 'admin', 'viewer', 'staff'));

ALTER TABLE invite_tokens DROP CONSTRAINT IF EXISTS invite_tokens_role_check;
ALTER TABLE invite_tokens ADD CONSTRAINT invite_tokens_role_check
  CHECK (role IN ('admin', 'viewer', 'staff'));

-- ── 4. Post-condition: exactly ONE role CHECK per table ────────────────────────
-- Carried forward from B1 (mig 226). invite_tokens.role's original constraint was
-- inline + auto-named (003_phase2a_saas_ops.sql:35); the narrowing has the same
-- auto-naming exposure as the widening did — if the DROP above was a silent no-op
-- the table would carry TWO role checks, the surviving one still rejecting rows
-- the narrowed one accepts (or vice versa). Fail the migrate job here.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'invite_tokens'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%role%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'mig 227: expected exactly 1 role check on invite_tokens, found %', n;
  END IF;

  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'tenant_users'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%role%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'mig 227: expected exactly 1 role check on tenant_users, found %', n;
  END IF;
END $$;

-- ── 5. After-state: per-role counts for both tables, and 0 counselor rows ──────
DO $$
DECLARE
  r record;
  tu_counselor int;
  it_counselor int;
BEGIN
  SELECT count(*) INTO tu_counselor FROM tenant_users  WHERE role = 'counselor';
  SELECT count(*) INTO it_counselor FROM invite_tokens WHERE role = 'counselor';

  FOR r IN SELECT role, count(*) AS n FROM tenant_users GROUP BY role ORDER BY role LOOP
    RAISE NOTICE 'mig 227: AFTER — tenant_users.role = %: % row(s)', r.role, r.n;
  END LOOP;
  FOR r IN SELECT role, count(*) AS n FROM invite_tokens GROUP BY role ORDER BY role LOOP
    RAISE NOTICE 'mig 227: AFTER — invite_tokens.role = %: % row(s)', r.role, r.n;
  END LOOP;

  IF tu_counselor <> 0 OR it_counselor <> 0 THEN
    RAISE EXCEPTION 'mig 227: counselor rows remain after backfill (tenant_users: %, invite_tokens: %)', tu_counselor, it_counselor;
  END IF;
END $$;

INSERT INTO public.schema_migrations (version) VALUES ('227_role_staff_backfill.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
