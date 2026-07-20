#!/usr/bin/env bash
# set-tenant-ai.sh — turn the AI assistant on or off for ONE tenant, per environment.
#
# Usage:
#   scripts/set-tenant-ai.sh local  <tenant-slug> on|off
#   STAGE_DB_URL='postgresql://...' scripts/set-tenant-ai.sh stage <tenant-slug> on|off
#   PROD_DB_URL='postgresql://...'  scripts/set-tenant-ai.sh prod  <tenant-slug> on|off
#
# WHY THIS IS A SCRIPT AND NOT A MIGRATION BACKFILL
#
# tenants.ai_enabled (migration 174) defaults to false so every tenant is
# opted OUT until someone deliberately opts them in — that column IS the
# consent gate ADR-001 Decision 5 requires. A backfill inside the migration
# would run on every environment the migration reaches, including prod, and
# would therefore switch AI on for Admizz (live student PII) the moment 174
# promotes — the exact thing D5 forbids. The migration must never enable a
# tenant; enabling is a per-environment, per-tenant, human decision, and this
# script is how that decision gets executed and logged.
#
# D5's rollout order for PROD is fixed: Zunkiree Labs -> Mobilise -> Admizz
# LAST, and Admizz only after written client consent covering AI processing
# and the sub-processor list. Stage is a sanitized clone (end-customer PII
# scrubbed), so stage tenants can be enabled freely.
#
# One tenant per invocation, by slug, on purpose: no bulk "enable everything"
# mode exists, because the one operation you must never perform accidentally
# is enabling a tenant nobody consented for.
set -euo pipefail

ENV="${1:-}"
SLUG="${2:-}"
STATE="${3:-}"

case "$ENV" in
  local) DB="${LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}" ;;
  stage) DB="${STAGE_DB_URL:-}"; [ -z "$DB" ] && { echo "Set STAGE_DB_URL (see CLAUDE.md § Credentials)."; exit 1; } ;;
  prod)  DB="${PROD_DB_URL:-}";  [ -z "$DB" ] && { echo "Set PROD_DB_URL (see CLAUDE.md § Credentials)."; exit 1; } ;;
  *) echo "Usage: scripts/set-tenant-ai.sh local|stage|prod <tenant-slug> on|off"; exit 1 ;;
esac

[ -z "$SLUG" ] && { echo "Missing <tenant-slug>."; exit 1; }
case "$STATE" in
  on)  VALUE=true  ;;
  off) VALUE=false ;;
  *) echo "Third argument must be 'on' or 'off'."; exit 1 ;;
esac

# Fail loudly on a slug that doesn't exist rather than reporting "0 rows
# updated" as success — a typo'd slug must not look like a completed action.
EXISTS="$(psql "$DB" -tAc "select count(*) from tenants where slug = '${SLUG}';")"
if [ "$EXISTS" != "1" ]; then
  echo "No tenant with slug '${SLUG}' in ${ENV} (found ${EXISTS}). Available:"
  psql "$DB" -tAc "select '  - ' || slug from tenants order by slug;"
  exit 1
fi

echo "== ${ENV} : ${SLUG} -> ai_enabled = ${VALUE} =="
echo "before:"
psql "$DB" -tAc "select '  ' || slug || ' = ' || ai_enabled from tenants where slug = '${SLUG}';"

psql "$DB" -v ON_ERROR_STOP=1 <<SQL
BEGIN;
UPDATE tenants SET ai_enabled = ${VALUE} WHERE slug = '${SLUG}';
COMMIT;
SQL

echo "after:"
psql "$DB" -tAc "select '  ' || slug || ' = ' || ai_enabled from tenants where slug = '${SLUG}';"
echo
echo "All tenants in ${ENV}:"
psql "$DB" -tAc "select '  ' || rpad(slug, 22) || ai_enabled from tenants order by slug;"
