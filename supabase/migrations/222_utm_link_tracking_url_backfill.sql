-- Migration 222: backfill utm_links.tracking_url to the click-tracking format
--
-- Links saved before migration 221 (PR #474) still have tracking_url pointing
-- directly at the destination — bypassing /r/[linkId], so they show
-- Clicks: 0 forever. Rewrite tracking_url to /r/<id> for those rows; the
-- redirect route reads destination_url/utm_source/utm_medium/utm_campaign
-- from the row itself, not from the URL, so no other column needs to change.
--
-- Base URL hardcoded to https://edgex.zunkireelabs.com — same literal already
-- used as the NEXT_PUBLIC_APP_URL fallback (src/lib/email/index.ts) and as
-- FORM_PUBLIC_BASE_URL (form-builder/lib/constants.ts) — a SQL migration has
-- no access to the app's env var, and this is stage/prod's real domain either way.
--
-- Additive-only UPDATE, idempotent (re-run is a no-op via the WHERE guard).
--   Expected before/after row counts: utm_links: N rows updated where
--     tracking_url NOT LIKE 'https://edgex.zunkireelabs.com/r/%' -> 0 rows match on re-run.
--   Rollback: not meaningful (original direct-URL values aren't preserved);
--     re-running migration 221's insert path is the only way forward from here.
--   Applied: stage <YYYY-MM-DD> / prod HELD.

BEGIN;

UPDATE utm_links
SET tracking_url = 'https://edgex.zunkireelabs.com/r/' || id::text
WHERE tracking_url NOT LIKE 'https://edgex.zunkireelabs.com/r/%';

INSERT INTO public.schema_migrations (version) VALUES ('222_utm_link_tracking_url_backfill.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
