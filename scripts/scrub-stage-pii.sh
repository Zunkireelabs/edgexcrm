#!/usr/bin/env bash
# scrub-stage-pii.sh — anonymize customer PII (names, phones, emails) on stage.
#
# Usage:
#   scripts/scrub-stage-pii.sh local  [--dry-run]     # your OrbStack DB (default URL)
#   STAGE_DB_URL='postgresql://...' scripts/scrub-stage-pii.sh stage [--dry-run]
#
# There is NO "prod" case. This script must never run against production — stage
# is a real-people PII clone that's being scrubbed precisely because the AI
# assistant now reads and writes against it (docs/ai-native-efforts/working/
# BRIEF-SCRUB-STAGE-PII.md). Prod is the live system; scrubbing it would destroy
# real customer data. As belt-and-braces on top of only accepting local/stage,
# the resolved DB URL is also checked against known prod markers below and the
# script aborts if it matches, no matter how that URL got there.
#
# WHAT THIS TOUCHES (customer PII only — see brief for the full table):
#   leads(first_name,last_name,email,phone,normalized_email,normalized_phone,company_email)
#   lead_submissions(first_name,last_name,email,phone,normalized_email,normalized_phone)
#   contacts(first_name,last_name,email,phone)
#   conversations(contact_phone)
#   emails(from_email,to_emails,cc_emails,bcc_emails)
#   _mig158_phone_backup(old_phone)  — anonymized in place, not dropped (see below)
#
# WHAT THIS DELIBERATELY DOES NOT TOUCH:
#   - auth.users emails — CLAUDE.md documents logging into stage as prod emails
#     with edgexdev123; scrubbing these locks everyone out of stage.
#   - staff/user emails: tenant_users, lead_notes.user_email,
#     application_notes.user_email, employee_profiles, invite_tokens,
#     connected_email_accounts, tenant_email_settings — Zunkiree/client staff,
#     not end customers, and several are load-bearing for login/email routing.
#   - id, display_id, tenant_id, dates, list_id/stage_id/pipeline_id,
#     assigned_to, status, tags, custom_fields — row identity and pipeline shape
#     must survive so stage keeps its testing value.
#   - lead_activities.email_subject / email_body (~2,936 rows on stage) — free
#     text that can carry customer PII and is exactly what the AI ingests/cites.
#     Sadin scoped this round to names/phones/emails; this is KNOWN REMAINING
#     EXPOSURE, not an oversight. Do not assume "scrubbed" means total.
#
# _mig158_phone_backup DECISION: anonymized in place (old_phone replaced with a
# deterministic fake), not dropped. It's a leftover rollback snapshot from
# migration 158 — dropping it destroys that migration's rollback path, and
# anonymizing costs nothing extra since it's already wired into this script.
# If you'd rather just drop the table, say so; this was a judgment call, not a
# unilateral scope decision.
#
# DETERMINISM / IDEMPOTENCY: every fake value is a pure function of the row's
# own id (md5-hash based), never of the row's current data. Re-running always
# recomputes the exact same fake output for the same id, so a second run over
# already-scrubbed data is a no-op in effect (same values written again) — safe
# for stage's periodic re-clone-from-prod cycle. NULL stays NULL throughout:
# a column that was NULL before a run is never given a generated value, so the
# null distribution (e.g. "3,153 of 16,684 leads have an email") survives.
#
# NORMALIZATION CONSISTENCY: leads.normalized_email is a Postgres GENERATED
# ALWAYS column (lower(btrim(email))) — updating leads.email regenerates it
# automatically; this script never (and cannot) write to it directly.
# leads.normalized_phone and lead_submissions.normalized_email/normalized_phone
# are plain columns the app never derives at write time from a shared helper,
# so this script recomputes them here using the exact same normalization the
# app uses (src/lib/leads/dedup.ts normalizeEmail/normalizePhone) translated to
# SQL — see _scrub_normalize_email / _scrub_normalize_phone below. Getting this
# wrong silently breaks dedup testing, which is the whole reason it's called
# out.
#
# SCHEMA FOOTPRINT: this is a data script, not a migration. All helper
# functions (_scrub_*) are created and dropped inside the same transaction —
# nothing permanent is left behind in the schema.
#
# NAME REALISM: uses a Romanized-Nepali given-name/surname pool, applied to
# every row this script touches (not just Admizz's). Admizz's ~16,684 leads
# are the overwhelming majority of stage's customer-PII rows and are Nepali;
# the handful of leads belonging to it_agency/real_estate/travel_agency stage
# tenants get Nepali-style names too as a result. That's a judgment call for
# simplicity, not a hidden scope decision — flag if per-tenant name pools are
# wanted instead.
set -euo pipefail

