-- Migration 119: HRMS Phase 2b — Basic Attendance schema
-- Additive only. Not applied by Sonnet — Opus applies to stage after review
-- (see docs/HRMS-PHASE-2B-ATTENDANCE-BRIEF.md).
--
-- Attendance is universal HR core (every tenant/industry), separate from
-- Time Tracking (time_entries). Overlay, don't store: weekend/holiday/leave
-- statuses are computed at read time (src/lib/hr/attendance.ts) from
-- tenants.weekend_days/timezone, holidays, and approved leave_requests.
-- attendance_records stores only actuals — clock punches + manual
-- regularizations — one row per (tenant_user_id, work_date).
--
-- RLS bakes in the mig-118 lesson from day one: a direct-client INSERT may
-- only create the caller's OWN record (WITH CHECK user_id = auth.uid()).
-- HR/manager regularization runs through the service-role API (RLS
-- bypassed), so it is unaffected by this restriction.

BEGIN;

CREATE TABLE IF NOT EXISTS attendance_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_user_id  UUID NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  work_date       DATE NOT NULL,
  clock_in_at     TIMESTAMPTZ,
  clock_out_at    TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'present'
                    CHECK (status IN ('present','absent','remote','half_day')),
  source          TEXT NOT NULL DEFAULT 'self_clock'
                    CHECK (source IN ('self_clock','manual')),
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, tenant_user_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_tenant_date
  ON attendance_records(tenant_id, work_date);
CREATE INDEX IF NOT EXISTS idx_attendance_records_tenant_user_date
  ON attendance_records(tenant_id, tenant_user_id, work_date);

ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attendance_records_select" ON attendance_records
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- INSERT: a direct-client insert may only create the caller's OWN record.
-- HR/manager regularization runs through the service-role API (bypasses RLS).
CREATE POLICY "attendance_records_insert" ON attendance_records
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT get_user_tenant_ids())
    AND user_id = auth.uid()
  );

-- UPDATE: self may clock-out / update their own row; admin acts via API.
CREATE POLICY "attendance_records_update" ON attendance_records
  FOR UPDATE USING (
    (user_id = auth.uid()) OR is_tenant_admin(tenant_id)
  ) WITH CHECK (
    (user_id = auth.uid()) OR is_tenant_admin(tenant_id)
  );

CREATE POLICY "attendance_records_delete" ON attendance_records
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE TRIGGER trigger_attendance_records_updated_at
  BEFORE UPDATE ON attendance_records FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- No seed data.
-- Additive-only: 1 new table, 0 rows touched on any existing table.
-- Expected before/after: attendance_records 0 -> 0 (empty until used);
-- all other tables' row counts unchanged.

COMMIT;
