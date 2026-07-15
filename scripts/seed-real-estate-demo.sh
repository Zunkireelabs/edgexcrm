#!/usr/bin/env bash
# seed-real-estate-demo.sh — create a FRESH real_estate demo tenant on LOCAL.
#
# Per SOP, tenant-specific data ops live in scripts/ (NOT in a numbered migration).
# Creates a brand-new "CRE Capital Management" tenant (industry_id=real_estate) with
# an owner login, a pipeline, a flagship offering, a handful of investors (leads),
# and commitments spread across the raise-funnel statuses — so the Offerings board
# and per-offering funnel look alive for the pitch demo.
#
# It does NOT touch the existing it_agency "Test Agency" tenant (so the
# "nothing else changed" isolation check stays clean).
#
# LOCAL ONLY. Run AFTER `supabase start` + migrations 156/157/158 applied.
#   ./scripts/seed-real-estate-demo.sh
#
# Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING. Safe to re-run.
#
# Demo login:  owner@cre-capital.local  /  edgexdev123
set -euo pipefail

API_URL="http://127.0.0.1:54321"
# Static LOCAL Supabase demo service-role key (safe to commit — local only).
SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
LOCAL_DB="${LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

EMAIL="owner@cre-capital.local"
PASSWORD="edgexdev123"

# Fixed UUIDs so re-runs are idempotent.
TENANT_ID="ce000000-0000-4000-8000-000000000001"
PIPELINE_ID="ce000000-0000-4000-8000-0000000000a1"
STAGE_ID="ce000000-0000-4000-8000-0000000000b1"
OFFERING_ID="ce000000-0000-4000-8000-0000000000c1"
OFFERING2_ID="ce000000-0000-4000-8000-0000000000c2"

echo "→ Ensuring local stack is reachable..."
if ! curl -sf "$API_URL/rest/v1/" -H "apikey: $SERVICE_ROLE_KEY" >/dev/null 2>&1; then
  echo "  Local API not reachable at $API_URL — run 'supabase start' first." >&2
  exit 1
fi

echo "→ Verifying real_estate migrations are applied (offerings + investor_commitments)..."
HAVE_TABLES="$(psql "$LOCAL_DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('offerings','investor_commitments');")"
if [ "$HAVE_TABLES" != "2" ]; then
  echo "  Missing offerings/investor_commitments tables. Run 'scripts/migrate-apply.sh local' first." >&2
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

echo "→ Seeding CRE Capital Management tenant + offering + investors + commitments..."
psql "$LOCAL_DB" -v ON_ERROR_STOP=1 \
  -v tenant_id="$TENANT_ID" \
  -v owner_uid="$AUTH_UID" \
  -v pipeline_id="$PIPELINE_ID" \
  -v stage_id="$STAGE_ID" \
  -v offering_id="$OFFERING_ID" \
  -v offering2_id="$OFFERING2_ID" <<'SQL'
BEGIN;

-- 1. Tenant (fresh; does NOT touch Test Agency).
INSERT INTO public.tenants (id, name, slug, industry_id, primary_color)
VALUES (:'tenant_id', 'CRE Capital Management', 'cre-capital', 'real_estate', '#7c3aed')
ON CONFLICT (id) DO NOTHING;

-- 2. Owner membership.
INSERT INTO public.tenant_users (tenant_id, user_id, role)
VALUES (:'tenant_id', :'owner_uid', 'owner')
ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'owner';

