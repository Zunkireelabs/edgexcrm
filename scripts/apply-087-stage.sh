#!/usr/bin/env bash
# Apply migration 087 to the STAGE database (dymeudcddasqpomfpjvt).
# Opus runs this after reviewing the diff. DO NOT run without Opus approval.
set -euo pipefail

STAGE_DB="postgresql://postgres:Zunkiree%40123%25%5E%26@db.dymeudcddasqpomfpjvt.supabase.co:5432/postgres"
MIGRATION="$(dirname "$0")/../supabase/migrations/087_nationality_intake_account.sql"

echo "Applying migration 087 to STAGE..."
psql "$STAGE_DB" -f "$MIGRATION"
echo "Done."
