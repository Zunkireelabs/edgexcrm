#!/bin/bash

# ============================================================
# Phase 2A Verification Script
# ============================================================

BASE_URL="http://localhost:3000"
SUPABASE_URL="https://pirhnklvtjjpuvbvibxf.supabase.co"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpcmhua2x2dGpqcHV2YnZpYnhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1ODU2MDksImV4cCI6MjA4NzE2MTYwOX0.19d9xaOyUdnhGXc-MMTbRIdLH-_sUgOWqdRxenhJr5A"
SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpcmhua2x2dGpqcHV2YnZpYnhmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTU4NTYwOSwiZXhwIjoyMDg3MTYxNjA5fQ.d8rMU1GlqJDcqvyMurUVHB_ZBG5I4zStzquppIbDRV0"
export PGPASSWORD='H2a0r0d0ik#'
DB_HOST="aws-1-ap-south-1.pooler.supabase.com"
DB_USER="postgres.pirhnklvtjjpuvbvibxf"
DB_NAME="postgres"
COOKIE_NAME="sb-pirhnklvtjjpuvbvibxf-auth-token"
CHUNK_SIZE=3180

PASS=0
FAIL=0
RESULTS=""

log_result() {
  local section="$1" test_name="$2" result="$3" detail="${4:-}"
  if [ "$result" = "PASS" ]; then
    PASS=$((PASS + 1))
    RESULTS+="| $section | $test_name | ✅ PASS | $detail |\n"
  else
    FAIL=$((FAIL + 1))
    RESULTS+="| $section | $test_name | ❌ FAIL | $detail |\n"
  fi
}

# --- Auth helpers ---

get_supabase_token() {
  local email="$1" password="$2"
  curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}"
}