ENV="${1:-}"
DRY_RUN=false
for arg in "${@:2}"; do
  [ "$arg" = "--dry-run" ] && DRY_RUN=true
done

case "$ENV" in
  local) DB="${LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}" ;;
  stage) DB="${STAGE_DB_URL:-}"; [ -z "$DB" ] && { echo "Set STAGE_DB_URL (see CLAUDE.md § Credentials)."; exit 1; } ;;
  *) echo "Usage: $0 <local|stage> [--dry-run]   (this script must NEVER target prod)"; exit 1 ;;
esac

# Belt-and-braces prod guard: refuse if the resolved URL matches a known
# production marker, regardless of how it got there (e.g. STAGE_DB_URL
# mistakenly exported as a copy of PROD_DB_URL).
PROD_MARKERS=("pirhnklvtjjpuvbvibxf" "lead-crm.zunkireelabs.com")
for marker in "${PROD_MARKERS[@]}"; do
  if [[ "$DB" == *"$marker"* ]]; then
    echo "ABORT: resolved DB URL matches a known PRODUCTION marker ('$marker')." >&2
    echo "This script must never run against production. Refusing to proceed." >&2
    exit 1
  fi
done

if ! psql "$DB" -tAc "SELECT 1;" >/dev/null 2>&1; then
  echo "ERROR: cannot reach the $ENV database ($DB)." >&2
  exit 1
fi

echo "== $ENV : scrub-stage-pii =="
echo "-- scope (current state) --"
psql "$DB" -tAc "
select 'leads.total'                     || E'\t' || count(*) from leads
union all select 'leads.email_notnull'        || E'\t' || count(*) from leads where email is not null
union all select 'leads.phone_notnull'        || E'\t' || count(*) from leads where phone is not null
union all select 'leads.company_email_notnull'|| E'\t' || count(*) from leads where company_email is not null
union all select 'lead_submissions.total'                 || E'\t' || count(*) from lead_submissions
union all select 'lead_submissions.email_notnull'         || E'\t' || count(*) from lead_submissions where email is not null
union all select 'lead_submissions.phone_notnull'         || E'\t' || count(*) from lead_submissions where phone is not null
union all select 'contacts.total'             || E'\t' || count(*) from contacts
union all select 'contacts.email_notnull'     || E'\t' || count(*) from contacts where email is not null
union all select 'contacts.phone_notnull'     || E'\t' || count(*) from contacts where phone is not null
union all select 'conversations.contact_phone_notnull' || E'\t' || count(*) from conversations where contact_phone is not null
union all select 'emails.total'               || E'\t' || count(*) from emails
;" | sed 's/^/  /'

MIG158_EXISTS="$(psql "$DB" -tAc "select to_regclass('public._mig158_phone_backup') is not null;")"
if [ "$(echo "$MIG158_EXISTS" | tr -d '[:space:]')" = "t" ]; then
  psql "$DB" -tAc "select '  _mig158_phone_backup.total' || E'\t' || count(*) from _mig158_phone_backup;"
else
  echo "  _mig158_phone_backup: table not present on $ENV — that step will be skipped."
fi

if [ "$DRY_RUN" = true ]; then
  echo "-- dry run, not writing --"
  exit 0
