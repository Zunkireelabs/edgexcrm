#!/usr/bin/env bash
# seed-education-local.sh — provision an education_consultancy tenant + realistic leads
# on the local isolated DB. Idempotent: safe to re-run.
#
#   ./scripts/seed-education-local.sh
#
# Local login:  admin@admizz.local  /  edgexdev123
set -euo pipefail

API_URL="http://127.0.0.1:54321"
SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
LOCAL_DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

EMAIL="admin@admizz.local"
PASSWORD="edgexdev123"
TENANT_ID="22222222-2222-2222-2222-222222222222"

echo "→ Ensuring local stack is reachable..."
if ! curl -sf "$API_URL/rest/v1/" -H "apikey: $SERVICE_ROLE_KEY" >/dev/null 2>&1; then
  echo "  Local API not reachable at $API_URL — run 'supabase start' first." >&2
  exit 1
fi

echo "→ Creating (or finding) auth user $EMAIL..."
CREATE_RESP="$(curl -s -X POST "$API_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"email_confirm\":true}")"

AUTH_UID="$(echo "$CREATE_RESP" | sed -nE 's/.*"id":"([0-9a-f-]{36})".*/\1/p' | head -1)"
if [ -z "$AUTH_UID" ]; then
  AUTH_UID="$(psql "$LOCAL_DB" -tAc "select id from auth.users where email='$EMAIL' limit 1;")"
fi
[ -z "$AUTH_UID" ] && { echo "  Could not create or find user. Response: $CREATE_RESP" >&2; exit 1; }
echo "  user_id = $AUTH_UID"

echo "→ Seeding education_consultancy tenant + data..."
psql "$LOCAL_DB" -v ON_ERROR_STOP=1 <<SQL

BEGIN;

