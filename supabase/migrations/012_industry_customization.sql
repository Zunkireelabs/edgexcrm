-- Industry-Specific Tenant Customization
-- ======================================
-- Adds industry classification and industry-specific entity management.
-- Each tenant can be assigned an industry and manage entities (colleges, services, etc.)

-- 1. Create industries reference table (system-wide)
CREATE TABLE IF NOT EXISTS industries (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  entity_type_label VARCHAR(100) NOT NULL,     -- "Partner Colleges"
  entity_type_singular VARCHAR(100) NOT NULL,  -- "College"
  icon VARCHAR(50),
  default_pipeline_stages JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed industries with default pipeline stages
INSERT INTO industries (id, name, description, entity_type_label, entity_type_singular, icon, default_pipeline_stages) VALUES
  (
    'education_consultancy',
    'Education Consultancy',
    'Universities, colleges, study abroad agencies, and educational institutions',
    'Partner Colleges',
    'College',
    'graduation-cap',
    '[
      {"name": "New", "slug": "new", "position": 0, "color": "#3b82f6", "is_default": true, "is_terminal": false},
      {"name": "Document Collection", "slug": "document-collection", "position": 1, "color": "#f97316", "is_default": false, "is_terminal": false},
      {"name": "Application Submitted", "slug": "application-submitted", "position": 2, "color": "#a855f7", "is_default": false, "is_terminal": false},
      {"name": "Offer Received", "slug": "offer-received", "position": 3, "color": "#14b8a6", "is_default": false, "is_terminal": false},
      {"name": "Visa Applied", "slug": "visa-applied", "position": 4, "color": "#eab308", "is_default": false, "is_terminal": false},
      {"name": "Enrolled", "slug": "enrolled", "position": 5, "color": "#22c55e", "is_default": false, "is_terminal": true},
      {"name": "Rejected", "slug": "rejected", "position": 6, "color": "#ef4444", "is_default": false, "is_terminal": true}
    ]'::jsonb
  ),
  (
    'it_agency',
    'IT Agency',
    'Software development, digital marketing, and technology services',
    'Services',
    'Service',
    'code',
    '[
      {"name": "New", "slug": "new", "position": 0, "color": "#3b82f6", "is_default": true, "is_terminal": false},
      {"name": "Discovery Call", "slug": "discovery-call", "position": 1, "color": "#f97316", "is_default": false, "is_terminal": false},
      {"name": "Proposal Sent", "slug": "proposal-sent", "position": 2, "color": "#a855f7", "is_default": false, "is_terminal": false},
      {"name": "Negotiation", "slug": "negotiation", "position": 3, "color": "#eab308", "is_default": false, "is_terminal": false},
      {"name": "Won", "slug": "won", "position": 4, "color": "#22c55e", "is_default": false, "is_terminal": true},
      {"name": "Lost", "slug": "lost", "position": 5, "color": "#ef4444", "is_default": false, "is_terminal": true}
    ]'::jsonb
  ),
  (
    'construction',
    'Construction',
    'Building contractors, architects, and construction services',
    'Project Types',
    'Project Type',
    'hard-hat',
    '[
      {"name": "New", "slug": "new", "position": 0, "color": "#3b82f6", "is_default": true, "is_terminal": false},
      {"name": "Site Visit", "slug": "site-visit", "position": 1, "color": "#f97316", "is_default": false, "is_terminal": false},
      {"name": "Quote Sent", "slug": "quote-sent", "position": 2, "color": "#a855f7", "is_default": false, "is_terminal": false},
      {"name": "Contract Signed", "slug": "contract-signed", "position": 3, "color": "#14b8a6", "is_default": false, "is_terminal": false},
      {"name": "In Progress", "slug": "in-progress", "position": 4, "color": "#eab308", "is_default": false, "is_terminal": false},
      {"name": "Completed", "slug": "completed", "position": 5, "color": "#22c55e", "is_default": false, "is_terminal": true},
      {"name": "Cancelled", "slug": "cancelled", "position": 6, "color": "#ef4444", "is_default": false, "is_terminal": true}
    ]'::jsonb
  ),
  (
    'real_estate',
    'Real Estate',
    'Property sales, rentals, and real estate agencies',
    'Property Types',
    'Property Type',
    'building',
    '[
      {"name": "New", "slug": "new", "position": 0, "color": "#3b82f6", "is_default": true, "is_terminal": false},
      {"name": "Property Shown", "slug": "property-shown", "position": 1, "color": "#f97316", "is_default": false, "is_terminal": false},
      {"name": "Offer Made", "slug": "offer-made", "position": 2, "color": "#a855f7", "is_default": false, "is_terminal": false},
      {"name": "Under Contract", "slug": "under-contract", "position": 3, "color": "#eab308", "is_default": false, "is_terminal": false},
      {"name": "Closed", "slug": "closed", "position": 4, "color": "#22c55e", "is_default": false, "is_terminal": true},
      {"name": "Lost", "slug": "lost", "position": 5, "color": "#ef4444", "is_default": false, "is_terminal": true}
    ]'::jsonb
  ),
  (
    'healthcare',
    'Healthcare',
    'Hospitals, clinics, and medical service providers',
    'Specializations',
    'Specialization',
    'heart-pulse',
    '[
      {"name": "New", "slug": "new", "position": 0, "color": "#3b82f6", "is_default": true, "is_terminal": false},
      {"name": "Consultation Scheduled", "slug": "consultation-scheduled", "position": 1, "color": "#f97316", "is_default": false, "is_terminal": false},
      {"name": "Assessment", "slug": "assessment", "position": 2, "color": "#a855f7", "is_default": false, "is_terminal": false},
      {"name": "Treatment Plan", "slug": "treatment-plan", "position": 3, "color": "#eab308", "is_default": false, "is_terminal": false},
      {"name": "Active", "slug": "active", "position": 4, "color": "#22c55e", "is_default": false, "is_terminal": true},
      {"name": "Discharged", "slug": "discharged", "position": 5, "color": "#6b7280", "is_default": false, "is_terminal": true}
    ]'::jsonb
  ),
  (
    'recruitment',
    'Recruitment',
    'Staffing agencies, HR services, and talent acquisition',
    'Job Categories',
    'Job Category',
    'briefcase',
    '[
      {"name": "New", "slug": "new", "position": 0, "color": "#3b82f6", "is_default": true, "is_terminal": false},
      {"name": "Screening", "slug": "screening", "position": 1, "color": "#f97316", "is_default": false, "is_terminal": false},
      {"name": "Interview", "slug": "interview", "position": 2, "color": "#a855f7", "is_default": false, "is_terminal": false},
      {"name": "Offer", "slug": "offer", "position": 3, "color": "#eab308", "is_default": false, "is_terminal": false},
      {"name": "Hired", "slug": "hired", "position": 4, "color": "#22c55e", "is_default": false, "is_terminal": true},
      {"name": "Rejected", "slug": "rejected", "position": 5, "color": "#ef4444", "is_default": false, "is_terminal": true}
    ]'::jsonb
  ),
  (
    'general',
    'General',
    'General-purpose CRM for any business type',
    'Categories',
    'Category',
    'folder',
    '[
      {"name": "New", "slug": "new", "position": 0, "color": "#3b82f6", "is_default": true, "is_terminal": false},
      {"name": "Contacted", "slug": "contacted", "position": 1, "color": "#f97316", "is_default": false, "is_terminal": false},
      {"name": "Qualified", "slug": "qualified", "position": 2, "color": "#a855f7", "is_default": false, "is_terminal": false},
      {"name": "Converted", "slug": "converted", "position": 3, "color": "#22c55e", "is_default": false, "is_terminal": true},
      {"name": "Lost", "slug": "lost", "position": 4, "color": "#ef4444", "is_default": false, "is_terminal": true}
    ]'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

