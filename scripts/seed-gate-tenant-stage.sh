#!/usr/bin/env bash
# seed-gate-tenant-stage.sh — provision the synthetic "orca-gate" tenant on
# stage: tenant -> owner membership -> default pipeline -> education default
# stages -> lead lists (incl. the intake list with pipeline_id set).
#
# WHY: the agent-value gate needs a tenant that is synthetic BY CONSTRUCTION
# (see docs/ai-native-efforts/working/BRIEF-SYNTHETIC-GATE-TENANT.md) — no
# form_configs row, no integration key, no second member, no positions, no
# leads — so nothing real can ever reach it and there is nothing to scrub.
# This script only ever creates that one fixed tenant; it is not a generic
# tenant-provisioning tool.
#
# Usage:
#   STAGE_DB_URL='postgresql://...' scripts/seed-gate-tenant-stage.sh stage <owner-email> [--dry-run]
#
# There is NO "local" or "prod" case — this tenant only ever exists on stage.
# <owner-email> must already exist as an auth.users row (created by hand in
# the Supabase dashboard — Part B step 1 of the brief) and must not already
# belong to any tenant: getCurrentUserTenant() / authenticateRequest()
# (src/lib/supabase/queries.ts) assume one tenant per login via .single(), so
# reusing an existing login here would corrupt whatever tenant it already
# belongs to. This must be a dedicated login.
set -euo pipefail

ENV="${1:-}"
OWNER_EMAIL="${2:-}"
DRY_RUN=false
for arg in "${@:3}"; do
  [ "$arg" = "--dry-run" ] && DRY_RUN=true
done

case "$ENV" in
  stage) DB="${STAGE_DB_URL:-}"; [ -z "$DB" ] && { echo "Set STAGE_DB_URL (see CLAUDE.md § Credentials)."; exit 1; } ;;
  *) echo "Usage: STAGE_DB_URL=... $0 stage <owner-email> [--dry-run]   (this script only ever targets stage)"; exit 1 ;;
esac

[ -z "$OWNER_EMAIL" ] && { echo "Missing <owner-email>."; exit 1; }

# Belt-and-braces prod guard, copied verbatim from scrub-stage-pii.sh: refuse
# if the resolved URL matches a known production marker, regardless of how it
# got there (e.g. STAGE_DB_URL mistakenly exported as a copy of PROD_DB_URL).
PROD_MARKERS=("pirhnklvtjjpuvbvibxf" "lead-crm.zunkireelabs.com")
for marker in "${PROD_MARKERS[@]}"; do
  if [[ "$DB" == *"$marker"* ]]; then
    echo "ABORT: resolved DB URL matches a known PRODUCTION marker ('$marker')." >&2
    echo "This script must never run against production. Refusing to proceed." >&2
    exit 1
  fi
done

if ! psql "$DB" -tAc "SELECT 1;" >/dev/null 2>&1; then
  echo "ERROR: cannot reach the $ENV database." >&2
  exit 1
fi

# Fixed identity — this tenant's shape never varies between runs.
TENANT_NAME="Orca Gate (Synthetic)"
TENANT_SLUG="orca-gate"
INDUSTRY_ID="education_consultancy"

# Deterministic ids (namespaced 0ac0... for "orca gate") so re-running after a
# --dry-run rollback, or a failed apply, reproduces identical row identities
# instead of drifting.
TENANT_ID="0ac00000-0000-4000-8000-000000000001"
PIPELINE_ID="0ac00000-0000-4000-8000-000000000010"
STAGE_NEW_ID="0ac00000-0000-4000-8000-000000000020"
STAGE_CONTACTED_ID="0ac00000-0000-4000-8000-000000000021"
STAGE_ENROLLED_ID="0ac00000-0000-4000-8000-000000000022"
STAGE_REJECTED_ID="0ac00000-0000-4000-8000-000000000023"
LIST_PREQUALIFIED_ID="0ac00000-0000-4000-8000-000000000030"
LIST_QUALIFIED_ID="0ac00000-0000-4000-8000-000000000031"
LIST_PROSPECTS_ID="0ac00000-0000-4000-8000-000000000032"
LIST_APPLICATIONS_ID="0ac00000-0000-4000-8000-000000000033"

