-- Migration 057: Application Tracking (education_consultancy feature)
-- Additive + idempotent. Dormant until an education_consultancy tenant uses it.

-- 1. application_stages (seeded per education tenant; configurable later) -----
CREATE TABLE IF NOT EXISTS application_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  color VARCHAR(7) DEFAULT '#6b7280',
  is_default BOOLEAN DEFAULT false,
  terminal_type VARCHAR(10) CHECK (terminal_type IN ('won', 'lost')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_application_stages_tenant
  ON application_stages(tenant_id, position);

ALTER TABLE application_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "application_stages_select" ON application_stages
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "application_stages_insert" ON application_stages
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "application_stages_update" ON application_stages
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "application_stages_delete" ON application_stages
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE TRIGGER trigger_application_stages_updated_at
  BEFORE UPDATE ON application_stages FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2. applications (child of leads — one student → many applications) ----------
CREATE TABLE IF NOT EXISTS applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  university_name TEXT NOT NULL,
  program_name TEXT NOT NULL,
  intake_term TEXT,
  country TEXT,
  stage_id UUID NOT NULL REFERENCES application_stages(id),
  -- denormalized slug kept in sync with stage_id; avoids a join on every list query
  status TEXT NOT NULL DEFAULT 'shortlisted',
  offer_type TEXT CHECK (offer_type IN ('conditional', 'unconditional')),
  application_deadline DATE,
  application_fee_paid BOOLEAN NOT NULL DEFAULT false,
  tuition_fee NUMERIC(14, 2),
  deposit_paid BOOLEAN NOT NULL DEFAULT false,
  offer_letter_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_applications_tenant_lead
  ON applications(tenant_id, lead_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_applications_tenant_stage
  ON applications(tenant_id, stage_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_applications_tenant_live
  ON applications(tenant_id) WHERE deleted_at IS NULL;

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "applications_select" ON applications
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "applications_insert" ON applications
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "applications_update" ON applications
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "applications_delete" ON applications
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE TRIGGER trigger_applications_updated_at
  BEFORE UPDATE ON applications FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3. Seed 11 default application_stages for existing education_consultancy tenants
INSERT INTO application_stages (tenant_id, name, slug, position, color, is_default, terminal_type)
SELECT t.id, s.name, s.slug, s.position, s.color, s.is_default, s.terminal_type
FROM tenants t
CROSS JOIN (VALUES
  ('Shortlisted',          'shortlisted',          0,  '#3b82f6', true,  NULL),
  ('Documents Pending',    'documents_pending',     1,  '#f97316', false, NULL),
  ('Applied',              'applied',               2,  '#a855f7', false, NULL),
  ('Conditional Offer',    'conditional_offer',     3,  '#eab308', false, NULL),
  ('Unconditional Offer',  'unconditional_offer',   4,  '#14b8a6', false, NULL),
  ('Offer Accepted',       'offer_accepted',        5,  '#06b6d4', false, NULL),
  ('Visa Applied',         'visa_applied',          6,  '#8b5cf6', false, NULL),
  ('Visa Approved',        'visa_approved',         7,  '#10b981', false, NULL),
  ('Enrolled',             'enrolled',              8,  '#22c55e', false, 'won'),
  ('Rejected',             'rejected',              9,  '#ef4444', false, 'lost'),
  ('Withdrawn',            'withdrawn',             10, '#6b7280', false, 'lost')
) AS s(name, slug, position, color, is_default, terminal_type)
WHERE t.industry_id = 'education_consultancy'
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- ⚠  New-tenant provisioning gap: stages are seeded here for tenants that exist
-- at migration time. Tenants created after this migration will have zero
-- application_stages and the Applications board will be empty. A follow-up
-- task on STATUS-BOARD (ref: "application-tracking new-tenant stage seed gap")
-- tracks adding stage provisioning to the tenant-creation path.
