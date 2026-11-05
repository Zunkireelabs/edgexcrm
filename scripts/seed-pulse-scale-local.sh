#!/usr/bin/env bash
# seed-pulse-scale-local.sh — Admizz-scale volume for the Pulse performance gate (EDGEX-82), LOCAL ONLY.
#
#   ./scripts/seed-pulse-local.sh          # first: staff, positions, the realistic story
#   ./scripts/seed-pulse-scale-local.sh    # then: ~17k leads, ~150k audit rows, ~60k notes, ~40k calls
#
# Same local-only guard as seed-pulse-local.sh; rows are tagged custom_fields.pulse_seed = 'scale', so a re-run of
# EITHER script removes them (seed-pulse-local.sh deletes every lead with a pulse_seed key). Idempotent.
set -euo pipefail

LOCAL_DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"   # hard-coded: never read from the environment
TENANT_ID="22222222-2222-2222-2222-222222222222"

GUARD="$(psql "$LOCAL_DB" -Atc "select coalesce((select slug || '/' || industry_id from tenants where id = '$TENANT_ID'), 'missing') || '|' || (select count(*) < 25 from tenants) || '|' || (select count(*) from tenant_users where tenant_id = '$TENANT_ID' and user_id in (select id from auth.users where email like 'pulse.%@admizz.local'))" 2>/dev/null || true)"
if [ "$GUARD" != "admizz-local/education_consultancy|true|8" ]; then
  echo "REFUSING: expected 'admizz-local/education_consultancy|true|8', got '${GUARD:-<no connection>}'." >&2
  echo "Run ./scripts/seed-education-local.sh and ./scripts/seed-pulse-local.sh first (local stack only)." >&2
  exit 1
fi

psql "$LOCAL_DB" -v ON_ERROR_STOP=1 -q <<'SQL'
\set tenant '22222222-2222-2222-2222-222222222222'
BEGIN;
SELECT setseed(0.11);

DELETE FROM audit_logs WHERE tenant_id = :'tenant' AND entity_type = 'lead'
  AND entity_id IN (SELECT id FROM leads WHERE tenant_id = :'tenant' AND custom_fields->>'pulse_seed' = 'scale');
DELETE FROM leads WHERE tenant_id = :'tenant' AND custom_fields->>'pulse_seed' = 'scale';

CREATE TEMP TABLE st ON COMMIT DROP AS
  SELECT row_number() OVER (ORDER BY u.email) AS n, tu.user_id, tu.branch_id, u.email
  FROM tenant_users tu JOIN auth.users u ON u.id = tu.user_id
  WHERE tu.tenant_id = :'tenant' AND u.email LIKE 'pulse.%@admizz.local';

CREATE TEMP TABLE ls ON COMMIT DROP AS
  SELECT row_number() OVER (ORDER BY sort_order) AS n, id, name FROM lead_lists
  WHERE tenant_id = :'tenant' AND slug IN ('pre-qualified', 'qualified', 'prospects', 'applications', 'archived');

-- 17,000 leads over 35 days
INSERT INTO leads (id, tenant_id, first_name, last_name, email, pipeline_id, stage_id, list_id, intake_source, intake_medium,
                   is_final, status, country, custom_fields, display_id, assigned_to, branch_id, created_at, updated_at)
SELECT gen_random_uuid(), :'tenant', 'Scale', 'Lead ' || g, 'scale.lead.' || g || '@pulse.invalid',
       '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000020',
       (SELECT id FROM ls WHERE n = 1 + (g % 4)), 'website', 'organic', true, 'new', 'Nepal',
       '{"pulse_seed":"scale"}'::jsonb, 'PSS-' || g,
       (SELECT user_id FROM st WHERE n = 1 + (g % 8)), (SELECT branch_id FROM st WHERE n = 1 + (g % 8)),
       now() - random() * interval '35 days', now()
FROM generate_series(1, 17000) g;

-- ~120k stage-move / status / assignment audit rows in the shapes the app writes (half without list_ids, as pre-EDGEX-82)
INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, changes, created_at)
SELECT :'tenant', (SELECT user_id FROM st WHERE n = 1 + (r % 8)), 'lead.updated', 'lead', l.id,
  CASE r % 3
    WHEN 0 THEN jsonb_build_object('list', jsonb_build_object('old', a.name, 'new', b.name))
                || CASE WHEN r % 2 = 0 THEN jsonb_build_object('list_ids', jsonb_build_object('old', a.id, 'new', b.id)) ELSE '{}'::jsonb END
                || CASE WHEN r % 4 < 3 THEN jsonb_build_object('holder', jsonb_build_object('old', null, 'new', l.assigned_to)) ELSE '{}'::jsonb END
    WHEN 1 THEN jsonb_build_object('status', jsonb_build_object('old', 'new', 'new', 'contacted'))
    ELSE jsonb_build_object('assigned_to', jsonb_build_object('old', (SELECT user_id FROM st WHERE n = 1 + ((r + 3) % 8)), 'new', l.assigned_to))
  END,
  l.created_at + random() * (now() - l.created_at)
FROM leads l
CROSS JOIN generate_series(1, 7) r
JOIN ls a ON a.n = 1 + ((r + 0) % 4)
JOIN ls b ON b.n = 1 + ((r + 1) % 4)
WHERE l.tenant_id = :'tenant' AND l.custom_fields->>'pulse_seed' = 'scale';

-- ~60k notes (some edited), ~40k calls
INSERT INTO lead_notes (lead_id, user_id, user_email, content, created_at, edited_at)
SELECT l.id, s.user_id, s.email, 'scale note', t.ts, CASE WHEN r % 9 = 0 THEN t.ts + interval '2 hours' END
FROM leads l
CROSS JOIN generate_series(1, 4) r
CROSS JOIN LATERAL (SELECT l.created_at + random() * (now() - l.created_at) AS ts) t
JOIN st s ON s.n = 1 + (abs(hashtext(l.id::text)) + r) % 8
WHERE l.tenant_id = :'tenant' AND l.custom_fields->>'pulse_seed' = 'scale' AND r <= 3 + (abs(hashtext(l.id::text)) % 2);

INSERT INTO lead_activities (lead_id, tenant_id, user_id, activity_type, subject, created_at, updated_at)
SELECT l.id, :'tenant', s.user_id, 'call', 'scale call', t.ts, t.ts
FROM leads l
CROSS JOIN generate_series(1, 3) r
CROSS JOIN LATERAL (SELECT l.created_at + random() * (now() - l.created_at) AS ts) t
JOIN st s ON s.n = 1 + (abs(hashtext(l.id::text)) + r) % 8
WHERE l.tenant_id = :'tenant' AND l.custom_fields->>'pulse_seed' = 'scale' AND r <= 2 + (abs(hashtext(l.id::text)) % 2);
COMMIT;
ANALYZE leads; ANALYZE audit_logs; ANALYZE lead_notes; ANALYZE lead_activities;
SELECT 'leads' AS what, count(*) FROM leads WHERE tenant_id = :'tenant'
UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs WHERE tenant_id = :'tenant'
UNION ALL SELECT 'lead_notes', count(*) FROM lead_notes
UNION ALL SELECT 'lead_activities', count(*) FROM lead_activities WHERE tenant_id = :'tenant';
SQL
echo "✓ Scale seed done."
