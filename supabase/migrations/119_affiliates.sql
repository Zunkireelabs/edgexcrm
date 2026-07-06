-- Migration 119: Affiliates directory (education_consultancy)
-- Maps ref_code → affiliate name/email so CRM staff can identify which
-- affiliate sent a lead without needing the name in the URL.
-- Additive, idempotent, transaction-wrapped.

BEGIN;

-- Before snapshot
DO $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'affiliates';
  RAISE NOTICE '119 BEFORE: affiliates table exists=%', v_count;
END$$;

CREATE TABLE IF NOT EXISTS affiliates (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  ref_code   TEXT        NOT NULL,
  email      TEXT,
  status     TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ref_code)
);

CREATE INDEX IF NOT EXISTS affiliates_tenant_ref_code_idx ON affiliates(tenant_id, ref_code);

ALTER TABLE affiliates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "affiliates_select" ON affiliates;
CREATE POLICY "affiliates_select" ON affiliates FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "affiliates_insert" ON affiliates;
CREATE POLICY "affiliates_insert" ON affiliates FOR INSERT
  WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "affiliates_update" ON affiliates;
CREATE POLICY "affiliates_update" ON affiliates FOR UPDATE
  USING (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "affiliates_delete" ON affiliates;
CREATE POLICY "affiliates_delete" ON affiliates FOR DELETE
  USING (is_tenant_admin(tenant_id));

-- After snapshot
DO $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'affiliates';
  RAISE NOTICE '119 AFTER: affiliates table exists=%', v_count;
  IF v_count <> 1 THEN
    RAISE EXCEPTION '119 ABORT: affiliates table was not created';
  END IF;
END$$;

COMMIT;
