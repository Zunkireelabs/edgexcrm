-- Migration 116: HRMS Phase 2a — tenant locale (timezone + weekend days)
-- Additive only. Not applied by Sonnet — Opus applies to stage after review
-- (see CLAUDE.md migration workflow).
--
-- Backs server-side leave day-counting: all leave day math (Chunk B) runs in
-- the tenant's timezone and excludes the tenant's configured weekend days.
-- weekend_days uses JS Date.getDay() convention: 0=Sun … 6=Sat.
-- Default Asia/Kathmandu + Saturday matches the primary Nepal tenant base.

BEGIN;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kathmandu';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS weekend_days SMALLINT[] NOT NULL DEFAULT '{6}';

-- Additive-only: 2 new columns on tenants, 0 rows added/removed.
-- Expected before/after: tenants row count unchanged; every existing row
-- backfilled with the default (Asia/Kathmandu, Saturday) via DEFAULT.

COMMIT;
