#!/usr/bin/env bash
# migrate-status.sh — show which migrations are applied vs pending on a DB.
#
# Usage:
#   STAGE_DB_URL='postgresql://...'  scripts/migrate-status.sh stage
#   PROD_DB_URL='postgresql://...'   scripts/migrate-status.sh prod
#
# Read-only. Reads the schema_migrations ledger (migration 123+). Connection
# strings live in CLAUDE.md (§ Credentials) — pass them via env, never hardcode
# (esp. prod). This is the answer to "what's actually applied on <env>?".
set -euo pipefail

ENV="${1:-}"
case "$ENV" in
  stage) DB="${STAGE_DB_URL:-}"; [ -z "$DB" ] && { echo "Set STAGE_DB_URL (see CLAUDE.md § Credentials)."; exit 1; } ;;
  prod)  DB="${PROD_DB_URL:-}";  [ -z "$DB" ] && { echo "Set PROD_DB_URL (see CLAUDE.md § Credentials)."; exit 1; } ;;
  *)     echo "Usage: $0 <stage|prod>   (DB URL via STAGE_DB_URL / PROD_DB_URL env)"; exit 1 ;;
esac

DIR="$(cd "$(dirname "$0")/../supabase/migrations" && pwd)"
FILES="$(mktemp)"; APPLIED="$(mktemp)"
trap 'rm -f "$FILES" "$APPLIED"' EXIT

# Real, numbered migration files (excludes _TEMPLATE.sql), sorted.
ls "$DIR" | grep -E '^[0-9]{3}_.*\.sql$' | sort > "$FILES"

# Applied set from the ledger (empty if the ledger table doesn't exist yet).
psql "$DB" -tAc "SELECT version FROM public.schema_migrations ORDER BY version;" 2>/dev/null \
  | sed '/^$/d' | sort > "$APPLIED" || true

echo "== $ENV : $(wc -l < "$APPLIED" | tr -d ' ') applied / $(wc -l < "$FILES" | tr -d ' ') files in repo =="
echo
echo "-- PENDING (in repo, NOT in ledger — apply these to $ENV) --"
comm -23 "$FILES" "$APPLIED" || true
echo
echo "-- GHOST (in ledger, NOT in repo — investigate) --"
comm -13 "$FILES" "$APPLIED" || true