echo "== ${ENV} : seed ${TENANT_SLUG} =="

# Abort if the tenant already exists — this script provisions once; it never
# re-shapes an existing gate tenant.
EXISTING="$(psql "$DB" -tAc "select count(*) from tenants where slug = '${TENANT_SLUG}';" | tr -d '[:space:]')"
if [ "$EXISTING" != "0" ]; then
  echo "ABORT: a tenant with slug '${TENANT_SLUG}' already exists on ${ENV}. This script only provisions the gate tenant once — nothing to do." >&2
  exit 1
fi

# Abort if the owner login doesn't exist, or already belongs to another
# tenant (see header comment for why).
OWNER_UID="$(psql "$DB" -tAc "select id from auth.users where email = '${OWNER_EMAIL}' limit 1;" | tr -d '[:space:]')"
if [ -z "$OWNER_UID" ]; then
  echo "ABORT: no auth.users row for '${OWNER_EMAIL}' on ${ENV}. Create the login first (brief Part B step 1 — Supabase dashboard -> Authentication -> Add user)." >&2
  exit 1
fi
EXISTING_MEMBERSHIP="$(psql "$DB" -tAc "select count(*) from tenant_users where user_id = '${OWNER_UID}';" | tr -d '[:space:]')"
if [ "$EXISTING_MEMBERSHIP" != "0" ]; then
  echo "ABORT: '${OWNER_EMAIL}' already belongs to ${EXISTING_MEMBERSHIP} tenant(s) on ${ENV}. One login can only belong to one tenant (getCurrentUserTenant()/authenticateRequest() use .single()) — this must be a dedicated login with no existing membership." >&2
  exit 1
fi

echo "-- before --"
psql "$DB" -tAc "
select 'tenants(${TENANT_SLUG})'   || E'\t' || count(*) from tenants where slug = '${TENANT_SLUG}'
union all select 'tenant_users(owner)' || E'\t' || count(*) from tenant_users where user_id = '${OWNER_UID}'
union all select 'pipelines'          || E'\t' || count(*) from pipelines where tenant_id = '${TENANT_ID}'
union all select 'pipeline_stages'    || E'\t' || count(*) from pipeline_stages where tenant_id = '${TENANT_ID}'
union all select 'lead_lists'         || E'\t' || count(*) from lead_lists where tenant_id = '${TENANT_ID}'
;" | sed 's/^/  /'

SQL_FILE="$(mktemp)"
trap 'rm -f "$SQL_FILE"' EXIT

cat > "$SQL_FILE" <<SQL
BEGIN;

-- 1. Tenant — synthetic by construction (see brief for the full inflow-path
--    table: no form_configs row, no integration key, no positions, no leads,
--    exactly one member).
INSERT INTO public.tenants (id, name, slug, primary_color, industry_id, config)
VALUES ('${TENANT_ID}', '${TENANT_NAME}', '${TENANT_SLUG}', '#6366f1', '${INDUSTRY_ID}', '{}'::jsonb);

-- 2. Owner membership — the ONLY member, on the dedicated synthetic login.
INSERT INTO public.tenant_users (tenant_id, user_id, role)
VALUES ('${TENANT_ID}', '${OWNER_UID}', 'owner');

-- 3. Default pipeline.
INSERT INTO public.pipelines (id, tenant_id, name, slug, is_default, position)
VALUES ('${PIPELINE_ID}', '${TENANT_ID}', 'Admissions Pipeline', 'admissions-pipeline', true, 0);

