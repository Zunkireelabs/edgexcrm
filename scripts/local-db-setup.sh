#!/usr/bin/env bash
# local-db-setup.sh — provision the local dev login user + tenant link.
#
# Run AFTER `supabase start` (which loads baseline/schema.sql + ledger + seed.sql).
# Idempotent: safe to re-run. Creates a local Auth user and links it to the
# seeded it_agency "Test Agency" tenant as owner.
#
#   ./scripts/local-db-setup.sh
#
# Local login:  admin@edgex.local  /  edgexdev123
set -euo pipefail

API_URL="http://127.0.0.1:54321"
# Static, well-known LOCAL Supabase demo service-role key (safe to commit — local only).
SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
LOCAL_DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

EMAIL="admin@edgex.local"
PASSWORD="edgexdev123"
TENANT_ID="11111111-1111-1111-1111-111111111111"   # Test Agency (see supabase/seed.sql)

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
  # Already exists — look it up in the DB.
  AUTH_UID="$(psql "$LOCAL_DB" -tAc "select id from auth.users where email='$EMAIL' limit 1;")"
fi
[ -z "$AUTH_UID" ] && { echo "  Could not create or find user. Response: $CREATE_RESP" >&2; exit 1; }
echo "  user_id = $AUTH_UID"

echo "→ Linking user to Test Agency tenant as owner..."
psql "$LOCAL_DB" -v ON_ERROR_STOP=1 -c "
  INSERT INTO public.tenant_users (tenant_id, user_id, role)
  VALUES ('$TENANT_ID', '$AUTH_UID', 'owner')
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET role='owner';
" >/dev/null 2>&1 || psql "$LOCAL_DB" -v ON_ERROR_STOP=1 -c "
  INSERT INTO public.tenant_users (tenant_id, user_id, role)
  SELECT '$TENANT_ID', '$AUTH_UID', 'owner'
  WHERE NOT EXISTS (SELECT 1 FROM public.tenant_users WHERE tenant_id='$TENANT_ID' AND user_id='$AUTH_UID');
"

echo ""
echo "✅ Local dev ready."
echo "   Login: $EMAIL / $PASSWORD"
echo "   Tenant: Test Agency (it_agency)"
echo "   Studio: http://127.0.0.1:54323"
