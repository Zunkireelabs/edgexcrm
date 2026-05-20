-- ============================================================
-- Local Development Seed Data
-- Run via: npx supabase db reset
-- ============================================================

-- 1. Create test tenant
INSERT INTO tenants (id, name, slug, primary_color, config)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Test University',
  'test-uni',
  '#6366f1',
  '{}'::jsonb
) ON CONFLICT (slug) DO NOTHING;

-- 2. Assign industry to test tenant
UPDATE tenants
SET config = jsonb_set(config, '{industry_id}', '"education_consultancy"')
WHERE id = '00000000-0000-0000-0000-000000000001';

-- Also update the industry_id column if it exists (migration 012)
UPDATE tenants
SET industry_id = 'education_consultancy'
WHERE id = '00000000-0000-0000-0000-000000000001'
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'industry_id'
  );

-- 3. Create test user in auth.users (local Supabase dev user)
-- NOTE: After running seed, go to Supabase Studio → Authentication → Add User
-- Email: admin@zunkireelabs.com  Password: admin123
-- Then run the tenant_users INSERT below with the actual user UUID.

-- 4. Create default pipeline for test tenant
INSERT INTO pipelines (id, tenant_id, name, is_default)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  'Default Pipeline',
  true
) ON CONFLICT DO NOTHING;

-- 5. Create education_consultancy pipeline stages
INSERT INTO pipeline_stages (id, pipeline_id, tenant_id, name, slug, position, color, is_default, is_terminal)
VALUES
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'New', 'new', 0, '#3b82f6', true, false),
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Document Collection', 'document-collection', 1, '#f97316', false, false),
  ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Application Submitted', 'application-submitted', 2, '#a855f7', false, false),
  ('00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Enrolled', 'enrolled', 3, '#22c55e', false, true),
  ('00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Rejected', 'rejected', 4, '#ef4444', false, true)
ON CONFLICT DO NOTHING;

-- 6. Create a sample form config (verifies existing public form still works)
INSERT INTO form_configs (id, tenant_id, name, slug, is_active, steps, branding)
VALUES (
  '00000000-0000-0000-0000-000000000030',
  '00000000-0000-0000-0000-000000000001',
  'Sample Application Form',
  'apply',
  true,
  '[
    {
      "title": "Personal Information",
      "fields": [
        {"name": "first_name", "label": "First Name", "type": "text", "required": true, "width": "half"},
        {"name": "last_name", "label": "Last Name", "type": "text", "required": true, "width": "half"},
        {"name": "email", "label": "Email Address", "type": "email", "required": true, "width": "half"},
        {"name": "phone", "label": "Phone Number", "type": "tel", "required": true, "width": "half"}
      ]
    },
    {
      "title": "Study Preferences",
      "fields": [
        {"name": "preferred_course", "label": "Preferred Course", "type": "text", "required": true},
        {"name": "message", "label": "Additional Message", "type": "textarea", "required": false}
      ]
    }
  ]'::jsonb,
  '{
    "title": "Test University Application",
    "subtitle": "Fill in your details to apply",
    "primary_color": "#6366f1",
    "button_text": "Submit Application",
    "thank_you_title": "Application Received!",
    "thank_you_message": "We will get back to you soon."
  }'::jsonb
) ON CONFLICT DO NOTHING;
