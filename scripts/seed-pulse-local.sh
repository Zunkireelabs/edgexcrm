#!/usr/bin/env bash
# seed-pulse-local.sh — 5 weeks of realistic synthetic team activity for the Pulse report (EDGEX-82),
# written into the LOCAL `admizz-local` tenant ONLY.
#
#   ./scripts/seed-education-local.sh      # once: creates admizz-local, owner admin@admizz.local / edgexdev123
#   ./scripts/seed-pulse-local.sh          # this script — safe to re-run (it replaces its own rows)
#
# SAFETY — local only, by construction:
#   * the DB URL and the Supabase API URL are hard-coded to 127.0.0.1 (no env override, no argument);
#   * before touching anything it asks the server and REFUSES unless tenant 22222222-… is `admizz-local`
#     (education_consultancy) and the DB has fewer than 25 tenants (i.e. it is the tiny local seed, not a real env);
#   * every row it creates carries leads.custom_fields.pulse_seed = '1'; a re-run deletes exactly those leads
#     (plus their audit rows) and nothing else.
#
# What it generates (everything relative to now(), deterministic via setseed):
#   staff     8 people: 2 TeleCaller, 2 Executive, 2 Counsellor, 2 App Executive over 3 branches
#   leads     ~415 (300 organic over 35 days + 60 capacity-burst + 55 bulk-move leads), a handful soft-deleted
#   audit     lead.updated / lead.graduated stage moves in the exact shapes the app writes (list, list_ids, holder,
#             assigned_to, status), plus: ~half of the older rows WITHOUT list_ids/holder (pre-EDGEX-82 shape),
#             check-in style rows with a SLUG in list.old, 3 rows with an unmatched list name, one tagged bulk batch
#             (via = bulk) and one historical bulk burst (25 moves in 40s, no tag)
#   activity  calls, notes (some edited, some AI-written, some on soft-deleted leads), applications
#   patterns  Asha  — activity collapses 5 days ago         -> "Activity drop" (red)
#             Binod — receives ~3x his usual this week       -> "Over capacity" (amber)
#             Qualified -> back/archive spikes this week     -> "Stage leak"
#             Gita  — most Applications this week            -> "Top mover"
#             12 intake leads older than 48h, never touched  -> "Untouched" in Needs you
set -euo pipefail

API_URL="http://127.0.0.1:54321"
LOCAL_DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
PASSWORD="edgexdev123"
TENANT_ID="22222222-2222-2222-2222-222222222222"

echo "→ Guard: confirming this is the local stack and the admizz-local tenant..."
# The URL above is hard-coded to 127.0.0.1:54322 (the server itself only sees its container-internal port, so the
# port can't be asserted server-side). Server-side we assert the tenant identity AND that this is a tiny dev DB:
# a real environment has far more tenants than the 3-seed local stack.
GUARD="$(psql "$LOCAL_DB" -Atc "select coalesce((select slug || '/' || industry_id from tenants where id = '$TENANT_ID'), 'missing') || '|' || (select count(*) < 25 from tenants)" 2>/dev/null || true)"
if [ "$GUARD" != "admizz-local/education_consultancy|true" ]; then
  echo "  REFUSING: expected 'admizz-local/education_consultancy|true', got '${GUARD:-<no connection>}'." >&2
  echo "  (Run ./scripts/seed-education-local.sh first, and make sure the local Supabase stack is up.)" >&2
  exit 1
fi
if ! curl -sf "$API_URL/rest/v1/" -H "apikey: $SERVICE_ROLE_KEY" >/dev/null 2>&1; then
  echo "  Local API not reachable at $API_URL." >&2
  exit 1
fi

