-- Migration 122: HRMS Phase 2b — Attendance RLS hardening
-- (Renumbered from 120 alongside 121_attendance.sql to deconflict with
--  119_affiliates.sql. Applied to the stage DB under its original 120 name.)
-- Additive/policy-only. Not applied by Sonnet — Opus applies to stage after review
-- (see docs/HRMS-PHASE-2B-FOLLOWUP-BRIEF.md).
--
-- H1 fix: mig 121's self-INSERT policy (WITH CHECK user_id = auth.uid()) let an
-- employee fabricate/backdate their OWN attendance via direct PostgREST (past
-- work_date, status='present', fake clock times -> 201), defeating the
-- manager/HR-only regularization intent. Every legitimate write (clock-in,
-- clock-out, regularize) goes through the service-role API and bypasses RLS
-- entirely — the frontend never writes attendance_records directly. So there
-- is no legitimate direct-client write path to preserve; lock INSERT/UPDATE
-- to admin-only. SELECT stays tenant-coarse; DELETE is already admin-only.

BEGIN;

DROP POLICY IF EXISTS "attendance_records_insert" ON attendance_records;
CREATE POLICY "attendance_records_insert" ON attendance_records
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "attendance_records_update" ON attendance_records;
CREATE POLICY "attendance_records_update" ON attendance_records
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

-- Policy-only change: 0 rows touched on any table.

COMMIT;
