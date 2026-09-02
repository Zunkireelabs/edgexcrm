-- Migration 221: UTM link click tracking
--
-- Tracking links currently point straight at the destination with UTM params
-- in the query string — no server-side hop, so nothing is ever recorded as a
-- "click" distinct from a "submission." Adds a click_count column plus an
-- atomic increment RPC for the new /r/[linkId] redirect route to call.
--
-- increment_utm_link_clicks is granted to anon (the redirect route is hit by
-- unauthenticated visitors) as well as authenticated, mirrors the SECURITY
-- DEFINER + search_path convention used by get_user_tenant_ids().
--
-- Additive only.
--   Expected before/after row counts: utm_links: N -> N (0 rows touched;
--     click_count defaults to 0 on existing + new rows).
--   Rollback:
--     REVOKE EXECUTE ON FUNCTION increment_utm_link_clicks(uuid) FROM authenticated, anon;
--     DROP FUNCTION IF EXISTS increment_utm_link_clicks(uuid);
--     ALTER TABLE utm_links DROP COLUMN IF EXISTS click_count;
--   Applied: stage <YYYY-MM-DD> / prod HELD.

BEGIN;

ALTER TABLE utm_links ADD COLUMN IF NOT EXISTS click_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION increment_utm_link_clicks(p_link_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE utm_links SET click_count = click_count + 1 WHERE id = p_link_id;
$$;

GRANT EXECUTE ON FUNCTION increment_utm_link_clicks(uuid) TO authenticated, anon;

INSERT INTO public.schema_migrations (version) VALUES ('221_utm_link_click_tracking.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