-- 1. Admizz Local tenant
INSERT INTO public.tenants (id, name, slug, primary_color, industry_id, config)
VALUES (
  '$TENANT_ID',
  'Admizz Local',
  'admizz-local',
  '#6366f1',
  'education_consultancy',
  '{}'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- 2. Link admin user as owner
INSERT INTO public.tenant_users (tenant_id, user_id, role)
VALUES ('$TENANT_ID', '$AUTH_UID', 'owner')
ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'owner';

-- 3. Default pipeline
INSERT INTO public.pipelines (id, tenant_id, name, slug, is_default, position)
VALUES (
  '22222222-2222-2222-2222-000000000010',
  '$TENANT_ID',
  'Admissions Pipeline',
  'admissions-pipeline',
  true,
  0
) ON CONFLICT (id) DO NOTHING;

-- 4. Pipeline stages (education default)
INSERT INTO public.pipeline_stages (id, pipeline_id, tenant_id, name, slug, position, color, is_default, is_terminal)
VALUES
  ('22222222-2222-2222-2222-000000000020', '22222222-2222-2222-2222-000000000010', '$TENANT_ID', 'New',        'new',        0, '#3b82f6', true,  false),
  ('22222222-2222-2222-2222-000000000021', '22222222-2222-2222-2222-000000000010', '$TENANT_ID', 'Contacted',  'contacted',  1, '#f97316', false, false),
  ('22222222-2222-2222-2222-000000000022', '22222222-2222-2222-2222-000000000010', '$TENANT_ID', 'Enrolled',   'enrolled',   2, '#22c55e', false, true),
  ('22222222-2222-2222-2222-000000000023', '22222222-2222-2222-2222-000000000010', '$TENANT_ID', 'Rejected',   'rejected',   3, '#ef4444', false, true)
ON CONFLICT (id) DO NOTHING;

-- 5. Lead lists (education funnel stages — called "Stage" in UI)
INSERT INTO public.lead_lists (id, tenant_id, name, slug, sort_order, is_system, is_intake, color, access)
VALUES
  ('22222222-2222-2222-2222-000000000030', '$TENANT_ID', 'Pre-qualified',  'pre-qualified',  1, true, true,  '#6366f1', '{"mode":"all"}'::jsonb),
  ('22222222-2222-2222-2222-000000000031', '$TENANT_ID', 'Qualified',      'qualified',       2, true, false, '#3b82f6', '{"mode":"all"}'::jsonb),
  ('22222222-2222-2222-2222-000000000032', '$TENANT_ID', 'Prospects',      'prospects',       3, true, false, '#f97316', '{"mode":"all"}'::jsonb),
  ('22222222-2222-2222-2222-000000000033', '$TENANT_ID', 'Applications',   'applications',    4, true, false, '#22c55e', '{"mode":"all"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- 6. Positions (counselor, lead-executive, branch-manager)
INSERT INTO public.positions (id, tenant_id, name, slug, base_tier, permissions, is_system)
VALUES
  ('22222222-2222-2222-2222-000000000040', '$TENANT_ID', 'Counselor',       'counselor',       'member', '{"leadScope":"own","canManageApplications":true}'::jsonb, true),
  ('22222222-2222-2222-2222-000000000041', '$TENANT_ID', 'Lead Executive',  'lead-executive',  'member', '{"leadScope":"own"}'::jsonb,                              true),
  ('22222222-2222-2222-2222-000000000042', '$TENANT_ID', 'Branch Manager',  'branch-manager',  'admin',  '{"leadScope":"team"}'::jsonb,                             true)
ON CONFLICT (id) DO NOTHING;

-- 7. Leads — 30 realistic education leads spread across lists and stages
INSERT INTO public.leads (tenant_id, first_name, last_name, email, phone, pipeline_id, stage_id, list_id, tags, intake_source, intake_medium, is_final, status, country, custom_fields, display_id)
VALUES
  -- Pre-qualified (intake)
  ('$TENANT_ID','Riya',      'Sharma',    'riya.sharma@gmail.com',      '+9779801234567', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000020', '22222222-2222-2222-2222-000000000030', ARRAY['student'], 'walk_in',  'check_in', true, 'new', 'Nepal',   '{"degree_level":"bachelors","destination":"Australia"}'::jsonb, 'ADM-001'),
  ('$TENANT_ID','Aarav',     'Poudel',    'aarav.poudel@yahoo.com',     '+9779812345678', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000020', '22222222-2222-2222-2222-000000000030', ARRAY['student'], 'facebook', 'social',   true, 'new', 'Nepal',   '{"degree_level":"masters","destination":"UK"}'::jsonb,          'ADM-002'),
  ('$TENANT_ID','Sita',      'Thapa',     'sita.thapa@hotmail.com',     '+9779823456789', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000020', '22222222-2222-2222-2222-000000000030', ARRAY['parent'],  'referral', 'offline',  true, 'new', 'Nepal',   '{}'::jsonb,                                                    'ADM-003'),
  ('$TENANT_ID','Bikash',    'Karki',     'bikash.karki@gmail.com',     '+9779834567890', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000020', '22222222-2222-2222-2222-000000000030', ARRAY['student'], 'walk_in',  'check_in', true, 'new', 'Nepal',   '{"degree_level":"bachelors","destination":"Canada"}'::jsonb,    'ADM-004'),
  ('$TENANT_ID','Priya',     'Adhikari',  'priya.adhikari@gmail.com',   '+9779845678901', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000020', '22222222-2222-2222-2222-000000000030', ARRAY['student'], 'instagram','social',   true, 'new', 'Nepal',   '{"degree_level":"diploma","destination":"Australia"}'::jsonb,   'ADM-005'),
  ('$TENANT_ID','Rohan',     'Shrestha',  'rohan.shrestha@gmail.com',   '+9779856789012', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000020', '22222222-2222-2222-2222-000000000030', ARRAY['student'], 'walk_in',  'check_in', true, 'new', 'India',   '{}'::jsonb,                                                    'ADM-006'),
  ('$TENANT_ID','Anita',     'Gurung',    'anita.gurung@gmail.com',     '+9779867890123', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000020', '22222222-2222-2222-2222-000000000030', ARRAY['parent'],  'website',  'organic',  true, 'new', 'Nepal',   '{}'::jsonb,                                                    'ADM-007'),
  ('$TENANT_ID','Dipesh',    'Tamang',    'dipesh.tamang@gmail.com',    '+9779878901234', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000020', '22222222-2222-2222-2222-000000000030', ARRAY['student'], 'referral', 'offline',  true, 'new', 'Nepal',   '{"degree_level":"masters","destination":"USA"}'::jsonb,         'ADM-008'),

  -- Qualified
  ('$TENANT_ID','Manisha',   'Rai',       'manisha.rai@gmail.com',      '+9779889012345', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000021', '22222222-2222-2222-2222-000000000031', ARRAY['student'], 'walk_in',  'check_in', true, 'contacted', 'Nepal', '{"degree_level":"bachelors","destination":"UK"}'::jsonb,       'ADM-009'),
  ('$TENANT_ID','Suraj',     'Limbu',     'suraj.limbu@gmail.com',      '+9779890123456', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000021', '22222222-2222-2222-2222-000000000031', ARRAY['student'], 'facebook', 'social',   true, 'contacted', 'Nepal', '{"degree_level":"masters","destination":"Australia"}'::jsonb,  'ADM-010'),
  ('$TENANT_ID','Kabita',    'Magar',     'kabita.magar@yahoo.com',     '+9779801234568', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000021', '22222222-2222-2222-2222-000000000031', ARRAY['parent'],  'referral', 'offline',  true, 'contacted', 'Nepal', '{}'::jsonb,                                                   'ADM-011'),
  ('$TENANT_ID','Nabin',     'Bhandari',  'nabin.bhandari@gmail.com',   '+9779812345679', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000021', '22222222-2222-2222-2222-000000000031', ARRAY['student'], 'walk_in',  'check_in', true, 'contacted', 'Nepal', '{"degree_level":"diploma","destination":"Canada"}'::jsonb,    'ADM-012'),
  ('$TENANT_ID','Pooja',     'Basnet',    'pooja.basnet@gmail.com',     '+9779823456780', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000021', '22222222-2222-2222-2222-000000000031', ARRAY['student'], 'instagram','social',   true, 'contacted', 'India',  '{"degree_level":"bachelors","destination":"Germany"}'::jsonb, 'ADM-013'),
  ('$TENANT_ID','Sandesh',   'Khadka',    'sandesh.khadka@gmail.com',   '+9779834567891', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000021', '22222222-2222-2222-2222-000000000031', ARRAY['student'], 'website',  'organic',  true, 'contacted', 'Nepal', '{}'::jsonb,                                                   'ADM-014'),
  ('$TENANT_ID','Sunita',    'Ghimire',   'sunita.ghimire@hotmail.com', '+9779845678902', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000021', '22222222-2222-2222-2222-000000000031', ARRAY['parent'],  'referral', 'offline',  true, 'contacted', 'Nepal', '{}'::jsonb,                                                   'ADM-015'),

  -- Prospects
  ('$TENANT_ID','Rajesh',    'Koirala',   'rajesh.koirala@gmail.com',   '+9779856789013', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000021', '22222222-2222-2222-2222-000000000032', ARRAY['student'], 'walk_in',  'check_in', true, 'contacted', 'Nepal', '{"degree_level":"masters","destination":"Australia"}'::jsonb,  'ADM-016'),
  ('$TENANT_ID','Nisha',     'Pandey',    'nisha.pandey@gmail.com',     '+9779867890124', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000021', '22222222-2222-2222-2222-000000000032', ARRAY['student'], 'facebook', 'social',   true, 'contacted', 'Nepal', '{"degree_level":"bachelors","destination":"UK"}'::jsonb,       'ADM-017'),
  ('$TENANT_ID','Aashish',   'Joshi',     'aashish.joshi@gmail.com',    '+9779878901235', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000021', '22222222-2222-2222-2222-000000000032', ARRAY['student'], 'referral', 'offline',  true, 'contacted', 'Nepal', '{"degree_level":"diploma","destination":"Canada"}'::jsonb,    'ADM-018'),
  ('$TENANT_ID','Rekha',     'Maharjan',  'rekha.maharjan@gmail.com',   '+9779889012346', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000021', '22222222-2222-2222-2222-000000000032', ARRAY['parent'],  'walk_in',  'check_in', true, 'contacted', 'Nepal', '{}'::jsonb,                                                   'ADM-019'),
  ('$TENANT_ID','Suman',     'Dhakal',    'suman.dhakal@gmail.com',     '+9779890123457', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000021', '22222222-2222-2222-2222-000000000032', ARRAY['student'], 'instagram','social',   true, 'contacted', 'Nepal', '{"degree_level":"bachelors","destination":"USA"}'::jsonb,     'ADM-020'),
  ('$TENANT_ID','Pratiksha', 'Neupane',   'pratiksha.neupane@gmail.com','+9779801234569', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000021', '22222222-2222-2222-2222-000000000032', ARRAY['student'], 'website',  'organic',  true, 'contacted', 'India',  '{"degree_level":"masters","destination":"Germany"}'::jsonb,  'ADM-021'),
  ('$TENANT_ID','Bibek',     'Sapkota',   'bibek.sapkota@gmail.com',    '+9779812345670', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000021', '22222222-2222-2222-2222-000000000032', ARRAY['student'], 'referral', 'offline',  true, 'contacted', 'Nepal', '{"degree_level":"bachelors","destination":"Australia"}'::jsonb,'ADM-022'),

  -- Applications
  ('$TENANT_ID','Shristi',   'Shrestha',  'shristi.shrestha@gmail.com', '+9779823456781', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000022', '22222222-2222-2222-2222-000000000033', ARRAY['student'], 'walk_in',  'check_in', true, 'enrolled', 'Nepal',  '{"degree_level":"bachelors","destination":"UK"}'::jsonb,      'ADM-023'),
  ('$TENANT_ID','Kiran',     'Subedi',    'kiran.subedi@gmail.com',     '+9779834567892', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000022', '22222222-2222-2222-2222-000000000033', ARRAY['student'], 'facebook', 'social',   true, 'enrolled', 'Nepal',  '{"degree_level":"masters","destination":"Australia"}'::jsonb, 'ADM-024'),
  ('$TENANT_ID','Anjali',    'Regmi',     'anjali.regmi@gmail.com',     '+9779845678903', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000022', '22222222-2222-2222-2222-000000000033', ARRAY['student'], 'referral', 'offline',  true, 'enrolled', 'Nepal',  '{"degree_level":"diploma","destination":"Canada"}'::jsonb,   'ADM-025'),
  ('$TENANT_ID','Gaurav',    'Bhattarai', 'gaurav.bhattarai@gmail.com', '+9779856789014', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000022', '22222222-2222-2222-2222-000000000033', ARRAY['student'], 'instagram','social',   true, 'enrolled', 'Nepal',  '{"degree_level":"bachelors","destination":"USA"}'::jsonb,    'ADM-026'),
  ('$TENANT_ID','Deepa',     'Chaudhary', 'deepa.chaudhary@gmail.com',  '+9779867890125', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000022', '22222222-2222-2222-2222-000000000033', ARRAY['parent'],  'walk_in',  'check_in', true, 'enrolled', 'Nepal',  '{}'::jsonb,                                                  'ADM-027'),
  ('$TENANT_ID','Santosh',   'Oli',       'santosh.oli@gmail.com',      '+9779878901236', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000022', '22222222-2222-2222-2222-000000000033', ARRAY['student'], 'website',  'organic',  true, 'enrolled', 'India',  '{"degree_level":"masters","destination":"Germany"}'::jsonb,  'ADM-028'),
  ('$TENANT_ID','Binita',    'Karmacharya','binita.k@gmail.com',        '+9779889012347', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000022', '22222222-2222-2222-2222-000000000033', ARRAY['student'], 'referral', 'offline',  true, 'enrolled', 'Nepal',  '{"degree_level":"bachelors","destination":"UK"}'::jsonb,     'ADM-029'),
  ('$TENANT_ID','Hari',      'Prasad',    'hari.prasad@gmail.com',      '+9779890123458', '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000022', '22222222-2222-2222-2222-000000000033', ARRAY['student'], 'walk_in',  'check_in', true, 'enrolled', 'Nepal',  '{"degree_level":"diploma","destination":"Australia"}'::jsonb,'ADM-030')
;

COMMIT;
SQL

echo ""
echo "✅ Education tenant seeded."
echo "   Login:  $EMAIL / $PASSWORD"
echo "   Tenant: Admizz Local (education_consultancy)"
echo "   Leads:  30 seeded across Pre-qualified / Qualified / Prospects / Applications"
echo "   Studio: http://127.0.0.1:54323"