-- No RLS on industries - read-only system table
ALTER TABLE industries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view industries" ON industries
  FOR SELECT USING (true);


-- 2. Add industry_id to tenants table
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS industry_id VARCHAR(50) REFERENCES industries(id);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_tenants_industry_id ON tenants(industry_id);


-- 3. Create tenant_entities table
CREATE TABLE IF NOT EXISTS tenant_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,  -- Industry-specific fields
  is_active BOOLEAN DEFAULT true,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_tenant_entities_tenant_id ON tenant_entities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_entities_active ON tenant_entities(tenant_id, is_active) WHERE is_active = true;

ALTER TABLE tenant_entities ENABLE ROW LEVEL SECURITY;

-- RLS Policies for tenant_entities (follow pipeline_stages pattern)
CREATE POLICY "Tenant members can view their entities" ON tenant_entities
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Public can read active entities" ON tenant_entities
  FOR SELECT TO anon USING (is_active = true);

CREATE POLICY "Admins can insert entities" ON tenant_entities
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "Admins can update entities" ON tenant_entities
  FOR UPDATE USING (is_tenant_admin(tenant_id));

CREATE POLICY "Admins can delete entities" ON tenant_entities
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- Updated_at trigger
CREATE TRIGGER trigger_tenant_entities_updated_at
  BEFORE UPDATE ON tenant_entities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 4. Add entity_id to leads table (optional FK to selected entity)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES tenant_entities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_entity_id ON leads(entity_id);


-- 5. Set industry for existing tenants
-- Admizz Education gets education_consultancy
UPDATE tenants SET industry_id = 'education_consultancy' WHERE slug = 'admizz';

-- RK University also gets education_consultancy
UPDATE tenants SET industry_id = 'education_consultancy' WHERE slug = 'rku';