ensure_user() { # <email> <full name> -> echoes uid
  local email="$1" name="$2" resp uid
  resp="$(curl -s -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$PASSWORD\",\"email_confirm\":true,\"user_metadata\":{\"full_name\":\"$name\"}}")"
  uid="$(echo "$resp" | sed -nE 's/.*"id":"([0-9a-f-]{36})".*/\1/p' | head -1)"
  [ -z "$uid" ] && uid="$(psql "$LOCAL_DB" -Atc "select id from auth.users where email='$email' limit 1")"
  [ -z "$uid" ] && { echo "  could not create/find $email: $resp" >&2; exit 1; }
  psql "$LOCAL_DB" -qAtc "update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data,'{}'::jsonb) || jsonb_build_object('full_name','$name') where id='$uid'" >/dev/null
  echo "$uid"
}

echo "→ Creating staff logins (password $PASSWORD)..."
TC1="$(ensure_user pulse.asha@admizz.local   'Asha Tamang')"
TC2="$(ensure_user pulse.binod@admizz.local  'Binod Rai')"
EX1="$(ensure_user pulse.chirag@admizz.local 'Chirag Shah')"
EX2="$(ensure_user pulse.dipa@admizz.local   'Dipa Gurung')"
CO1="$(ensure_user pulse.esha@admizz.local   'Esha Thapa')"
CO2="$(ensure_user pulse.farhan@admizz.local 'Farhan Ali')"
AP1="$(ensure_user pulse.gita@admizz.local   'Gita Karki')"
AP2="$(ensure_user pulse.hari@admizz.local   'Hari Basnet')"

echo "→ Seeding positions, branches, staff and 5 weeks of activity..."
psql "$LOCAL_DB" -v ON_ERROR_STOP=1 -q \
  -v tc1="$TC1" -v tc2="$TC2" -v ex1="$EX1" -v ex2="$EX2" -v co1="$CO1" -v co2="$CO2" -v ap1="$AP1" -v ap2="$AP2" <<'SQL'
\set tenant '22222222-2222-2222-2222-222222222222'
BEGIN;
SELECT setseed(0.37);

