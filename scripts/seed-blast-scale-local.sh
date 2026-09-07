#!/usr/bin/env bash
# seed-blast-scale-local.sh — provision a dedicated tenant with a large,
# synthetic lead audience on the LOCAL isolated DB, sized to reproduce the
# PostgREST 1000-row-cap / URL-length bug class fixed on
# fix/blast-materialize-resilience (see TEST-PLAN-BLAST-SCALE.md).
#
# Idempotent: safe to re-run (ON CONFLICT DO NOTHING/UPDATE throughout).
# Does NOT touch stage or prod — local Docker Supabase stack only.
#
#   ./scripts/seed-blast-scale-local.sh            # 16000 leads (default)
#   LEAD_COUNT=2000 ./scripts/seed-blast-scale-local.sh   # smaller/faster run
#
# Local login:  blast-test@local.test / edgexdev123
set -euo pipefail

API_URL="http://127.0.0.1:54321"
SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
LOCAL_DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

EMAIL="blast-test@local.test"
PASSWORD="edgexdev123"
TENANT_ID="44444444-4444-4444-4444-444444444444"
PIPELINE_ID="44444444-4444-4444-4444-000000000010"
STAGE_ID="44444444-4444-4444-4444-000000000020"
LIST_ID="44444444-4444-4444-4444-000000000030"
LEAD_COUNT="${LEAD_COUNT:-16000}"

echo "→ Ensuring local stack is reachable..."
if ! curl -sf "$API_URL/rest/v1/" -H "apikey: $SERVICE_ROLE_KEY" >/dev/null 2>&1; then
  echo "  Local API not reachable at $API_URL — run 'supabase start' first." >&2
  exit 1
fi

# ensure_user <email> -> echoes the auth uid (creates if absent, idempotent)
ensure_user() {
  local email="$1" resp uid
  resp="$(curl -s -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$PASSWORD\",\"email_confirm\":true}")"
  uid="$(echo "$resp" | sed -nE 's/.*"id":"([0-9a-f-]{36})".*/\1/p' | head -1)"
  if [ -z "$uid" ]; then
    uid="$(psql "$LOCAL_DB" -tAc "select id from auth.users where email='$email' limit 1;")"
  fi
  [ -z "$uid" ] && { echo "  Could not create or find $email. Response: $resp" >&2; exit 1; }
  echo "$uid"
}

echo "→ Creating (or finding) auth user $EMAIL..."
AUTH_UID="$(ensure_user "$EMAIL")"
echo "  owner user_id = $AUTH_UID"

echo "→ Seeding blast-scale-test tenant + settings (no leads yet)..."
psql "$LOCAL_DB" -v ON_ERROR_STOP=1 <<SQL

BEGIN;

