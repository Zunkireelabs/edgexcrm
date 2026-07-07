#!/usr/bin/env bash
# check-migrations.sh — CI guard that stops the #1 cause of migration ledger drift:
# a migration file that does NOT self-record into public.schema_migrations.
#
# Root incident (2026-07-07): migs 124/126/127 shipped WITHOUT the required
# self-record line, were hand-applied to stage+prod, but never recorded — so the
# ledger stuck at 123 while the schema was at 127. scripts/migrate-apply.sh then
# treats them as "pending" and re-runs them; 124's unguarded CREATE POLICY fails
# and (fail-closed) blocks the next deploy. See docs/dev-collab/DEV-WORKFLOW-AND-DEPLOYMENT.md.
#
# What this checks, for every migration file ADDED/MODIFIED in the PR:
#   1) It contains  INSERT INTO public.schema_migrations (version) VALUES ('<file>')
#      with the version string EQUAL to the file's own exact basename.
#   2) That INSERT uses ON CONFLICT DO NOTHING (idempotent — safe to re-run/replay).
#
# Usage:
#   BASE_REF=origin/stage scripts/check-migrations.sh          # compare vs a base
#   scripts/check-migrations.sh <base-ref>                     # base as an arg
#   scripts/check-migrations.sh --all                          # check EVERY numbered file (repo audit)
#
# In CI, BASE_REF is set to origin/<PR base branch>. Locally, defaults to origin/stage.
set -euo pipefail

# Grandfather floor: the ledger (self-record convention) was introduced by
# migration 123 on 2026-07-06; every file numbered < 123 predates it and was
# bulk-backfilled into public.schema_migrations. Only enforce self-record on
# 123 and newer — that's every migration anyone writes from now on.
FLOOR=123

DIR="$(cd "$(dirname "$0")/../supabase/migrations" && pwd)"

# Resolve which files to check.
MODE="diff"
BASE="${BASE_REF:-}"
if [ "${1:-}" = "--all" ]; then
  MODE="all"
elif [ -n "${1:-}" ]; then
  BASE="$1"
fi
[ -z "$BASE" ] && BASE="origin/stage"

LIST="$(mktemp)"; trap 'rm -f "$LIST"' EXIT

if [ "$MODE" = "all" ]; then
  ls "$DIR" | grep -E '^[0-9]{3}_.*\.sql$' | sed "s#^#supabase/migrations/#" > "$LIST"
else
  # Added or modified (not deleted) migration files on this PR branch vs the base.
  # Three-dot: changes since the merge-base, i.e. what THIS branch introduces.
  git diff --name-only --diff-filter=AM "${BASE}...HEAD" -- supabase/migrations/ 2>/dev/null \
    | grep -E 'supabase/migrations/[0-9]{3}_.*\.sql$' > "$LIST" || true
fi

if [ ! -s "$LIST" ]; then
  echo "✓ migration guard: no added/modified migration files to check (base=$BASE)."
  exit 0
fi

FAIL=0
while IFS= read -r path; do
  [ -n "$path" ] || continue
  [ -f "$path" ] || continue                       # skip deletions/renames-away
  file="$(basename "$path")"
  [ "$file" = "_TEMPLATE.sql" ] && continue

  # Grandfather: skip pre-ledger migrations (< FLOOR).
  num="$(echo "$file" | sed -E 's/^0*([0-9]+)_.*/\1/')"
  if [ "$num" -lt "$FLOOR" ] 2>/dev/null; then
    continue
  fi

  # 1) self-record present with THIS file's exact name?
  if ! grep -Eq "schema_migrations[[:space:]]*\(version\)[[:space:]]*VALUES[[:space:]]*\([[:space:]]*'${file}'[[:space:]]*\)" "$path"; then
    echo "✗ $file — MISSING self-record line."
    echo "    Add before its final COMMIT;:"
    echo "      INSERT INTO public.schema_migrations (version) VALUES ('${file}')"
    echo "        ON CONFLICT (version) DO NOTHING;"
    FAIL=1
    continue
  fi

  # 2) idempotent insert (ON CONFLICT DO NOTHING somewhere in the file)?
  if ! grep -Eiq 'ON CONFLICT[[:space:]]*\(version\)[[:space:]]*DO NOTHING' "$path"; then
    echo "✗ $file — self-record must be idempotent: use ON CONFLICT (version) DO NOTHING."
    FAIL=1
    continue
  fi

  echo "✓ $file — self-records correctly."
done < "$LIST"

if [ "$FAIL" -ne 0 ]; then
  echo
  echo "Migration guard FAILED. Every migration must self-record in the ledger"
  echo "(mig 123, public.schema_migrations) using its own exact filename — see"
  echo "supabase/migrations/_TEMPLATE.sql. This is what keeps the auto-migrate gate"
  echo "from re-running already-applied migrations. Fix the file(s) above."
  exit 1
fi

echo
echo "✓ migration guard passed."