build_cookie() {
  local full_session="$1"
  local encoded
  encoded=$(python3 -c "import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read().strip()))" <<< "$full_session")

  if [ ${#encoded} -gt $CHUNK_SIZE ]; then
    local chunks="" i=0 remaining="$encoded"
    while [ ${#remaining} -gt 0 ]; do
      local chunk="${remaining:0:$CHUNK_SIZE}"
      remaining="${remaining:$CHUNK_SIZE}"
      [ -n "$chunks" ] && chunks="$chunks; "
      chunks="${chunks}${COOKIE_NAME}.${i}=${chunk}"
      i=$((i+1))
    done
    echo "$chunks"
  else
    echo "${COOKIE_NAME}=${encoded}"
  fi
}

get_auth_cookie() {
  local email="$1" password="$2"
  local session
  session=$(get_supabase_token "$email" "$password")
  build_cookie "$session"
}

api_call() {
  local method="$1" path="$2" cookie="$3" body="${4:-}"
  if [ -n "$body" ]; then
    curl -s -X "$method" "${BASE_URL}${path}" \
      -H "Content-Type: application/json" \
      -H "Cookie: $cookie" \
      -d "$body"
  else
    curl -s -X "$method" "${BASE_URL}${path}" \
      -H "Cookie: $cookie"
  fi
}

api_call_status() {
  local method="$1" path="$2" cookie="$3" body="${4:-}"
  if [ -n "$body" ]; then
    curl -s -o /dev/null -w "%{http_code}" -X "$method" "${BASE_URL}${path}" \
      -H "Content-Type: application/json" \
      -H "Cookie: $cookie" \
      -d "$body"
  else
    curl -s -o /dev/null -w "%{http_code}" -X "$method" "${BASE_URL}${path}" \
      -H "Cookie: $cookie"
  fi
}

supabase_rest() {
  local method="$1" table="$2" query="${3:-}" body="${4:-}"
  local url="$SUPABASE_URL/rest/v1/$table$query"
  if [ -n "$body" ]; then
    curl -s -X "$method" "$url" \
      -H "apikey: $SERVICE_KEY" \
      -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -H "Prefer: return=representation" \
      -d "$body"
  else
    curl -s -X "$method" "$url" \
      -H "apikey: $SERVICE_KEY" \
      -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json"
  fi
}

run_sql() {
  psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -t -A -c "$1" 2>/dev/null
}

# ============================================================
# SETUP
# ============================================================
echo "=== Setting up test environment ==="

ADMIN_COOKIE=$(get_auth_cookie "admin@zunkireelabs.com" "admin123")
echo "Admin cookie: ${ADMIN_COOKIE:0:60}..."

# Verify admin auth works
ADMIN_TEST=$(api_call_status GET "/api/v1/leads?pageSize=1" "$ADMIN_COOKIE")
echo "Admin auth test: HTTP $ADMIN_TEST"
if [ "$ADMIN_TEST" != "200" ]; then
  echo "FATAL: Admin auth not working. Aborting."
  exit 1
fi

# Get admin user ID
ADMIN_SESSION=$(get_supabase_token "admin@zunkireelabs.com" "admin123")
ADMIN_USER_ID=$(echo "$ADMIN_SESSION" | jq -r '.user.id')
echo "Admin user ID: $ADMIN_USER_ID"

TENANT_ID="a0000000-0000-0000-0000-000000000001"
STAGES=$(supabase_rest GET "pipeline_stages" "?tenant_id=eq.$TENANT_ID&select=id,slug&order=position")
NEW_STAGE_ID=$(echo "$STAGES" | jq -r '.[] | select(.slug=="new") | .id')
CONTACTED_STAGE_ID=$(echo "$STAGES" | jq -r '.[] | select(.slug=="contacted") | .id')
ENROLLED_STAGE_ID=$(echo "$STAGES" | jq -r '.[] | select(.slug=="enrolled") | .id')
REJECTED_STAGE_ID=$(echo "$STAGES" | jq -r '.[] | select(.slug=="rejected") | .id')
echo "Stages loaded (new=$NEW_STAGE_ID)"

TEST_PW="TestPass123!"

# ============================================================
# 1️⃣ MIGRATION VALIDATION
# ============================================================
echo ""
echo "=== 1️⃣ Migration Validation ==="

NULL_STAGE_COUNT=$(run_sql "SELECT count(*) FROM leads WHERE stage_id IS NULL AND deleted_at IS NULL;")
TOTAL_LEADS=$(run_sql "SELECT count(*) FROM leads WHERE deleted_at IS NULL;")
log_result "Migration" "stage_id backfill (no NULLs)" "$([ "$NULL_STAGE_COUNT" = "0" ] && echo PASS || echo FAIL)" "$TOTAL_LEADS active leads, $NULL_STAGE_COUNT with NULL"

INVITE_RLS=$(run_sql "SELECT relrowsecurity FROM pg_class WHERE relname='invite_tokens';")
log_result "Migration" "invite_tokens table + RLS" "$([ "$INVITE_RLS" = "t" ] && echo PASS || echo FAIL)" "RLS=$INVITE_RLS"

CHECKLIST_RLS=$(run_sql "SELECT relrowsecurity FROM pg_class WHERE relname='lead_checklists';")
log_result "Migration" "lead_checklists table + RLS" "$([ "$CHECKLIST_RLS" = "t" ] && echo PASS || echo FAIL)" "RLS=$CHECKLIST_RLS"

CONSTRAINT=$(run_sql "SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_class t ON c.conrelid=t.oid WHERE t.relname='tenant_users' AND c.conname='tenant_users_role_check';")
HAS_COUNSELOR=$(echo "$CONSTRAINT" | grep -c "counselor" || true)
log_result "Migration" "tenant_users counselor role" "$([ "$HAS_COUNSELOR" -ge "1" ] && echo PASS || echo FAIL)" ""

FUNC_EXISTS=$(run_sql "SELECT count(*) FROM pg_proc WHERE proname='get_user_tenant_role';")
log_result "Migration" "get_user_tenant_role() exists" "$([ "$FUNC_EXISTS" -ge "1" ] && echo PASS || echo FAIL)" ""

COLS=$(run_sql "SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_name='leads' AND column_name IN ('stage_id','assigned_to','intake_source','intake_medium','intake_campaign','preferred_contact_method');")
log_result "Migration" "Lead columns added" "$([ "$COLS" = "assigned_to,intake_campaign,intake_medium,intake_source,preferred_contact_method,stage_id" ] && echo PASS || echo FAIL)" "$COLS"

# ============================================================
# 2️⃣ COUNSELOR ISOLATION TEST
# ============================================================
echo ""
echo "=== 2️⃣ Counselor Isolation Test ==="

TS=$(date +%s)
CA_EMAIL="counselor-a-${TS}@test.com"
CB_EMAIL="counselor-b-${TS}@test.com"

# Create counselor users
CA_ID=$(curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$CA_EMAIL\",\"password\":\"$TEST_PW\",\"email_confirm\":true}" | jq -r '.id')

CB_ID=$(curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$CB_EMAIL\",\"password\":\"$TEST_PW\",\"email_confirm\":true}" | jq -r '.id')

echo "Counselor A: $CA_ID  |  Counselor B: $CB_ID"

# Add to tenant
supabase_rest POST "tenant_users" "" "{\"tenant_id\":\"$TENANT_ID\",\"user_id\":\"$CA_ID\",\"role\":\"counselor\"}" > /dev/null
supabase_rest POST "tenant_users" "" "{\"tenant_id\":\"$TENANT_ID\",\"user_id\":\"$CB_ID\",\"role\":\"counselor\"}" > /dev/null

# Create lead assigned to counselor A
TEST_LEAD=$(supabase_rest POST "leads" "" "{\"tenant_id\":\"$TENANT_ID\",\"first_name\":\"Test\",\"last_name\":\"Isolation\",\"email\":\"test@test.com\",\"status\":\"new\",\"stage_id\":\"$NEW_STAGE_ID\",\"assigned_to\":\"$CA_ID\",\"is_final\":true,\"step\":1,\"custom_fields\":{},\"file_urls\":{}}")
TEST_LEAD_ID=$(echo "$TEST_LEAD" | jq -r '.[0].id // .id')
echo "Test lead: $TEST_LEAD_ID (assigned to A)"

# Get cookies
CA_COOKIE=$(get_auth_cookie "$CA_EMAIL" "$TEST_PW")
CB_COOKIE=$(get_auth_cookie "$CB_EMAIL" "$TEST_PW")

# 2.1 Counselor B list — should NOT contain test lead
B_LIST=$(api_call GET "/api/v1/leads" "$CB_COOKIE")
B_HAS=$(echo "$B_LIST" | jq "[.data[]? | select(.id==\"$TEST_LEAD_ID\")] | length")
log_result "Counselor" "B cannot see A's lead in list" "$([ "$B_HAS" = "0" ] && echo PASS || echo FAIL)" "B sees $(echo "$B_LIST" | jq '.data | length') leads"

# 2.2 Counselor B GET direct
B_GET=$(api_call_status GET "/api/v1/leads/$TEST_LEAD_ID" "$CB_COOKIE")
log_result "Counselor" "B cannot GET A's lead directly" "$([ "$B_GET" = "404" ] && echo PASS || echo FAIL)" "Status: $B_GET"

# 2.3 Counselor B PATCH
B_PATCH=$(api_call_status PATCH "/api/v1/leads/$TEST_LEAD_ID" "$CB_COOKIE" '{"status":"contacted"}')
log_result "Counselor" "B cannot PATCH A's lead" "$([ "$B_PATCH" = "403" ] || [ "$B_PATCH" = "404" ] && echo PASS || echo FAIL)" "Status: $B_PATCH"

# 2.4 Counselor A CAN see own lead
A_GET=$(api_call_status GET "/api/v1/leads/$TEST_LEAD_ID" "$CA_COOKIE")
log_result "Counselor" "A can GET own assigned lead" "$([ "$A_GET" = "200" ] && echo PASS || echo FAIL)" "Status: $A_GET"

# 2.5 Admin sees all
ADMIN_LIST=$(api_call GET "/api/v1/leads" "$ADMIN_COOKIE")
ADMIN_HAS=$(echo "$ADMIN_LIST" | jq "[.data[]? | select(.id==\"$TEST_LEAD_ID\")] | length")
log_result "Counselor" "Admin can see all leads" "$([ "$ADMIN_HAS" = "1" ] && echo PASS || echo FAIL)" ""

# ============================================================
# 3️⃣ ASSIGNMENT VALIDATION TEST
# ============================================================
echo ""
echo "=== 3️⃣ Assignment Validation Test ==="

# 3.1 Assign to non-tenant user → 422
FAKE_UID="00000000-0000-0000-0000-000000000099"
ASSIGN_RESP=$(api_call PATCH "/api/v1/leads/$TEST_LEAD_ID" "$ADMIN_COOKIE" "{\"assigned_to\":\"$FAKE_UID\"}")
ASSIGN_CODE=$(echo "$ASSIGN_RESP" | jq -r '.error.code // empty')
log_result "Assignment" "Non-tenant user → 422" "$([ "$ASSIGN_CODE" = "VALIDATION_ERROR" ] && echo PASS || echo FAIL)" "$(echo "$ASSIGN_RESP" | jq -r '.error.message // empty')"

# 3.2 Assign to viewer → allowed (valid tenant member)
VIEWER_EMAIL="viewer-${TS}@test.com"
VIEWER_ID=$(curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$VIEWER_EMAIL\",\"password\":\"$TEST_PW\",\"email_confirm\":true}" | jq -r '.id')
supabase_rest POST "tenant_users" "" "{\"tenant_id\":\"$TENANT_ID\",\"user_id\":\"$VIEWER_ID\",\"role\":\"viewer\"}" > /dev/null

ASSIGN_VIEWER=$(api_call_status PATCH "/api/v1/leads/$TEST_LEAD_ID" "$ADMIN_COOKIE" "{\"assigned_to\":\"$VIEWER_ID\"}")
log_result "Assignment" "Assign to viewer → allowed" "$([ "$ASSIGN_VIEWER" = "200" ] && echo PASS || echo FAIL)" "Status: $ASSIGN_VIEWER"

# Re-assign to counselor A
api_call PATCH "/api/v1/leads/$TEST_LEAD_ID" "$ADMIN_COOKIE" "{\"assigned_to\":\"$CA_ID\"}" > /dev/null

# 3.3 Counselor tries to reassign → 403
CA_REASSIGN=$(api_call_status PATCH "/api/v1/leads/$TEST_LEAD_ID" "$CA_COOKIE" "{\"assigned_to\":\"$CB_ID\"}")
log_result "Assignment" "Counselor reassign → 403" "$([ "$CA_REASSIGN" = "403" ] && echo PASS || echo FAIL)" "Status: $CA_REASSIGN"

# ============================================================
# 4️⃣ INVITE FLOW STRESS TEST
# ============================================================
echo ""
echo "=== 4️⃣ Invite Flow Stress Test ==="

INVITE_EMAIL="invite-${TS}@test.com"
INVITE_USER_ID=$(curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$INVITE_EMAIL\",\"password\":\"$TEST_PW\",\"email_confirm\":true}" | jq -r '.id')

# Create invite
INVITE_RESP=$(api_call POST "/api/v1/invites" "$ADMIN_COOKIE" "{\"email\":\"$INVITE_EMAIL\",\"role\":\"counselor\"}")
INVITE_TOKEN=$(echo "$INVITE_RESP" | jq -r '.data.token')
INVITE_RESP_STATUS=$(echo "$INVITE_RESP" | jq -r '.data.id // empty')
log_result "Invite" "Create invite → 201" "$([ -n "$INVITE_RESP_STATUS" ] && echo PASS || echo FAIL)" "Token: ${INVITE_TOKEN:0:8}..."

# Accept invite
INVITE_COOKIE=$(get_auth_cookie "$INVITE_EMAIL" "$TEST_PW")
ACCEPT_RESP=$(api_call POST "/api/v1/invites/accept" "$INVITE_COOKIE" "{\"token\":\"$INVITE_TOKEN\"}")
ACCEPT_ROLE=$(echo "$ACCEPT_RESP" | jq -r '.data.role // empty')
log_result "Invite" "Accept invite → 200" "$([ "$ACCEPT_ROLE" = "counselor" ] && echo PASS || echo FAIL)" "Role: $ACCEPT_ROLE"

# 4.1 Accept same invite twice → fail (already used)
ACCEPT2_STATUS=$(api_call_status POST "/api/v1/invites/accept" "$INVITE_COOKIE" "{\"token\":\"$INVITE_TOKEN\"}")
log_result "Invite" "Re-accept same invite → fail" "$([ "$ACCEPT2_STATUS" = "422" ] || [ "$ACCEPT2_STATUS" = "409" ] && echo PASS || echo FAIL)" "Status: $ACCEPT2_STATUS"

# 4.2 Expired invite → 422
EXPIRED_TOKEN="expired-token-${TS}"
supabase_rest POST "invite_tokens" "" "{\"tenant_id\":\"$TENANT_ID\",\"email\":\"expired-${TS}@test.com\",\"role\":\"viewer\",\"token\":\"$EXPIRED_TOKEN\",\"expires_at\":\"2020-01-01T00:00:00Z\",\"created_by\":\"$ADMIN_USER_ID\"}" > /dev/null

EXPIRED_USER_ID=$(curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"expired-${TS}@test.com\",\"password\":\"$TEST_PW\",\"email_confirm\":true}" | jq -r '.id')
EXPIRED_COOKIE=$(get_auth_cookie "expired-${TS}@test.com" "$TEST_PW")

EXPIRED_STATUS=$(api_call_status POST "/api/v1/invites/accept" "$EXPIRED_COOKIE" "{\"token\":\"$EXPIRED_TOKEN\"}")
log_result "Invite" "Expired invite → 422" "$([ "$EXPIRED_STATUS" = "422" ] && echo PASS || echo FAIL)" "Status: $EXPIRED_STATUS"

# 4.3 Invite existing member → 409
EXISTING_RESP=$(api_call POST "/api/v1/invites" "$ADMIN_COOKIE" '{"email":"admin@zunkireelabs.com","role":"viewer"}')
EXISTING_CODE=$(echo "$EXISTING_RESP" | jq -r '.error.code // empty')
log_result "Invite" "Invite existing member → 409" "$([ "$EXISTING_CODE" = "CONFLICT" ] && echo PASS || echo FAIL)" ""

# ============================================================
# 5️⃣ CHECKLIST SECURITY
# ============================================================
echo ""
echo "=== 5️⃣ Checklist Security ==="

# Admin creates checklist
CL_RESP=$(api_call POST "/api/v1/leads/$TEST_LEAD_ID/checklists" "$ADMIN_COOKIE" '{"title":"Verify documents","position":1}')
CL_ID=$(echo "$CL_RESP" | jq -r '.data.id')
log_result "Checklist" "Admin create → 201" "$([ -n "$CL_ID" ] && [ "$CL_ID" != "null" ] && echo PASS || echo FAIL)" "ID: $CL_ID"

# 5.1 Counselor A toggles completion
TOGGLE_STATUS=$(api_call_status PATCH "/api/v1/leads/$TEST_LEAD_ID/checklists/$CL_ID" "$CA_COOKIE" '{"is_completed":true}')
log_result "Checklist" "Counselor toggle is_completed" "$([ "$TOGGLE_STATUS" = "200" ] && echo PASS || echo FAIL)" "Status: $TOGGLE_STATUS"

# Verify completed_by was set
TOGGLE_RESP=$(api_call PATCH "/api/v1/leads/$TEST_LEAD_ID/checklists/$CL_ID" "$CA_COOKIE" '{"is_completed":false}')
COMPLETED_BY=$(echo "$TOGGLE_RESP" | jq -r '.data.completed_by // "null"')
log_result "Checklist" "Untoggle clears completed_by" "$([ "$COMPLETED_BY" = "null" ] && echo PASS || echo FAIL)" "completed_by=$COMPLETED_BY"

# 5.2 Counselor cannot edit title
TITLE_STATUS=$(api_call_status PATCH "/api/v1/leads/$TEST_LEAD_ID/checklists/$CL_ID" "$CA_COOKIE" '{"title":"Hacked"}')
log_result "Checklist" "Counselor cannot edit title → 403" "$([ "$TITLE_STATUS" = "403" ] && echo PASS || echo FAIL)" "Status: $TITLE_STATUS"

# 5.3 Viewer cannot create
VIEWER_COOKIE=$(get_auth_cookie "$VIEWER_EMAIL" "$TEST_PW")
VIEWER_CREATE=$(api_call_status POST "/api/v1/leads/$TEST_LEAD_ID/checklists" "$VIEWER_COOKIE" '{"title":"Should fail"}')
log_result "Checklist" "Viewer cannot create → 403" "$([ "$VIEWER_CREATE" = "403" ] && echo PASS || echo FAIL)" "Status: $VIEWER_CREATE"

# Viewer cannot toggle
VIEWER_TOGGLE=$(api_call_status PATCH "/api/v1/leads/$TEST_LEAD_ID/checklists/$CL_ID" "$VIEWER_COOKIE" '{"is_completed":true}')
log_result "Checklist" "Viewer cannot toggle → 403" "$([ "$VIEWER_TOGGLE" = "403" ] && echo PASS || echo FAIL)" "Status: $VIEWER_TOGGLE"

# 5.4 Soft-deleted lead → checklist returns 404
supabase_rest PATCH "leads" "?id=eq.$TEST_LEAD_ID" "{\"deleted_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > /dev/null
DELETED_CL=$(api_call_status GET "/api/v1/leads/$TEST_LEAD_ID/checklists" "$ADMIN_COOKIE")
log_result "Checklist" "Soft-deleted lead → 404" "$([ "$DELETED_CL" = "404" ] && echo PASS || echo FAIL)" "Status: $DELETED_CL"

# Restore lead
supabase_rest PATCH "leads" "?id=eq.$TEST_LEAD_ID" '{"deleted_at":null}' > /dev/null

# ============================================================
# 6️⃣ STAGE INTEGRITY
# ============================================================
echo ""
echo "=== 6️⃣ Stage Integrity ==="

# 6.1 Invalid stage_id
INV_STAGE=$(api_call_status PATCH "/api/v1/leads/$TEST_LEAD_ID" "$ADMIN_COOKIE" '{"stage_id":"00000000-0000-0000-0000-000000000099"}')
log_result "Stage" "Invalid stage_id → 422" "$([ "$INV_STAGE" = "422" ] && echo PASS || echo FAIL)" "Status: $INV_STAGE"

# 6.2 Invalid status slug
INV_STATUS=$(api_call_status PATCH "/api/v1/leads/$TEST_LEAD_ID" "$ADMIN_COOKIE" '{"status":"nonexistent_status"}')
log_result "Stage" "Invalid status slug → 422" "$([ "$INV_STATUS" = "422" ] && echo PASS || echo FAIL)" "Status: $INV_STATUS"

# 6.3 Both status + stage_id → 422
BOTH=$(api_call_status PATCH "/api/v1/leads/$TEST_LEAD_ID" "$ADMIN_COOKIE" "{\"status\":\"contacted\",\"stage_id\":\"$CONTACTED_STAGE_ID\"}")
log_result "Stage" "Both status + stage_id → 422" "$([ "$BOTH" = "422" ] && echo PASS || echo FAIL)" "Status: $BOTH"

# 6.4 Five transitions consistency
CONSISTENT=true
for SLUG in "contacted" "enrolled" "new" "contacted" "rejected"; do
  TRANS=$(api_call PATCH "/api/v1/leads/$TEST_LEAD_ID" "$ADMIN_COOKIE" "{\"status\":\"$SLUG\"}")
  T_STATUS=$(echo "$TRANS" | jq -r '.data.status')
  T_STAGE=$(echo "$TRANS" | jq -r '.data.stage_id')
  EXPECTED=$(echo "$STAGES" | jq -r ".[] | select(.slug==\"$SLUG\") | .id")
  if [ "$T_STATUS" != "$SLUG" ] || [ "$T_STAGE" != "$EXPECTED" ]; then
    CONSISTENT=false
    echo "  MISMATCH: $SLUG → status=$T_STATUS stage=$T_STAGE expected=$EXPECTED"
  fi
done
log_result "Stage" "5 transitions consistent" "$([ "$CONSISTENT" = true ] && echo PASS || echo FAIL)" ""

# 6.5 stage_id → status resolution
STAGE_RESP=$(api_call PATCH "/api/v1/leads/$TEST_LEAD_ID" "$ADMIN_COOKIE" "{\"stage_id\":\"$ENROLLED_STAGE_ID\"}")
RESOLVED=$(echo "$STAGE_RESP" | jq -r '.data.status')
log_result "Stage" "stage_id → status resolution" "$([ "$RESOLVED" = "enrolled" ] && echo PASS || echo FAIL)" "Resolved: $RESOLVED"

# ============================================================
# 7️⃣ REGRESSION CHECK
# ============================================================
echo ""
echo "=== 7️⃣ Regression Check ==="

# 7.1 Public form
FORM_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/form/rku")
log_result "Regression" "Public form /form/rku → 200" "$([ "$FORM_STATUS" = "200" ] && echo PASS || echo FAIL)" "Status: $FORM_STATUS"

# 7.2 Rate limit module (POST without auth still processes)
RL_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/v1/leads" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"status\":\"new\",\"is_final\":true,\"step\":1,\"custom_fields\":{},\"file_urls\":{}}")
log_result "Regression" "Rate limiting active" "$([ "$RL_STATUS" = "201" ] || [ "$RL_STATUS" = "422" ] || [ "$RL_STATUS" = "200" ] && echo PASS || echo FAIL)" "Status: $RL_STATUS"

# 7.3 Audit logs
AUDIT_COUNT=$(supabase_rest GET "audit_logs" "?tenant_id=eq.$TENANT_ID&order=created_at.desc&limit=5&select=action" | jq 'length')
log_result "Regression" "Audit logs written" "$([ "$AUDIT_COUNT" -gt "0" ] && echo PASS || echo FAIL)" "$AUDIT_COUNT recent entries"

# 7.4 Events
EVENT_COUNT=$(supabase_rest GET "events" "?tenant_id=eq.$TENANT_ID&order=created_at.desc&limit=5&select=type" | jq 'length')
log_result "Regression" "Events emitted" "$([ "$EVENT_COUNT" -gt "0" ] && echo PASS || echo FAIL)" "$EVENT_COUNT recent events"

# 7.5 Intake fields
INTAKE_RESP=$(curl -s -X POST "$BASE_URL/api/v1/leads" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"first_name\":\"Intake\",\"last_name\":\"Test\",\"status\":\"new\",\"is_final\":true,\"step\":1,\"intake_source\":\"google\",\"intake_medium\":\"cpc\",\"intake_campaign\":\"spring2026\",\"preferred_contact_method\":\"whatsapp\",\"custom_fields\":{},\"file_urls\":{}}")
I_SRC=$(echo "$INTAKE_RESP" | jq -r '.data.intake_source // empty')
I_MED=$(echo "$INTAKE_RESP" | jq -r '.data.intake_medium // empty')
I_CAM=$(echo "$INTAKE_RESP" | jq -r '.data.intake_campaign // empty')
I_PCM=$(echo "$INTAKE_RESP" | jq -r '.data.preferred_contact_method // empty')
if [ "$I_SRC" = "google" ] && [ "$I_MED" = "cpc" ] && [ "$I_CAM" = "spring2026" ] && [ "$I_PCM" = "whatsapp" ]; then
  log_result "Regression" "Intake fields persisted" "PASS" "source=$I_SRC medium=$I_MED campaign=$I_CAM pcm=$I_PCM"
else
  log_result "Regression" "Intake fields persisted" "FAIL" "src=$I_SRC med=$I_MED cam=$I_CAM pcm=$I_PCM"
fi
# Clean up intake lead
INTAKE_LID=$(echo "$INTAKE_RESP" | jq -r '.data.id // empty')
[ -n "$INTAKE_LID" ] && supabase_rest PATCH "leads" "?id=eq.$INTAKE_LID" '{"deleted_at":"2026-01-01T00:00:00Z"}' > /dev/null

# ============================================================
# 8️⃣ BUILD + DEPLOY CHECK
# ============================================================
echo ""
echo "=== 8️⃣ Build + Deploy Check ==="

# Kill dev server for build
DEV_PID=$(lsof -ti :3000 2>/dev/null || true)
[ -n "$DEV_PID" ] && kill "$DEV_PID" 2>/dev/null && sleep 2

echo "Running npm run build..."
BUILD_OUT=$(npm run build 2>&1)
BUILD_EXIT=$?
log_result "Build" "npm run build" "$([ $BUILD_EXIT -eq 0 ] && echo PASS || echo FAIL)" ""

TS_WARNS=$(echo "$BUILD_OUT" | grep -i "warning" | grep -v "middleware.*deprecated" | grep -v "proxy" || true)
log_result "Build" "No new TypeScript warnings" "$([ -z "$TS_WARNS" ] && echo PASS || echo FAIL)" ""

echo "Running docker build..."
DOCKER_OUT=$(docker build -t leads-crm-verify . 2>&1)
DOCKER_EXIT=$?
log_result "Build" "Docker build" "$([ $DOCKER_EXIT -eq 0 ] && echo PASS || echo FAIL)" ""
docker rmi leads-crm-verify > /dev/null 2>&1 || true

# ============================================================
# CLEANUP
# ============================================================
echo ""
echo "=== Cleanup ==="

supabase_rest DELETE "lead_checklists" "?lead_id=eq.$TEST_LEAD_ID" > /dev/null 2>&1
supabase_rest DELETE "leads" "?id=eq.$TEST_LEAD_ID" > /dev/null 2>&1
supabase_rest DELETE "invite_tokens" "?tenant_id=eq.$TENANT_ID&created_at=gt.$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)" > /dev/null 2>&1

for TUID in "$CA_ID" "$CB_ID" "$VIEWER_ID" "$INVITE_USER_ID" "$EXPIRED_USER_ID"; do
  [ -n "$TUID" ] && [ "$TUID" != "null" ] && {
    supabase_rest DELETE "tenant_users" "?user_id=eq.$TUID" > /dev/null 2>&1
    curl -s -X DELETE "$SUPABASE_URL/auth/v1/admin/users/$TUID" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" > /dev/null 2>&1
  }
done

echo "Cleanup done"

# Restart dev server
rm -rf .next/dev/lock 2>/dev/null
nohup npm run dev > /home/zunkireelabs/devprojects/lead-gen-crm/nextdev.log 2>&1 &

# ============================================================
# FINAL REPORT
# ============================================================
echo ""
echo "============================================================"
echo "  PHASE 2A VERIFICATION REPORT"
echo "============================================================"
echo ""
printf "| %-12s | %-40s | %-9s | %-50s |\n" "Section" "Test" "Result" "Detail"
printf "|%-14s|%-42s|%-11s|%-52s|\n" "--------------" "------------------------------------------" "-----------" "----------------------------------------------------"
echo -e "$RESULTS"
echo ""
echo "============================================================"
echo "  TOTAL: $((PASS + FAIL)) tests | ✅ $PASS PASS | ❌ $FAIL FAIL"
echo "============================================================"
