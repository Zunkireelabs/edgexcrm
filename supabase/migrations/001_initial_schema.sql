-- Lead Gen CRM - Multi-Tenant Schema
-- ====================================

-- 1. Tenants (each client/organization)
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  logo_url TEXT,
  primary_color VARCHAR(7) DEFAULT '#0f172a',
  config JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);

-- 2. Tenant Users (maps Supabase auth users to tenants with roles)
CREATE TABLE IF NOT EXISTS tenant_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'admin', 'viewer')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_users_user_id ON tenant_users(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant_id ON tenant_users(tenant_id);

-- 3. Form Configs (configurable forms per tenant)
CREATE TABLE IF NOT EXISTS form_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL DEFAULT 'Default Form',
  is_active BOOLEAN DEFAULT true,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  branding JSONB NOT NULL DEFAULT '{}'::jsonb,
  redirect_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_form_configs_tenant_id ON form_configs(tenant_id);

-- 4. Leads (the core data - multi-tenant)
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id VARCHAR(100),
  step INTEGER DEFAULT 1,
  is_final BOOLEAN DEFAULT false,
  status VARCHAR(20) DEFAULT 'new' CHECK (status IN ('new', 'partial', 'contacted', 'enrolled', 'rejected')),
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  city VARCHAR(255),
  country VARCHAR(100),
  custom_fields JSONB DEFAULT '{}'::jsonb,
  file_urls JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_tenant_id ON leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leads_session_id ON leads(session_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_status ON leads(tenant_id, status);

-- 5. Lead Notes (internal notes per lead)
CREATE TABLE IF NOT EXISTS lead_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  user_email VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_notes_lead_id ON lead_notes(lead_id);

-- ====================================
-- TRIGGERS
-- ====================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_form_configs_updated_at
  BEFORE UPDATE ON form_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ====================================
-- SECURITY DEFINER FUNCTIONS (avoid RLS recursion)
-- ====================================

CREATE OR REPLACE FUNCTION get_user_tenant_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION is_tenant_admin(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenant_users
    WHERE tenant_id = p_tenant_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$;

-- ====================================
-- ROW LEVEL SECURITY
-- ====================================

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_notes ENABLE ROW LEVEL SECURITY;

-- TENANTS
CREATE POLICY "Users can view their tenants" ON tenants
  FOR SELECT USING (id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "Public can read tenants" ON tenants
  FOR SELECT TO anon USING (true);

-- TENANT USERS
CREATE POLICY "Users can view their memberships" ON tenant_users
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Admins can insert tenant users" ON tenant_users
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Admins can update tenant users" ON tenant_users
  FOR UPDATE USING (is_tenant_admin(tenant_id));
CREATE POLICY "Admins can delete tenant users" ON tenant_users
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- FORM CONFIGS
CREATE POLICY "Users can view their tenant forms" ON form_configs
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "Public can read active forms" ON form_configs
  FOR SELECT TO anon USING (is_active = true);
CREATE POLICY "Admins can manage forms" ON form_configs
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Admins can update forms" ON form_configs
  FOR UPDATE USING (is_tenant_admin(tenant_id));
CREATE POLICY "Admins can delete forms" ON form_configs
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- LEADS
CREATE POLICY "Anon can insert leads" ON leads
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update own session" ON leads
  FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon can read own session leads" ON leads
  FOR SELECT TO anon USING (true);
CREATE POLICY "Users can view tenant leads" ON leads
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "Admins can update leads" ON leads
  FOR UPDATE USING (is_tenant_admin(tenant_id));
CREATE POLICY "Admins can delete leads" ON leads
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- LEAD NOTES
CREATE POLICY "Users can view tenant lead notes" ON lead_notes
  FOR SELECT USING (
    lead_id IN (SELECT id FROM leads WHERE tenant_id IN (SELECT get_user_tenant_ids()))
  );
CREATE POLICY "Users can add notes" ON lead_notes
  FOR INSERT WITH CHECK (
    lead_id IN (SELECT id FROM leads WHERE tenant_id IN (SELECT get_user_tenant_ids()))
  );
CREATE POLICY "Users can delete own notes" ON lead_notes
  FOR DELETE USING (user_id = auth.uid());

-- ====================================
-- STORAGE
-- ====================================
-- Run separately:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('lead-documents', 'lead-documents', true);
-- CREATE POLICY "Anon upload" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'lead-documents');
-- CREATE POLICY "Anon update" ON storage.objects FOR UPDATE TO anon USING (bucket_id = 'lead-documents') WITH CHECK (bucket_id = 'lead-documents');
-- CREATE POLICY "Public read" ON storage.objects FOR SELECT USING (bucket_id = 'lead-documents');
-- CREATE POLICY "Auth delete" ON storage.objects FOR DELETE USING (bucket_id = 'lead-documents' AND auth.uid() IS NOT NULL);