-- ── setup: positions, branches, staff, lists, application stage ───────────────
INSERT INTO positions (id, tenant_id, name, slug, base_tier, permissions, is_system) VALUES
  ('22222222-2222-2222-2222-000000000051', :'tenant', 'TeleCaller',     'telecaller',    'member', '{"leadScope":"own","nav":{"mode":"all","keys":[]},"pipelines":{"mode":"all","ids":[]},"dashboard":{"widgets":{"mode":"all","keys":[]}}}'::jsonb, false),
  ('22222222-2222-2222-2222-000000000052', :'tenant', 'Executive',      'executive',     'member', '{"leadScope":"own","nav":{"mode":"all","keys":[]},"pipelines":{"mode":"all","ids":[]},"dashboard":{"widgets":{"mode":"all","keys":[]}}}'::jsonb, false),
  ('22222222-2222-2222-2222-000000000053', :'tenant', 'Counsellor',     'counsellor',    'member', '{"leadScope":"own","nav":{"mode":"all","keys":[]},"pipelines":{"mode":"all","ids":[]},"dashboard":{"widgets":{"mode":"all","keys":[]}}}'::jsonb, false),
  ('22222222-2222-2222-2222-000000000054', :'tenant', 'App Executive',  'app-executive', 'member', '{"leadScope":"own","nav":{"mode":"all","keys":[]},"pipelines":{"mode":"all","ids":[]},"dashboard":{"widgets":{"mode":"all","keys":[]}}}'::jsonb, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO branches (id, tenant_id, name, slug, sort_order) VALUES
  ('22222222-2222-2222-2222-000000000061', :'tenant', 'Kathmandu', 'kathmandu', 1),
  ('22222222-2222-2222-2222-000000000062', :'tenant', 'Pokhara',   'pokhara',   2),
  ('22222222-2222-2222-2222-000000000063', :'tenant', 'Lalitpur',  'lalitpur',  3)
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE staff (key text, uid uuid, pos text, branch uuid, email text, pos_id uuid) ON COMMIT DROP;
INSERT INTO staff VALUES
  ('tc1', :'tc1', 'telecaller',    '22222222-2222-2222-2222-000000000061', 'pulse.asha@admizz.local',   '22222222-2222-2222-2222-000000000051'),
  ('tc2', :'tc2', 'telecaller',    '22222222-2222-2222-2222-000000000062', 'pulse.binod@admizz.local',  '22222222-2222-2222-2222-000000000051'),
  ('ex1', :'ex1', 'executive',     '22222222-2222-2222-2222-000000000061', 'pulse.chirag@admizz.local', '22222222-2222-2222-2222-000000000052'),
  ('ex2', :'ex2', 'executive',     '22222222-2222-2222-2222-000000000062', 'pulse.dipa@admizz.local',   '22222222-2222-2222-2222-000000000052'),
  ('co1', :'co1', 'counsellor',    '22222222-2222-2222-2222-000000000061', 'pulse.esha@admizz.local',   '22222222-2222-2222-2222-000000000053'),
  ('co2', :'co2', 'counsellor',    '22222222-2222-2222-2222-000000000063', 'pulse.farhan@admizz.local', '22222222-2222-2222-2222-000000000053'),
  ('ap1', :'ap1', 'app-executive', '22222222-2222-2222-2222-000000000061', 'pulse.gita@admizz.local',   '22222222-2222-2222-2222-000000000054'),
  ('ap2', :'ap2', 'app-executive', '22222222-2222-2222-2222-000000000063', 'pulse.hari@admizz.local',   '22222222-2222-2222-2222-000000000054');

INSERT INTO tenant_users (tenant_id, user_id, role, position_id, branch_id)
SELECT :'tenant', uid, 'staff', pos_id, branch FROM staff
ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'staff', position_id = EXCLUDED.position_id, branch_id = EXCLUDED.branch_id;

-- Pre-qualified is the intake list on Admizz (education_intake_alarm reads is_intake); the base seed leaves it false.
UPDATE lead_lists SET is_intake = true WHERE id = '22222222-2222-2222-2222-000000000030';
INSERT INTO lead_lists (id, tenant_id, name, slug, sort_order, is_system, is_archive, is_intake, access)
VALUES ('22222222-2222-2222-2222-000000000035', :'tenant', 'Archived', 'archived', 99, true, true, false, '{"mode":"all"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO application_stages (id, tenant_id, name, slug, position)
VALUES ('22222222-2222-2222-2222-000000000071', :'tenant', 'Applied', 'applied', 0)
ON CONFLICT (id) DO NOTHING;

-- ── idempotency: remove exactly what a previous run created ───────────────────
DELETE FROM audit_logs WHERE tenant_id = :'tenant' AND entity_type = 'lead'
  AND entity_id IN (SELECT id FROM leads WHERE tenant_id = :'tenant' AND custom_fields ? 'pulse_seed');
DELETE FROM leads WHERE tenant_id = :'tenant' AND custom_fields ? 'pulse_seed';   -- notes/activities/applications cascade

-- ── helpers (session-local) ───────────────────────────────────────────────────
CREATE FUNCTION pg_temp.listname(p uuid) RETURNS text LANGUAGE sql AS $$ SELECT name FROM lead_lists WHERE id = p $$;

-- One stage move, written the way the app writes it. p_ids/p_holder = false simulate pre-EDGEX-82 audit rows.
CREATE FUNCTION pg_temp.seed_move(
  p_lead uuid, p_actor uuid, p_at timestamptz, p_to uuid, p_assign uuid,
  p_ids boolean, p_holder boolean, p_via text, p_action text, p_old_label text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_from uuid; v_prev uuid; v_ch jsonb; v_hold uuid;
BEGIN
  SELECT list_id, assigned_to INTO v_from, v_prev FROM leads WHERE id = p_lead;
  v_hold := COALESCE(p_assign, v_prev);
  v_ch := jsonb_build_object('list', jsonb_build_object('old', COALESCE(p_old_label, pg_temp.listname(v_from)), 'new', pg_temp.listname(p_to)));
  IF p_ids THEN v_ch := v_ch || jsonb_build_object('list_ids', jsonb_build_object('old', v_from, 'new', p_to)); END IF;
  IF p_assign IS NOT NULL AND p_assign IS DISTINCT FROM v_prev THEN
    v_ch := v_ch || jsonb_build_object('assigned_to', jsonb_build_object('old', v_prev, 'new', p_assign));
  END IF;
  IF p_holder THEN v_ch := v_ch || jsonb_build_object('holder', jsonb_build_object('old', null, 'new', v_hold)); END IF;
  IF p_via IS NOT NULL THEN v_ch := v_ch || jsonb_build_object('via', jsonb_build_object('old', null, 'new', p_via)); END IF;
  INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, changes, created_at)
  VALUES ('22222222-2222-2222-2222-222222222222', p_actor, p_action, 'lead', p_lead, v_ch, p_at);
  UPDATE leads SET list_id = p_to, assigned_to = COALESCE(p_assign, assigned_to), stage_changed_at = p_at WHERE id = p_lead;
END $$;

CREATE FUNCTION pg_temp.seed_status(p_lead uuid, p_actor uuid, p_at timestamptz, p_new text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_old text;
BEGIN
  SELECT status INTO v_old FROM leads WHERE id = p_lead;
  IF v_old IS DISTINCT FROM p_new THEN
    INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, changes, created_at)
    VALUES ('22222222-2222-2222-2222-222222222222', p_actor, 'lead.updated', 'lead', p_lead,
            jsonb_build_object('status', jsonb_build_object('old', v_old, 'new', p_new)), p_at);
    UPDATE leads SET status = p_new WHERE id = p_lead;
  END IF;
END $$;

CREATE FUNCTION pg_temp.seed_lead(p_n int, p_created timestamptz, p_owner uuid, p_branch uuid, p_tags jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO leads (id, tenant_id, first_name, last_name, email, pipeline_id, stage_id, list_id, intake_source, intake_medium,
                     is_final, status, country, custom_fields, display_id, assigned_to, branch_id, created_at, updated_at)
  VALUES (v_id, '22222222-2222-2222-2222-222222222222', 'Pulse', 'Lead ' || p_n, 'pulse.lead.' || p_n || '@pulse.invalid',
          '22222222-2222-2222-2222-000000000010', '22222222-2222-2222-2222-000000000020', '22222222-2222-2222-2222-000000000030',
          'website', 'organic', true, 'new', 'Nepal', jsonb_build_object('pulse_seed', '1') || p_tags, 'PS-' || p_n,
          p_owner, p_branch, p_created, p_created);
  RETURN v_id;
END $$;

-- ── the journey generator ─────────────────────────────────────────────────────
DO $seed$
DECLARE
  v_now   timestamptz := now();
  t       uuid := '22222222-2222-2222-2222-222222222222';
  L_PRE   uuid := '22222222-2222-2222-2222-000000000030';
  L_QUAL  uuid := '22222222-2222-2222-2222-000000000031';
  L_PROS  uuid := '22222222-2222-2222-2222-000000000032';
  L_APPS  uuid := '22222222-2222-2222-2222-000000000033';
  L_ARCH  uuid := '22222222-2222-2222-2222-000000000035';
  tc1 uuid; tc2 uuid; ex1 uuid; ex2 uuid; co1 uuid; co2 uuid; ap1 uuid; ap2 uuid;
  br_kt uuid := '22222222-2222-2222-2222-000000000061';
  br_pk uuid := '22222222-2222-2222-2222-000000000062';
  br_lt uuid := '22222222-2222-2222-2222-000000000063';
  n int := 0; i int; d int; k int; cnt int;
  lead uuid; created timestamptz; tc uuid; ex uuid; co uuid; ap uuid; br uuid;
  at_ timestamptz; recent boolean; ids boolean; hold boolean; r double precision;
  s record; ts timestamptz; pick uuid; nid uuid; base int;
BEGIN
  SELECT uid INTO tc1 FROM staff WHERE key='tc1'; SELECT uid INTO tc2 FROM staff WHERE key='tc2';
  SELECT uid INTO ex1 FROM staff WHERE key='ex1'; SELECT uid INTO ex2 FROM staff WHERE key='ex2';
  SELECT uid INTO co1 FROM staff WHERE key='co1'; SELECT uid INTO co2 FROM staff WHERE key='co2';
  SELECT uid INTO ap1 FROM staff WHERE key='ap1'; SELECT uid INTO ap2 FROM staff WHERE key='ap2';

  -- 1) 300 organic leads over 35 days, balanced between the two TeleCallers
  FOR i IN 1..300 LOOP
    n := n + 1;
    created := v_now - (random() * 35) * interval '1 day';
    IF i % 2 = 0 THEN tc := tc1; br := br_kt; ELSE tc := tc2; br := br_pk; END IF;
    lead := pg_temp.seed_lead(n, created, tc, br, '{}'::jsonb);
    recent := created > v_now - interval '14 days';
    ids := recent OR random() < 0.4;
    hold := recent OR random() < 0.5;
    at_ := created + (0.2 + random() * 2.5) * interval '1 day';

    -- Asha is "gone" for the last 5 days: she makes no moves then
    IF at_ < v_now AND random() < 0.78 AND NOT (tc = tc1 AND at_ > v_now - interval '5 days') THEN
      ex := CASE WHEN br = br_kt THEN ex1 ELSE ex2 END;
      IF random() < 0.06 THEN        -- check-in style row: slug in list.old, no list_ids
        PERFORM pg_temp.seed_move(lead, tc, at_, L_QUAL, ex, false, true, NULL, 'lead.updated', 'pre-qualified');
      ELSIF random() < 0.02 THEN     -- the old stage was deleted since: name matches nothing
        PERFORM pg_temp.seed_move(lead, tc, at_, L_QUAL, ex, false, hold, NULL, 'lead.updated', 'Old Deleted Stage');
      ELSE
        PERFORM pg_temp.seed_move(lead, tc, at_, L_QUAL, ex, ids, hold, NULL, 'lead.updated');
      END IF;
      -- every position records status changes as the lead moves through the relay (new -> contacted -> qualified -> ...)
      PERFORM pg_temp.seed_status(lead, tc, at_ + interval '1 hour', 'contacted');
      PERFORM pg_temp.seed_status(lead, ex, at_ + interval '3 hours', 'qualified');

      -- stage leak: Qualified -> back / archived, much more often this week
      IF random() < (CASE WHEN at_ > v_now - interval '7 days' THEN 0.42 ELSE 0.07 END) AND at_ + interval '1 day' < v_now THEN
        at_ := at_ + (0.5 + random() * 1.5) * interval '1 day';
        IF at_ < v_now THEN
          PERFORM pg_temp.seed_move(lead, ex, at_, CASE WHEN random() < 0.6 THEN L_ARCH ELSE L_PRE END, NULL, ids, hold, NULL, 'lead.updated');
        END IF;
      ELSE
        at_ := at_ + (1 + random() * 4) * interval '1 day';
        IF at_ < v_now AND random() < (CASE WHEN at_ > v_now - interval '7 days' THEN 0.8 ELSE 0.55 END) THEN
          co := CASE WHEN br = br_kt THEN co1 WHEN br = br_lt THEN co2 ELSE (CASE WHEN random() < 0.5 THEN co1 ELSE co2 END) END;
          PERFORM pg_temp.seed_move(lead, ex, at_, L_PROS, co, ids, hold, NULL, 'lead.updated');
          PERFORM pg_temp.seed_status(lead, co, at_ + interval '2 hours', 'interested');
          at_ := at_ + (1 + random() * 4) * interval '1 day';
          IF at_ < v_now AND random() < (CASE WHEN at_ > v_now - interval '7 days' THEN 0.85 ELSE 0.5 END) THEN
            ap := CASE WHEN at_ > v_now - interval '7 days' AND random() < 0.8 THEN ap1
                       WHEN br = br_lt THEN ap2 WHEN br = br_kt THEN ap1 ELSE (CASE WHEN random() < 0.5 THEN ap1 ELSE ap2 END) END;
            PERFORM pg_temp.seed_move(lead, co, at_, L_APPS, ap, ids, hold, NULL, CASE WHEN random() < 0.3 THEN 'lead.graduated' ELSE 'lead.updated' END);
            PERFORM pg_temp.seed_status(lead, ap, at_ + interval '3 hours', 'enrolled');
            INSERT INTO applications (tenant_id, lead_id, assigned_to, university_name, program_name, stage_id, status, created_at, updated_at)
            VALUES (t, lead, ap, 'University of Seedland', 'BSc Pulse', '22222222-2222-2222-2222-000000000071', 'active', at_ + interval '2 hours', at_ + interval '2 hours');
            IF random() < 0.5 THEN   -- ~1.5 applications per student
              INSERT INTO applications (tenant_id, lead_id, assigned_to, university_name, program_name, stage_id, status, created_at, updated_at)
              VALUES (t, lead, ap, 'College of Seedshire', 'MSc Pulse', '22222222-2222-2222-2222-000000000071', 'active', at_ + interval '5 hours', at_ + interval '5 hours');
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- 2) Capacity burst: 60 extra leads land on Binod this week
  FOR i IN 1..60 LOOP
    n := n + 1;
    PERFORM pg_temp.seed_lead(n, v_now - (random() * 6) * interval '1 day', tc2, br_pk, '{}'::jsonb);
  END LOOP;

  -- 3) 12 intake leads older than 48h that nobody has touched (Needs you -> Untouched)
  FOR i IN 1..12 LOOP
    n := n + 1;
    PERFORM pg_temp.seed_lead(n, v_now - (3 + random() * 3) * interval '1 day', tc2, br_pk, '{"pulse_untouched":"1"}'::jsonb);
  END LOOP;

  -- 4) Bulk: 30 leads moved by Dipa in one tagged batch (10 days ago) + 25 moved by Asha in a 40s untagged burst (18 days ago)
  FOR i IN 1..55 LOOP
    n := n + 1;
    nid := pg_temp.seed_lead(n, v_now - (24 + random() * 6) * interval '1 day', tc1, br_kt, '{}'::jsonb);
    IF i <= 30 THEN
      PERFORM pg_temp.seed_move(nid, ex2, v_now - interval '10 days' + (i % 5) * interval '1 second', L_QUAL, NULL, true, true, 'bulk', 'lead.updated');
    ELSE
      PERFORM pg_temp.seed_move(nid, tc1, v_now - interval '18 days' + (i - 30) * interval '1.5 seconds', L_QUAL, NULL, false, false, NULL, 'lead.updated');
    END IF;
  END LOOP;

  -- 5) Three soft-deleted leads, each with a note (must be excluded everywhere)
  FOR i IN 1..3 LOOP
    n := n + 1;
    nid := pg_temp.seed_lead(n, v_now - interval '9 days', tc1, br_kt, '{}'::jsonb);
    INSERT INTO lead_notes (lead_id, user_id, user_email, content, created_at) VALUES (nid, tc1, 'pulse.asha@admizz.local', 'note on a deleted lead', v_now - interval '2 days');
    UPDATE leads SET deleted_at = v_now - interval '1 day' WHERE id = nid;
  END LOOP;

  -- 6) Calls and notes: 35 days, weekdays only; base volume per position; Asha stops 5 days ago
  FOR d IN 0..34 LOOP
    FOR s IN SELECT * FROM staff LOOP
      CONTINUE WHEN extract(dow FROM v_now - d * interval '1 day') IN (6);        -- Saturday off
      CONTINUE WHEN s.key = 'tc1' AND d < 5;                                      -- Asha's collapse
      base := CASE s.pos WHEN 'telecaller' THEN 14 WHEN 'executive' THEN 9 WHEN 'counsellor' THEN 8 ELSE 6 END;
      cnt := round(base * (0.6 + random() * 0.8));
      FOR k IN 1..cnt LOOP
        ts := v_now - d * interval '1 day' - random() * interval '10 hours';
        SELECT id INTO pick FROM leads
         WHERE tenant_id = t AND custom_fields ? 'pulse_seed' AND NOT custom_fields ? 'pulse_untouched'
           AND deleted_at IS NULL AND created_at < ts ORDER BY random() LIMIT 1;
        CONTINUE WHEN pick IS NULL;
        INSERT INTO lead_activities (lead_id, tenant_id, user_id, activity_type, subject, created_at, updated_at)
        VALUES (pick, t, s.uid, 'call', 'Seed call', ts, ts);
      END LOOP;
      cnt := round(base * 0.7 * (0.6 + random() * 0.8));
      FOR k IN 1..cnt LOOP
        ts := v_now - d * interval '1 day' - random() * interval '10 hours';
        SELECT id INTO pick FROM leads
         WHERE tenant_id = t AND custom_fields ? 'pulse_seed' AND NOT custom_fields ? 'pulse_untouched'
           AND deleted_at IS NULL AND created_at < ts ORDER BY random() LIMIT 1;
        CONTINUE WHEN pick IS NULL;
        r := random();
        INSERT INTO lead_notes (lead_id, user_id, user_email, content, created_at, edited_at, ai_tool_call_id)
        VALUES (pick, s.uid, s.email, 'Seed note', ts,
                CASE WHEN r < 0.10 AND ts + interval '3 hours' < v_now THEN ts + interval '3 hours' END,
                CASE WHEN r > 0.95 THEN 'seed-tool-call-' || d || '-' || k END);
      END LOOP;
    END LOOP;
  END LOOP;

  -- Archive moves carry the reason the app records (changes.archive_reason), so "why leads left" is real data.
  UPDATE audit_logs SET changes = changes || jsonb_build_object('archive_reason', jsonb_build_object('old', null,
    'new', (ARRAY['Not reachable','Not reachable','Not reachable','Not interested','Chose another consultancy','Duplicate lead'])[1 + (abs(hashtext(id::text)) % 6)]))
  WHERE tenant_id = t AND entity_type = 'lead' AND changes #>> '{list,new}' = 'Archived'
    AND entity_id IN (SELECT id FROM leads WHERE tenant_id = t AND custom_fields ? 'pulse_seed');
END
$seed$;

COMMIT;

SELECT 'leads'  AS what, count(*) FROM leads WHERE tenant_id = :'tenant' AND custom_fields ? 'pulse_seed'
UNION ALL SELECT 'audit rows', count(*) FROM audit_logs WHERE tenant_id = :'tenant' AND entity_id IN (SELECT id FROM leads WHERE custom_fields ? 'pulse_seed')
UNION ALL SELECT 'calls',  count(*) FROM lead_activities WHERE tenant_id = :'tenant' AND subject = 'Seed call'
UNION ALL SELECT 'notes',  count(*) FROM lead_notes WHERE content IN ('Seed note','note on a deleted lead')
UNION ALL SELECT 'applications', count(*) FROM applications WHERE tenant_id = :'tenant' AND university_name IN ('University of Seedland','College of Seedshire');
SQL

echo "✓ Done. Open http://localhost:3001/pulse as admin@admizz.local / $PASSWORD"
