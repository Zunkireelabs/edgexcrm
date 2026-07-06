#!/usr/bin/env bash
# migrate-apply.sh — apply pending migrations to a DB, in order, idempotently.
#
# Usage:
#   STAGE_DB_URL='postgresql://...' scripts/migrate-apply.sh stage [--dry-run]
#   PROD_DB_URL='postgresql://...'  scripts/migrate-apply.sh prod  [--dry-run]
#
# "Pending" = numbered files in supabase/migrations/ (^[0-9]{3}_.*\.sql$, excludes
# _TEMPLATE.sql) not yet recorded in public.schema_migrations (mig 123), sorted by
# filename — same comparison scripts/migrate-status.sh uses, so a dup number like
# 110_lead_notes_checkout.sql / 110_task_assignment.sql is two distinct rows and
# both apply, in filename order.
#
# All pending files are fed to ONE psql session (via \i), not one psql process per
# file: a Postgres advisory lock only holds for the life of a session, and the
# brief's "advisory lock for the whole run" requirement only works if the whole
# run IS one session. Each migration file is still self-contained
# (BEGIN;...COMMIT; + self-records — see supabase/migrations/_TEMPLATE.sql), so
# this is not one big transaction: -1 is deliberately NOT used on the outer
# session, since that would wrap everything in one transaction and the first
# file's inner COMMIT would end it early, breaking every file after it.
#
# ON_ERROR_STOP=1 halts the session on the first failing statement; psql's error
# output is prefixed with the exact file (psql:/abs/path/NNN_x.sql:LINE: ERROR...)
# via \i's file-context tracking. Files that already committed before the failure
# stay applied and self-recorded; re-running the script only retries what's still
# pending. The advisory lock releases when the session ends — on success (explicit
# unlock) or on failure (connection drop) — so a failed run never leaves the DB
# locked.
set -euo pipefail

ENV="${1:-}"
DRY_RUN=false
for arg in "${@:2}"; do
  [ "$arg" = "--dry-run" ] && DRY_RUN=true
done

case "$ENV" in
  stage) DB="${STAGE_DB_URL:-}"; [ -z "$DB" ] && { echo "Set STAGE_DB_URL (see CLAUDE.md § Credentials)."; exit 1; } ;;
  prod)  DB="${PROD_DB_URL:-}";  [ -z "$DB" ] && { echo "Set PROD_DB_URL (see CLAUDE.md § Credentials)."; exit 1; } ;;
  *)     echo "Usage: $0 <stage|prod> [--dry-run]   (DB URL via STAGE_DB_URL / PROD_DB_URL env)"; exit 1 ;;
esac

DIR="$(cd "$(dirname "$0")/../supabase/migrations" && pwd)"
FILES="$(mktemp)"; APPLIED="$(mktemp)"; PENDING="$(mktemp)"; SESSION_SQL="$(mktemp)"
CONN_ERR="$(mktemp)"; LEDGER_ERR="$(mktemp)"
trap 'rm -f "$FILES" "$APPLIED" "$PENDING" "$SESSION_SQL" "$CONN_ERR" "$LEDGER_ERR"' EXIT

# Real, numbered migration files (excludes _TEMPLATE.sql), sorted.
ls "$DIR" | grep -E '^[0-9]{3}_.*\.sql$' | sort > "$FILES"

# FAIL-CLOSED: prove we can reach the DB before reading the ledger. A connection
# or auth error must NOT be silently treated as "0 applied" — that would mark
# every migration pending and try to re-apply all of them. Only a genuinely
# empty/absent ledger is a legitimate "0 applied".
if ! psql "$DB" -tAc "SELECT 1;" >/dev/null 2>"$CONN_ERR"; then
  echo "ERROR: cannot reach the $ENV database — refusing to run (NOT assuming an empty ledger)." >&2
  cat "$CONN_ERR" >&2
  exit 1
fi

# Applied set from the ledger. A missing ledger table (fresh DB, mig 123 not yet
# applied) is a legitimate 0-applied; any OTHER error aborts.
if psql "$DB" -tAc "SELECT version FROM public.schema_migrations ORDER BY version;" 2>"$LEDGER_ERR" \
     | sed '/^$/d' | sort > "$APPLIED"; then
  :
elif grep -qiE 'relation .*schema_migrations.* does not exist|does not exist' "$LEDGER_ERR"; then
  : > "$APPLIED"   # fresh DB — ledger table not created yet → 0 applied (legit)
  echo "note: schema_migrations not found on $ENV — treating as fresh DB (0 applied)."
else
  echo "ERROR: could not read the migration ledger on $ENV — aborting." >&2
  cat "$LEDGER_ERR" >&2
  exit 1
fi

comm -23 "$FILES" "$APPLIED" > "$PENDING" || true

COUNT="$(wc -l < "$PENDING" | tr -d ' ')"

if [ "$COUNT" -eq 0 ]; then
  echo "== $ENV : 0 pending — nothing to apply =="
  exit 0
fi

echo "== $ENV : $COUNT pending =="
sed 's/^/  - /' "$PENDING"

if [ "$DRY_RUN" = true ]; then
  echo "-- dry run, not applying --"
  exit 0
fi

# Arbitrary fixed advisory lock key, shared across every migrate-apply.sh
# invocation against any DB — the point is mutual exclusion between two
# concurrent runs, not a per-DB or per-migration key.
LOCK_KEY=7834521099

{
  echo "SELECT pg_advisory_lock($LOCK_KEY);"
  while IFS= read -r f; do
    echo "\\i $DIR/$f"
  done < "$PENDING"
  echo "SELECT pg_advisory_unlock($LOCK_KEY);"
} > "$SESSION_SQL"

echo "-- applying --"
if ! psql "$DB" -v ON_ERROR_STOP=1 -f "$SESSION_SQL"; then
  echo "FAILED — see the file named in the error above."
  exit 1
fi

echo "== applied $COUNT migration(s): =="
sed 's/^/  - /' "$PENDING"
