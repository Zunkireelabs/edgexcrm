-- Migration 117: HRMS Phase 2a — Leave Management schema
-- Additive only. Not applied by Sonnet — Opus applies to stage after review
-- (see CLAUDE.md migration workflow).
--
-- Leave is universal HR core (every tenant/industry) — see
-- docs/HRMS-PHASE-2A-LEAVE-BRIEF.md. Accrual is a simple annual allotment:
-- balance = annual_allotment_days + adjustments − approved days, derived on
-- read (Chunk B), never stored. leave_requests mirrors the time_entries
-- approval state machine (supabase/migrations/020_time_tracking.sql).

BEGIN;

-- 1. leave_types ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_types (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,
  code                     TEXT,
  color                    TEXT,
  is_paid                  BOOLEAN NOT NULL DEFAULT true,
  requires_approval        BOOLEAN NOT NULL DEFAULT true,
  annual_allotment_days    NUMERIC NOT NULL DEFAULT 0,
  allow_half_day           BOOLEAN NOT NULL DEFAULT true,
  carry_forward            BOOLEAN NOT NULL DEFAULT false,
  max_carry_forward_days   NUMERIC,
  is_active                BOOLEAN NOT NULL DEFAULT true,
  sort_order               INT DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_leave_types_tenant ON leave_types(tenant_id);

ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leave_types_select" ON leave_types
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "leave_types_insert" ON leave_types
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "leave_types_update" ON leave_types
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "leave_types_delete" ON leave_types
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- 2. holidays --------------------------------------------------------------
-- branch_id NULL = tenant-wide default calendar; a branch's effective
-- calendar is the union of its own rows plus the NULL-branch defaults.
CREATE TABLE IF NOT EXISTS holidays (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id         UUID REFERENCES branches(id) ON DELETE SET NULL,
  name              TEXT NOT NULL,
  holiday_date      DATE NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, branch_id, holiday_date)
);

CREATE INDEX IF NOT EXISTS idx_holidays_tenant_date ON holidays(tenant_id, holiday_date);

ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "holidays_select" ON holidays
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "holidays_insert" ON holidays
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "holidays_update" ON holidays
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "holidays_delete" ON holidays
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- 3. leave_requests ----------------------------------------------------------
-- Mirrors the time_entries approval state machine. Employee identity is
-- tenant_users.id (tenant_user_id), not auth.userId — user_id is kept for
-- RLS self-checks (mirrors time_entries.user_id).
CREATE TABLE IF NOT EXISTS leave_requests (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id                     UUID NOT NULL REFERENCES auth.users(id),
  tenant_user_id              UUID NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
  leave_type_id               UUID NOT NULL REFERENCES leave_types(id),
  start_date                  DATE NOT NULL,
  end_date                    DATE NOT NULL,
  start_half                  BOOLEAN NOT NULL DEFAULT false,
  end_half                    BOOLEAN NOT NULL DEFAULT false,
  total_days                  NUMERIC NOT NULL,
  reason                      TEXT,
  approval_status             TEXT NOT NULL DEFAULT 'pending'
                                 CHECK (approval_status IN ('pending','approved','rejected','cancelled')),
  approver_tenant_user_id     UUID REFERENCES tenant_users(id) ON DELETE SET NULL,
  approved_by                 UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at                 TIMESTAMPTZ,
  rejection_reason            TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_tenant_pending
  ON leave_requests(tenant_id) WHERE approval_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_leave_requests_tenant_user
  ON leave_requests(tenant_id, tenant_user_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_tenant_approver
  ON leave_requests(tenant_id, approver_tenant_user_id);

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leave_requests_select" ON leave_requests
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- INSERT: tenant_id must be a tenant the caller belongs to; the API layer
-- enforces "creator = self, or canManageHR filing on behalf of someone".
CREATE POLICY "leave_requests_insert" ON leave_requests
  FOR INSERT WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()));

-- UPDATE mirrors time_entries: the requester may act on their own row while
-- still pending (cancel), or a tenant admin/approver acts via the
-- service-role API (canManageHR/approver-match checked in the route).
CREATE POLICY "leave_requests_update" ON leave_requests
  FOR UPDATE USING (
    (user_id = auth.uid() AND approval_status = 'pending')
    OR is_tenant_admin(tenant_id)
  ) WITH CHECK (
    (user_id = auth.uid() AND approval_status = 'pending')
    OR is_tenant_admin(tenant_id)
  );

CREATE TRIGGER trigger_leave_requests_updated_at
  BEFORE UPDATE ON leave_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 4. leave_adjustments -------------------------------------------------------
-- Manual grants / carry-forward / corrections. delta_days can be negative.
CREATE TABLE IF NOT EXISTS leave_adjustments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_user_id    UUID NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
  leave_type_id     UUID NOT NULL REFERENCES leave_types(id),
  year              INT NOT NULL,
  delta_days        NUMERIC NOT NULL,
  note              TEXT,
  created_by        UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_adjustments_tenant_user_type_year
  ON leave_adjustments(tenant_id, tenant_user_id, leave_type_id, year);

ALTER TABLE leave_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leave_adjustments_select" ON leave_adjustments
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "leave_adjustments_insert" ON leave_adjustments
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "leave_adjustments_update" ON leave_adjustments
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "leave_adjustments_delete" ON leave_adjustments
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- 5. seed starter leave types for every existing tenant (universal) --------
INSERT INTO leave_types (tenant_id, name, code, is_paid, annual_allotment_days, carry_forward, max_carry_forward_days, sort_order)
SELECT id, 'Annual', 'ANNUAL', true, 12, true, 5, 1 FROM tenants
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO leave_types (tenant_id, name, code, is_paid, annual_allotment_days, sort_order)
SELECT id, 'Sick', 'SICK', true, 7, 2 FROM tenants
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO leave_types (tenant_id, name, code, is_paid, annual_allotment_days, sort_order)
SELECT id, 'Casual', 'CASUAL', true, 5, 3 FROM tenants
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO leave_types (tenant_id, name, code, is_paid, annual_allotment_days, sort_order)
SELECT id, 'Unpaid', 'UNPAID', false, 0, 4 FROM tenants
ON CONFLICT (tenant_id, name) DO NOTHING;

-- Additive-only: 4 new tables + seed rows on leave_types (4 rows per
-- existing tenant), 0 rows touched on any existing table.
-- Expected before/after on existing tables: tenants, tenant_users, branches
-- row counts unchanged. leave_types: 0 -> 4 * (tenant count) rows.
-- holidays / leave_requests / leave_adjustments: 0 -> 0 (empty until used).

COMMIT;