-- 3. A pipeline + one stage (leads.pipeline_id is NOT NULL).
INSERT INTO public.pipelines (id, tenant_id, name, slug, is_default)
VALUES (:'pipeline_id', :'tenant_id', 'Investors', 'investors', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipeline_stages (id, tenant_id, pipeline_id, name, slug, position, is_default)
VALUES (:'stage_id', :'tenant_id', :'pipeline_id', 'Active', 'active', 0, true)
ON CONFLICT (id) DO NOTHING;

-- 4. Investors (ride the leads spine). custom_fields carry the §2.3 investor profile.
INSERT INTO public.leads (id, tenant_id, pipeline_id, stage_id, first_name, last_name, email, phone, status, lead_type, custom_fields)
VALUES
  ('ce000000-0000-4000-8000-0000000000d1', :'tenant_id', :'pipeline_id', :'stage_id', 'Sarah',  'Chen',    'sarah.chen@example.com',   '+1-404-555-0111', 'new', 'lead',
    '{"investor_type":"individual","accreditation_status":"verified","kyc_status":"cleared","target_check_size":"250000","preferred_asset_class":"industrial"}'::jsonb),
  ('ce000000-0000-4000-8000-0000000000d2', :'tenant_id', :'pipeline_id', :'stage_id', 'Marcus', 'Webb',    'marcus.webb@example.com',  '+1-404-555-0112', 'new', 'lead',
    '{"investor_type":"entity","entity_name":"Webb Family Office LLC","accreditation_status":"verified","kyc_status":"cleared","target_check_size":"500000","preferred_asset_class":"industrial"}'::jsonb),
  ('ce000000-0000-4000-8000-0000000000d3', :'tenant_id', :'pipeline_id', :'stage_id', 'Priya',  'Nair',    'priya.nair@example.com',   '+1-404-555-0113', 'new', 'lead',
    '{"investor_type":"sdira","accreditation_status":"self_certified","kyc_status":"pending","target_check_size":"150000","preferred_asset_class":"multifamily"}'::jsonb),
  ('ce000000-0000-4000-8000-0000000000d4', :'tenant_id', :'pipeline_id', :'stage_id', 'David',  'Okafor',  'david.okafor@example.com', '+1-404-555-0114', 'new', 'lead',
    '{"investor_type":"trust","entity_name":"Okafor Living Trust","accreditation_status":"verified","kyc_status":"cleared","target_check_size":"300000","preferred_asset_class":"industrial"}'::jsonb),
  ('ce000000-0000-4000-8000-0000000000d5', :'tenant_id', :'pipeline_id', :'stage_id', 'Elena',  'Rossi',   'elena.rossi@example.com',  '+1-404-555-0115', 'new', 'lead',
    '{"investor_type":"individual","accreditation_status":"pending","kyc_status":"pending","target_check_size":"200000","preferred_asset_class":"flex"}'::jsonb),
  ('ce000000-0000-4000-8000-0000000000d6', :'tenant_id', :'pipeline_id', :'stage_id', 'Tom',    'Bradley', 'tom.bradley@example.com',  '+1-404-555-0116', 'new', 'lead',
    '{"investor_type":"individual","accreditation_status":"not_accredited","kyc_status":"not_started","target_check_size":"75000","preferred_asset_class":"industrial"}'::jsonb),
  ('ce000000-0000-4000-8000-0000000000d7', :'tenant_id', :'pipeline_id', :'stage_id', 'Grace',  'Lin',     'grace.lin@example.com',    '+1-404-555-0117', 'new', 'lead',
    '{"investor_type":"joint","accreditation_status":"self_certified","kyc_status":"not_started","target_check_size":"100000","preferred_asset_class":"multifamily"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- 5. Flagship offering.
INSERT INTO public.offerings
  (id, tenant_id, name, slug, asset_class, structure, exemption, target_raise, min_investment, pref_return, currency, status, description, created_by)
VALUES
  (:'offering_id', :'tenant_id', 'Industrial Value-Add Fund II', 'industrial-value-add-ii',
   'industrial', 'fund', '506c', 25000000, 50000, 8.00, 'USD', 'raising',
   'Value-add industrial across the Southeast US — multi-tenant logistics and flex.',
   :'owner_uid')
ON CONFLICT (id) DO NOTHING;

-- 6. Commitments across the funnel (equity raised = subscribed + funded = $1.2M).
INSERT INTO public.investor_commitments
  (id, tenant_id, lead_id, offering_id, amount, status, committed_at, funded_at, created_by)
VALUES
  ('ce000000-0000-4000-8000-0000000000e1', :'tenant_id', 'ce000000-0000-4000-8000-0000000000d1', :'offering_id', 250000, 'funded',      now(), now(), :'owner_uid'),
  ('ce000000-0000-4000-8000-0000000000e2', :'tenant_id', 'ce000000-0000-4000-8000-0000000000d2', :'offering_id', 500000, 'funded',      now(), now(), :'owner_uid'),
  ('ce000000-0000-4000-8000-0000000000e3', :'tenant_id', 'ce000000-0000-4000-8000-0000000000d3', :'offering_id', 150000, 'subscribed',  now(), NULL,  :'owner_uid'),
  ('ce000000-0000-4000-8000-0000000000e4', :'tenant_id', 'ce000000-0000-4000-8000-0000000000d4', :'offering_id', 300000, 'subscribed',  now(), NULL,  :'owner_uid'),
  ('ce000000-0000-4000-8000-0000000000e5', :'tenant_id', 'ce000000-0000-4000-8000-0000000000d5', :'offering_id', 200000, 'soft_commit', now(), NULL,  :'owner_uid'),
  ('ce000000-0000-4000-8000-0000000000e6', :'tenant_id', 'ce000000-0000-4000-8000-0000000000d6', :'offering_id', NULL,   'prospect',    NULL,  NULL,  :'owner_uid'),
  ('ce000000-0000-4000-8000-0000000000e7', :'tenant_id', 'ce000000-0000-4000-8000-0000000000d7', :'offering_id', 100000, 'declined',    NULL,  NULL,  :'owner_uid')
ON CONFLICT (id) DO NOTHING;

-- 7. Second offering — reuses the SAME 7 investors at DIFFERENT statuses, so the
--    per-offering raise funnel is visible (e.g. Sarah is funded on Fund II but a
--    soft-commit here; Grace declined Fund II yet funded here). Equity raised here
--    (subscribed + funded) = $850K.
INSERT INTO public.offerings
  (id, tenant_id, name, slug, asset_class, structure, exemption, target_raise, min_investment, pref_return, currency, status, description, created_by)
VALUES
  (:'offering2_id', :'tenant_id', 'Southeast Flex Portfolio I', 'southeast-flex-portfolio-i',
   'flex', 'single_asset', '506b', 10000000, 25000, 7.00, 'USD', 'raising',
   'Single-asset small-bay flex acquisition — Nashville MSA. 506(b) existing relationships.',
   :'owner_uid')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.investor_commitments
  (id, tenant_id, lead_id, offering_id, amount, status, committed_at, funded_at, created_by)
VALUES
  ('ce000000-0000-4000-8000-0000000000e8', :'tenant_id', 'ce000000-0000-4000-8000-0000000000d1', :'offering2_id', 200000, 'soft_commit', now(), NULL, :'owner_uid'),
  ('ce000000-0000-4000-8000-0000000000e9', :'tenant_id', 'ce000000-0000-4000-8000-0000000000d2', :'offering2_id', 400000, 'subscribed',  now(), NULL, :'owner_uid'),
  ('ce000000-0000-4000-8000-0000000000ea', :'tenant_id', 'ce000000-0000-4000-8000-0000000000d3', :'offering2_id', NULL,   'prospect',    NULL,  NULL, :'owner_uid'),
  ('ce000000-0000-4000-8000-0000000000eb', :'tenant_id', 'ce000000-0000-4000-8000-0000000000d4', :'offering2_id', 350000, 'funded',      now(), now(), :'owner_uid'),
  ('ce000000-0000-4000-8000-0000000000ec', :'tenant_id', 'ce000000-0000-4000-8000-0000000000d5', :'offering2_id', 150000, 'soft_commit', now(), NULL, :'owner_uid'),
  ('ce000000-0000-4000-8000-0000000000ed', :'tenant_id', 'ce000000-0000-4000-8000-0000000000d6', :'offering2_id', NULL,   'prospect',    NULL,  NULL, :'owner_uid'),
  ('ce000000-0000-4000-8000-0000000000ee', :'tenant_id', 'ce000000-0000-4000-8000-0000000000d7', :'offering2_id', 100000, 'funded',      now(), now(), :'owner_uid')
ON CONFLICT (id) DO NOTHING;

COMMIT;
SQL

echo ""
echo "✅ real_estate demo ready."
echo "   Login:   $EMAIL / $PASSWORD"
echo "   Tenant:  CRE Capital Management (real_estate, slug cre-capital)"
echo "   Offerings: Industrial Value-Add Fund II (\$1.2M) + Southeast Flex Portfolio I (\$0.85M)"
echo "              same 7 investors, different status per offering (per-offering funnel)"
echo "   Studio:  http://127.0.0.1:54323"