-- 4. Pipeline stages (education default — mirrors seed-education-local.sh step 4).
INSERT INTO public.pipeline_stages (id, pipeline_id, tenant_id, name, slug, position, color, is_default, is_terminal)
VALUES
  ('${STAGE_NEW_ID}',       '${PIPELINE_ID}', '${TENANT_ID}', 'New',       'new',       0, '#3b82f6', true,  false),
  ('${STAGE_CONTACTED_ID}', '${PIPELINE_ID}', '${TENANT_ID}', 'Contacted', 'contacted', 1, '#f97316', false, false),
  ('${STAGE_ENROLLED_ID}',  '${PIPELINE_ID}', '${TENANT_ID}', 'Enrolled',  'enrolled',  2, '#22c55e', false, true),
  ('${STAGE_REJECTED_ID}',  '${PIPELINE_ID}', '${TENANT_ID}', 'Rejected',  'rejected',  3, '#ef4444', false, true);

-- 5. Lead lists (education funnel "Stage" lists, mirrors seed-education-local.sh
--    step 5) — pipeline_id MUST be set on every list: a null breaks
--    update_lead_stage on any real write. Pre-qualified is also the intake
--    list (is_intake=true) — this is where the education_consultancy default
--    seeding (migration 059) originally routed new leads, and it is the
--    single row src/app/(main)/api/v1/leads/route.ts's
--    is_intake=true, limit 1, maybeSingle() query needs for the C4/Part D
--    single-lead-create smoke test to land somewhere instead of list_id=null.
INSERT INTO public.lead_lists (id, tenant_id, name, slug, sort_order, is_system, is_intake, color, access, pipeline_id)
VALUES
  ('${LIST_PREQUALIFIED_ID}', '${TENANT_ID}', 'Pre-qualified', 'pre-qualified', 1, true, true,  '#6366f1', '{"mode":"all"}'::jsonb, '${PIPELINE_ID}'),
  ('${LIST_QUALIFIED_ID}',    '${TENANT_ID}', 'Qualified',     'qualified',     2, true, false, '#3b82f6', '{"mode":"all"}'::jsonb, '${PIPELINE_ID}'),
  ('${LIST_PROSPECTS_ID}',    '${TENANT_ID}', 'Prospects',     'prospects',     3, true, false, '#f97316', '{"mode":"all"}'::jsonb, '${PIPELINE_ID}'),
  ('${LIST_APPLICATIONS_ID}', '${TENANT_ID}', 'Applications',  'applications',  4, true, false, '#22c55e', '{"mode":"all"}'::jsonb, '${PIPELINE_ID}');

COMMIT;
SQL

if [ "$DRY_RUN" = true ]; then
  echo "-- dry run: applying inside a transaction, then rolling back --"
  # Swap the final COMMIT for ROLLBACK so nothing persists, while every
  # statement still runs for real against the live schema — a --dry-run
  # failure means a real run would fail too.
  sed -i.bak 's/^COMMIT;$/ROLLBACK;/' "$SQL_FILE" && rm -f "${SQL_FILE}.bak"
  if ! psql "$DB" -v ON_ERROR_STOP=1 -f "$SQL_FILE"; then
    echo "FAILED (dry run) — nothing was applied." >&2
    exit 1
  fi
  echo "-- dry run OK, rolled back. Re-run without --dry-run to apply. --"
  exit 0
fi

echo "-- applying --"
if ! psql "$DB" -v ON_ERROR_STOP=1 -f "$SQL_FILE"; then
  echo "FAILED — nothing after this point was applied (single transaction)." >&2
  exit 1
fi

echo "-- after --"
psql "$DB" -tAc "
select 'tenants(${TENANT_SLUG})'   || E'\t' || count(*) from tenants where slug = '${TENANT_SLUG}'
union all select 'tenant_users(owner)' || E'\t' || count(*) from tenant_users where user_id = '${OWNER_UID}'
union all select 'pipelines'          || E'\t' || count(*) from pipelines where tenant_id = '${TENANT_ID}'
union all select 'pipeline_stages'    || E'\t' || count(*) from pipeline_stages where tenant_id = '${TENANT_ID}'
union all select 'lead_lists'         || E'\t' || count(*) from lead_lists where tenant_id = '${TENANT_ID}'
;" | sed 's/^/  /'

echo "== done: ${TENANT_NAME} (${TENANT_SLUG}) seeded, owner=${OWNER_EMAIL} =="
