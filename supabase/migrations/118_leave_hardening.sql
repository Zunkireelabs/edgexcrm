-- Migration 118: HRMS Phase 2a Leave — security hardening (post Opus review)
-- Additive/idempotent. Not applied by Sonnet — Opus applies to stage after review
-- (see docs/HRMS-PHASE-2A-FOLLOWUP-BRIEF.md).

BEGIN;

-- Finding #1 (HIGH): mirror time_entries — a direct-client INSERT may only create
-- one's OWN request in the PENDING state. HR "file on behalf" is unaffected (it
-- runs through the service-role API, which bypasses RLS).
DROP POLICY IF EXISTS "leave_requests_insert" ON leave_requests;
CREATE POLICY "leave_requests_insert" ON leave_requests
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT get_user_tenant_ids())
    AND user_id = auth.uid()
    AND approval_status = 'pending'
  );

-- Finding #2 (MEDIUM): tenant-wide (branch_id IS NULL) holidays can duplicate because
-- Postgres treats NULLs as distinct in a UNIQUE constraint, so the POST route's 23505
-- dedup never fires for the common default-calendar case. Replace the constraint with
-- two partial unique indexes.
ALTER TABLE holidays DROP CONSTRAINT IF EXISTS holidays_tenant_id_branch_id_holiday_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_holidays_tenant_default_date
  ON holidays(tenant_id, holiday_date) WHERE branch_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_holidays_tenant_branch_date
  ON holidays(tenant_id, branch_id, holiday_date) WHERE branch_id IS NOT NULL;

COMMIT;
