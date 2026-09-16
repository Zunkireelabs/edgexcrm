#!/usr/bin/env bash
# set-tenant-ai.sh — turn the AI assistant (or the agent-specific grant) on or
# off for ONE tenant, per environment.
#
# Usage:
#   scripts/set-tenant-ai.sh local  <tenant-slug> on|off [assistant|agents]
#   STAGE_DB_URL='postgresql://...' scripts/set-tenant-ai.sh stage <tenant-slug> on|off [assistant|agents]
#   PROD_DB_URL='postgresql://...'  scripts/set-tenant-ai.sh prod  <tenant-slug> on|off [assistant|agents]
#
# The optional 4th argument selects which column to flip. Default is
# `assistant` (tenants.ai_enabled) — today's behaviour, unchanged. `agents`
# flips tenants.ai_agents_enabled (migration 185) instead — the separate,
# agent-specific per-tenant grant isAgentsEnabledForTenant() (src/lib/ai/flag.ts)
# requires ON TOP of ai_enabled before any agent can run for that tenant.
#
# WHY THIS IS A SCRIPT AND NOT A MIGRATION BACKFILL
#
# tenants.ai_enabled (migration 174) defaults to false so every tenant is
# opted OUT until someone deliberately opts them in — that column IS the
# consent gate ADR-001 Decision 5 requires. tenants.ai_agents_enabled
# (migration 185) is the same idea one layer up: opted OUT by default, a
# deliberate per-tenant grant. A backfill inside either migration would run
# on every environment the migration reaches, including prod, and would
# therefore switch AI (or agents) on for Admizz (live student PII) the moment
# the migration promotes — the exact thing D5 forbids. Neither migration must
# ever enable a tenant; enabling is a per-environment, per-tenant, human
# decision, and this script is how that decision gets executed and logged.
#
# D5's rollout order for PROD is fixed: Zunkiree Labs -> Mobilise -> Admizz
# LAST, and Admizz only after written client consent covering AI processing
# and the sub-processor list. Stage is NOT reliably clean of real customer PII
# — CLAUDE.md § Credentials was corrected 2026-07-19 after a past version of
# this comment ("stage is a sanitized clone") turned out to be false and
# misled a privacy assessment: 16,436 of Admizz's 16,684 stage leads carry a
# real phone number. Confirm a stage tenant is actually synthetic by
# construction — e.g. the dedicated `orca-gate` gate tenant — before enabling
# it freely; do not assume every stage tenant is safe to flip on by default.
#
# One tenant per invocation, by slug, on purpose: no bulk "enable everything"
# mode exists, because the one operation you must never perform accidentally
# is enabling a tenant nobody consented for.
set -euo pipefail

ENV="${1:-}"
SLUG="${2:-}"
STATE="${3:-}"
COLUMN="${4:-assistant}"

case "$ENV" in
  local) DB="${LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}" ;;
  stage) DB="${STAGE_DB_URL:-}"; [ -z "$DB" ] && { echo "Set STAGE_DB_URL (see CLAUDE.md § Credentials)."; exit 1; } ;;
  prod)  DB="${PROD_DB_URL:-}";  [ -z "$DB" ] && { echo "Set PROD_DB_URL (see CLAUDE.md § Credentials)."; exit 1; } ;;
  *) echo "Usage: scripts/set-tenant-ai.sh local|stage|prod <tenant-slug> on|off [assistant|agents]"; exit 1 ;;
esac

[ -z "$SLUG" ] && { echo "Missing <tenant-slug>."; exit 1; }
case "$STATE" in
  on)  VALUE=true  ;;
  off) VALUE=false ;;
  *) echo "Third argument must be 'on' or 'off'."; exit 1 ;;
esac

case "$COLUMN" in
  assistant) DB_COLUMN="ai_enabled" ;;
  agents)    DB_COLUMN="ai_agents_enabled" ;;
  *) echo "Fourth argument must be 'assistant' or 'agents' (got '${COLUMN}')."; exit 1 ;;
esac

# Fail loudly on a slug that doesn't exist rather than reporting "0 rows
# updated" as success — a typo'd slug must not look like a completed action.
EXISTS="$(psql "$DB" -tAc "select count(*) from tenants where slug = '${SLUG}';")"
if [ "$EXISTS" != "1" ]; then
  echo "No tenant with slug '${SLUG}' in ${ENV} (found ${EXISTS}). Available:"
  psql "$DB" -tAc "select '  - ' || slug from tenants order by slug;"
  exit 1
fi

# isAgentsEnabledForTenant() (src/lib/ai/flag.ts) requires BOTH ai_enabled AND
# ai_agents_enabled — refuse to turn agents on for a tenant that doesn't have
# the assistant enabled yet, since the grant would silently do nothing.
if [ "$DB_COLUMN" = "ai_agents_enabled" ] && [ "$VALUE" = "true" ]; then
  ASSISTANT_ENABLED="$(psql "$DB" -tAc "select ai_enabled from tenants where slug = '${SLUG}';" | tr -d '[:space:]')"
  if [ "$ASSISTANT_ENABLED" != "t" ]; then
    echo "ABORT: '${SLUG}' has ai_enabled=${ASSISTANT_ENABLED} on ${ENV}. isAgentsEnabledForTenant() requires ai_enabled AND ai_agents_enabled both true — run '$0 ${ENV} ${SLUG} on assistant' first." >&2
    exit 1
  fi
fi

echo "== ${ENV} : ${SLUG} -> ${DB_COLUMN} = ${VALUE} =="
echo "before:"
psql "$DB" -tAc "select '  ' || slug || ' = ' || ${DB_COLUMN} from tenants where slug = '${SLUG}';"

psql "$DB" -v ON_ERROR_STOP=1 <<SQL
BEGIN;
UPDATE tenants SET ${DB_COLUMN} = ${VALUE} WHERE slug = '${SLUG}';
COMMIT;
SQL

echo "after:"
psql "$DB" -tAc "select '  ' || slug || ' = ' || ${DB_COLUMN} from tenants where slug = '${SLUG}';"
echo
echo "All tenants in ${ENV}:"
psql "$DB" -tAc "select '  ' || rpad(slug, 22) || ${DB_COLUMN} from tenants order by slug;"