-- 1. Dedicated tenant — kept separate from admizz-local so this can be
--    wiped/re-sized independently and never collides with demo-data tests.
INSERT INTO public.tenants (id, name, slug, primary_color, industry_id, config, entitlement_overrides)
VALUES (
  '$TENANT_ID', 'Blast Scale Test', 'blast-scale-test', '#111827', 'education_consultancy',
  '{}'::jsonb,
  '{"sms_enabled": true}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET entitlement_overrides = EXCLUDED.entitlement_overrides;

INSERT INTO public.tenant_users (tenant_id, user_id, role)
VALUES ('$TENANT_ID', '$AUTH_UID', 'owner')
ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'owner';

-- 2. One pipeline / stage / list — audience filter just needs "stage is this one".
INSERT INTO public.pipelines (id, tenant_id, name, slug, is_default, position)
VALUES ('$PIPELINE_ID', '$TENANT_ID', 'Test Pipeline', 'test-pipeline', true, 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipeline_stages (id, pipeline_id, tenant_id, name, slug, position, color, is_default, is_terminal)
VALUES ('$STAGE_ID', '$PIPELINE_ID', '$TENANT_ID', 'New', 'new', 0, '#3b82f6', true, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.lead_lists (id, tenant_id, name, slug, sort_order, is_system, is_intake, color, access, pipeline_id)
VALUES ('$LIST_ID', '$TENANT_ID', 'All Test Leads', 'all-test-leads', 1, true, true, '#6366f1', '{"mode":"all"}'::jsonb, '$PIPELINE_ID')
ON CONFLICT (id) DO UPDATE SET pipeline_id = EXCLUDED.pipeline_id;

-- 3. SMS: raise the per-blast cap well above LEAD_COUNT (default 500 would
--    reject-not-truncate a real-scale audience), fund enough credits, and
--    disable quiet hours so the test send isn't deferred waiting for a window.
INSERT INTO public.tenant_sms_settings (tenant_id, max_recipients_per_blast, quiet_hours_enabled, low_credit_threshold)
VALUES ('$TENANT_ID', 20000, false, 0)
ON CONFLICT (tenant_id) DO UPDATE SET max_recipients_per_blast = 20000, quiet_hours_enabled = false, low_credit_threshold = 0;

INSERT INTO public.sms_credit_accounts (tenant_id, balance, lifetime_granted)
VALUES ('$TENANT_ID', 50000, 50000)
ON CONFLICT (tenant_id) DO UPDATE SET balance = 50000, lifetime_granted = GREATEST(sms_credit_accounts.lifetime_granted, 50000);

-- 4. Email: enable bulk send, raise the daily cap AND the per-blast recipient
--    cap (F4, migration 228 — added after this script was first written)
--    above LEAD_COUNT so the test send completes in one pass instead of
--    throttling across days or being rejected outright by MAX_RECIPIENTS_EXCEEDED.
--
--    domain_verified is deliberately FALSE (bounce-cause investigation,
--    2026-09-07): a prior version of this script set it TRUE with
--    from_address='test@local.test', which is never actually verified with
--    Resend. sender.ts (see src/lib/email/sender.ts) only uses from_address
--    when domain_verified is true, so that config made every real send in
--    this tenant use test@local.test as the From: address — and Resend
--    deterministically rejected 100% of those with "The local.test domain is
--    not verified" (confirmed via the leftover email_messages rows from the
--    2026-09-06 run, source_id 5464a828-d265-47ab-b48f-1f2c0bd08823: 5,400/5,400
--    attempted rows failed with that exact error). This is what was originally
--    misreported as a "3-12% provider_error bounce rate" — it was actually a
--    100% failure of every row actually attempted, not a partial/random one.
--    false here matches every other tenant without a real custom domain:
--    sender.ts falls back to the safe, real, verified platform address.
INSERT INTO public.tenant_email_settings (tenant_id, from_name, from_address, reply_to, domain_verified, bulk_email_enabled, daily_send_cap, max_recipients_per_blast)
VALUES ('$TENANT_ID', 'Blast Scale Test', 'test@local.test', 'test@local.test', false, true, 20000, 20000)
ON CONFLICT (tenant_id) DO UPDATE SET domain_verified = false, bulk_email_enabled = true, daily_send_cap = 20000, max_recipients_per_blast = 20000;

COMMIT;
SQL

echo "→ Bulk-inserting $LEAD_COUNT synthetic leads (this is the part that reproduces real scale)..."
psql "$LOCAL_DB" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO public.leads (
  tenant_id, first_name, last_name, email, phone,
  pipeline_id, stage_id, list_id, tags, intake_source, intake_medium,
  is_final, status, country, custom_fields, display_id
)
SELECT
  '$TENANT_ID',
  'Test',
  'Lead ' || i,
  'blast.test.' || i || '@local.test',
  -- Valid Nepal MSISDN shape required by src/lib/sms/phone.ts's
  -- toProviderRecipient: +977 then (97|98) + 8 digits, all unique.
  '+97798' || lpad(i::text, 8, '0'),
  '$PIPELINE_ID', '$STAGE_ID', '$LIST_ID',
  ARRAY['blast-scale-test'], 'seed_script', 'synthetic',
  true, 'new', 'Nepal', '{}'::jsonb,
  'BST-' || lpad(i::text, 6, '0')
FROM generate_series(1, $LEAD_COUNT) AS i
-- uq_leads_tenant_display_id (migration 085) is a PARTIAL unique index
-- (WHERE display_id IS NOT NULL) — a bare ON CONFLICT (tenant_id, display_id)
-- doesn't match a partial index (42P10), same bug class as
-- uq_sms_message_blast_lead documented in CLAUDE.md. Every display_id here
-- is always non-null, so restating that same WHERE clause matches it.
ON CONFLICT (tenant_id, display_id) WHERE display_id IS NOT NULL DO NOTHING;
SQL

LEAD_TOTAL="$(psql "$LOCAL_DB" -tAc "select count(*) from public.leads where tenant_id = '$TENANT_ID';")"

echo ""
echo "✅ Blast-scale tenant seeded."
echo "   Login:    $EMAIL / $PASSWORD"
echo "   Tenant:   Blast Scale Test (blast-scale-test)"
echo "   Leads:    $LEAD_TOTAL total, all in stage 'New', list 'All Test Leads'"
echo "   SMS:      enabled, sandboxed by default (SMS_SANDBOX != 'false'), 50000 credits, cap 20000/blast"
echo "   Email:    bulk enabled, sandboxed by default (EMAIL_OUTBOUND_SANDBOX != 'false'), cap 20000/day"
echo "   Studio:   http://127.0.0.1:54323"
echo ""
echo "   Next: see docs/dev-collab/TEST-PLAN-BLAST-SCALE.md for the send + verify steps."