fi

SQL_FILE="$(mktemp)"
trap 'rm -f "$SQL_FILE"' EXIT

cat > "$SQL_FILE" <<'SQL'
BEGIN;

-- ── helpers (dropped before COMMIT — no permanent schema footprint) ────────

-- Deterministic int in [0, n) from a seed string. Same seed -> same output,
-- forever (used to pick a name from a pool, a phone suffix, etc).
CREATE OR REPLACE FUNCTION _scrub_pick_int(seed text, n int) RETURNS int
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT abs((('x' || substr(md5(seed), 1, 8))::bit(32))::int) % n;
$fn$;

CREATE OR REPLACE FUNCTION _scrub_first_name(seed text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT (ARRAY[
    'Aarav','Aayush','Abin','Anish','Anmol','Ashish','Barsha','Bibek','Bikash','Bimal',
    'Bina','Bishal','Deepika','Dikshya','Diwas','Gaurav','Hari','Ishwor','Kamal','Kabita',
    'Kritika','Krishna','Manisha','Manoj','Nabin','Nirmala','Niroj','Pabitra','Prabin','Prakash',
    'Pramila','Prashant','Priya','Puja','Rabin','Rachana','Rajesh','Rakesh','Ramesh','Reeta',
    'Rejina','Rohit','Roshan','Sabina','Sagar','Samir','Samjhana','Sandeep','Sanjay','Sarita',
    'Saroj','Sabin','Shreya','Shristi','Sita','Sujan','Suman','Sumina','Sunita','Suraj'
  ])[_scrub_pick_int(seed || ':first', 60) + 1];
$fn$;

CREATE OR REPLACE FUNCTION _scrub_last_name(seed text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT (ARRAY[
    'Acharya','Adhikari','Bhandari','Bhattarai','Basnet','Baral','Chhetri','Dahal','Gautam','Ghimire',
    'Giri','Gurung','Joshi','Karki','Khadka','Khanal','Koirala','Lama','Limbu','Magar',
    'Maharjan','Malla','Neupane','Oli','Pandey','Pant','Poudel','Rai','Regmi','Sapkota',
    'Shah','Sharma','Shrestha','Silwal','Subedi','Tamang','Thapa','Thakuri','Yadav','Basyal'
  ])[_scrub_pick_int(seed || ':last', 40) + 1];
$fn$;

-- Canonical "+977-98XXXXXXXX" shape (matches src/lib/phone-utils.ts storage
-- format). Deterministic 8-digit suffix from the seed.
CREATE OR REPLACE FUNCTION _scrub_phone(seed text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT '+977-98' || lpad(
    (abs((('x' || substr(md5(seed || ':phone'), 1, 8))::bit(32))::int) % 100000000)::text,
    8, '0'
  );
$fn$;

-- Mirrors src/lib/leads/dedup.ts normalizePhone(): strip non-digits, require
-- >=7 digits, prefix with '+'. Applied to the FINAL (post-scrub) phone value.
CREATE OR REPLACE FUNCTION _scrub_normalize_phone(raw text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
    WHEN raw IS NULL THEN NULL
    WHEN length(regexp_replace(raw, '\D', '', 'g')) < 7 THEN NULL
    ELSE '+' || regexp_replace(raw, '\D', '', 'g')
  END;
$fn$;

-- Mirrors src/lib/leads/dedup.ts normalizeEmail(): trim + lowercase, empty -> null.
CREATE OR REPLACE FUNCTION _scrub_normalize_email(raw text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE WHEN raw IS NULL OR btrim(raw) = '' THEN NULL ELSE lower(btrim(raw)) END;
$fn$;

-- Deterministic fake personal email on an RFC 2606 .invalid domain (never a
-- real deliverable address). Built from the row's (already-fake) name plus a
-- hash suffix for low collision risk — duplicates are fine (no unique index
-- on leads.email/phone), this is just tidiness.
CREATE OR REPLACE FUNCTION _scrub_email(first_name text, last_name text, seed text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT lower(regexp_replace(coalesce(first_name, 'user'), '[^a-zA-Z]', '', 'g'))
    || '.' || lower(regexp_replace(coalesce(last_name, 'test'), '[^a-zA-Z]', '', 'g'))
    || '.' || substr(md5(seed || ':email'), 1, 6)
    || '@scrubbed.invalid';
$fn$;

CREATE OR REPLACE FUNCTION _scrub_company_email(seed text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT 'contact.' || substr(md5(seed || ':company_email'), 1, 8) || '@company-scrubbed.invalid';
$fn$;

-- Array-of-emails scrub (emails.to_emails/cc_emails/bcc_emails) — preserves
-- array length (incl. empty arrays), each element gets its own deterministic
-- fake address keyed by (seed, position).
CREATE OR REPLACE FUNCTION _scrub_email_array(arr text[], seed text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE WHEN arr IS NULL THEN NULL ELSE
    ARRAY(
      SELECT 'contact.' || substr(md5(seed || ':arr:' || ord), 1, 8) || '@scrubbed.invalid'
      FROM generate_subscripts(arr, 1) AS ord
    )
  END;
$fn$;

-- ── leads ───────────────────────────────────────────────────────────────
-- normalized_email is a GENERATED column (regenerates automatically from
-- email) — never set directly. normalized_phone is a plain column, always
-- recomputed here from the final phone value so it can never drift.
WITH gen AS (
  SELECT
    id, first_name, last_name, email, phone, company_email,
    _scrub_first_name(id::text)    AS new_first,
    _scrub_last_name(id::text)     AS new_last,
    _scrub_phone(id::text)         AS new_phone,
    _scrub_company_email(id::text) AS new_company_email
  FROM leads
), gen2 AS (
  SELECT *, _scrub_email(new_first, new_last, id::text) AS new_email FROM gen
)
UPDATE leads l
SET
  first_name    = CASE WHEN l.first_name    IS NOT NULL THEN g.new_first         ELSE NULL END,
  last_name     = CASE WHEN l.last_name     IS NOT NULL THEN g.new_last          ELSE NULL END,
  phone         = CASE WHEN l.phone         IS NOT NULL THEN g.new_phone         ELSE NULL END,
  email         = CASE WHEN l.email         IS NOT NULL THEN g.new_email         ELSE NULL END,
  company_email = CASE WHEN l.company_email IS NOT NULL THEN g.new_company_email ELSE NULL END,
  normalized_phone = _scrub_normalize_phone(
    CASE WHEN l.phone IS NOT NULL THEN g.new_phone ELSE NULL END
  )
FROM gen2 g
WHERE l.id = g.id;

-- ── lead_submissions ────────────────────────────────────────────────────
-- Both normalized_email and normalized_phone are plain columns here (no
-- generated column on this table) — both recomputed from the final values.
WITH gen AS (
  SELECT
    id, first_name, last_name, email, phone,
    _scrub_first_name(id::text) AS new_first,
    _scrub_last_name(id::text)  AS new_last,
    _scrub_phone(id::text)      AS new_phone
  FROM lead_submissions
), gen2 AS (
  SELECT *, _scrub_email(new_first, new_last, id::text) AS new_email FROM gen
)
UPDATE lead_submissions ls
SET
  first_name       = CASE WHEN ls.first_name IS NOT NULL THEN g.new_first ELSE NULL END,
  last_name        = CASE WHEN ls.last_name  IS NOT NULL THEN g.new_last  ELSE NULL END,
  phone            = CASE WHEN ls.phone      IS NOT NULL THEN g.new_phone ELSE NULL END,
  email            = CASE WHEN ls.email      IS NOT NULL THEN g.new_email ELSE NULL END,
  normalized_email = _scrub_normalize_email(CASE WHEN ls.email IS NOT NULL THEN g.new_email ELSE NULL END),
  normalized_phone = _scrub_normalize_phone(CASE WHEN ls.phone IS NOT NULL THEN g.new_phone ELSE NULL END)
FROM gen2 g
WHERE ls.id = g.id;

-- ── contacts ────────────────────────────────────────────────────────────
-- first_name/last_name are NOT NULL here, so always regenerated; email/phone
-- preserve their null-ness like everywhere else.
WITH gen AS (
  SELECT
    id, email, phone,
    _scrub_first_name(id::text) AS new_first,
    _scrub_last_name(id::text)  AS new_last,
    _scrub_phone(id::text)      AS new_phone
  FROM contacts
), gen2 AS (
  SELECT *, _scrub_email(new_first, new_last, id::text) AS new_email FROM gen
)
UPDATE contacts c
SET
  first_name = g.new_first,
  last_name  = g.new_last,
  phone      = CASE WHEN c.phone IS NOT NULL THEN g.new_phone ELSE NULL END,
  email      = CASE WHEN c.email IS NOT NULL THEN g.new_email ELSE NULL END
FROM gen2 g
WHERE c.id = g.id;

-- ── conversations ───────────────────────────────────────────────────────
UPDATE conversations
SET contact_phone = CASE WHEN contact_phone IS NOT NULL THEN _scrub_phone(id::text) ELSE NULL END;

-- ── emails ──────────────────────────────────────────────────────────────
-- from_email is NOT NULL; to/cc/bcc are NOT NULL arrays (default '{}') so
-- array-length/emptiness is preserved by _scrub_email_array.
UPDATE emails
SET
  from_email = 'contact.' || substr(md5(id::text || ':from'), 1, 8) || '@scrubbed.invalid',
  to_emails  = _scrub_email_array(to_emails,  id::text || ':to'),
  cc_emails  = _scrub_email_array(cc_emails,  id::text || ':cc'),
  bcc_emails = _scrub_email_array(bcc_emails, id::text || ':bcc');

-- ── _mig158_phone_backup (anonymize in place; see header for why not dropped) ──
-- Guarded: this leftover table may not exist on every clone/environment.
-- Statement is only reached (and only then parsed against the real catalog)
-- when the IF is true, so a missing table here is a no-op, not an error.
DO $mig158$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = '_mig158_phone_backup'
  ) THEN
    UPDATE _mig158_phone_backup
    SET old_phone = CASE WHEN old_phone IS NOT NULL THEN _scrub_phone(lead_id::text || ':mig158') ELSE NULL END;
  END IF;
END
$mig158$;

-- ── cleanup: drop helpers, leave no schema footprint ───────────────────
DROP FUNCTION _scrub_email_array(text[], text);
DROP FUNCTION _scrub_company_email(text);
DROP FUNCTION _scrub_email(text, text, text);
DROP FUNCTION _scrub_normalize_email(text);
DROP FUNCTION _scrub_normalize_phone(text);
DROP FUNCTION _scrub_phone(text);
DROP FUNCTION _scrub_last_name(text);
DROP FUNCTION _scrub_first_name(text);
DROP FUNCTION _scrub_pick_int(text, int);

COMMIT;
SQL

echo "-- applying --"
if ! psql "$DB" -v ON_ERROR_STOP=1 -f "$SQL_FILE"; then
  echo "FAILED — nothing after this point was applied (single transaction)."
  exit 1
fi

echo "-- scope (after) --"
psql "$DB" -tAc "
select 'leads.total'              || E'\t' || count(*) from leads
union all select 'leads.email_notnull' || E'\t' || count(*) from leads where email is not null
union all select 'leads.phone_notnull' || E'\t' || count(*) from leads where phone is not null
union all select 'lead_submissions.total' || E'\t' || count(*) from lead_submissions
union all select 'contacts.total'         || E'\t' || count(*) from contacts
union all select 'emails.total'           || E'\t' || count(*) from emails
;" | sed 's/^/  /'

echo "== done =="
