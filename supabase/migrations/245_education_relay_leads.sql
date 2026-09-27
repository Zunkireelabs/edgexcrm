-- Migration 245: Team & Lead Performance dashboard — Person -> Lead drill level.
-- (education_consultancy). education_relay_aggregates (mig 241) is a GROUP BY —
-- it has no lead ids. This RPC returns individual lead rows for one
-- stage x position x person cell (position nullable — the jump-to-person view
-- doesn't pre-filter by position, only stage x person).
--
-- Mirrors migration 241's active/archived-enrolled duality so a cell's lead
-- list matches the numbers shown for that cell: a currently-archived lead
-- that won an application before archiving still counts toward that cell's
-- enrolled_cnt/tuition_value (mig 241), so it must still appear here when
-- drilling into that same cell, attributed to its archived_from_list_id.
--
-- Window-independent — this is "show me this person's current leads right
-- now," not scoped to the dashboard's date-window filter (matches the
-- original plan's Level 5 spec).
--
-- p_user_id NULL handling (unassigned leads) added in migration 247 — see
-- that file.
--
-- "Days in stage" uses leads.stage_changed_at — verified this column IS
-- updated on a list_id change, not just stage_id/status (see
-- src/lib/leads/apply-lead-patch.ts's update-payload branch), so it is a
-- legitimate list_id-lifecycle timestamp, not a fabricated fact.
--
-- "Last touch" is all-time (not window-scoped) MAX() across the same
-- canonical touched sources as migration 241/242's header comments:
-- lead_activities(activity_type IN ('call','email','meeting')) UNION lead_notes.
--
--   Expected before/after row counts: 0 rows touched (function definition only).
--   Rollback: DROP FUNCTION IF EXISTS education_relay_leads(UUID, TEXT, TEXT, UUID);
--   Applied: stage <YYYY-MM-DD> / prod HELD.

BEGIN;

CREATE OR REPLACE FUNCTION education_relay_leads(p_tenant UUID, p_stage_slug TEXT, p_position_slug TEXT, p_user_id UUID)
RETURNS TABLE (
  lead_id        UUID,
  display_name   TEXT,
  stage_name     TEXT,
  assignee_email TEXT,
  days_in_stage  NUMERIC,
  last_touch_at  TIMESTAMPTZ,
  note_preview   TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH candidates AS (
    SELECT l.id, l.stage_changed_at, l.created_at, ll.name AS stage_name, u.email AS assignee_email
    FROM leads l
    JOIN lead_lists ll ON ll.id = l.list_id AND ll.is_archive = false
    LEFT JOIN tenant_users tu ON tu.tenant_id = l.tenant_id AND tu.user_id = l.assigned_to
    LEFT JOIN positions p ON p.id = tu.position_id
    LEFT JOIN auth.users u ON u.id = l.assigned_to
    WHERE l.tenant_id = p_tenant
      AND l.deleted_at IS NULL
      AND ll.slug = p_stage_slug
      AND l.assigned_to = p_user_id
      AND (p_position_slug IS NULL OR p.slug = p_position_slug)

    UNION ALL

    SELECT l.id, l.stage_changed_at, l.created_at, ll_prev.name AS stage_name, u.email AS assignee_email
    FROM leads l
    JOIN lead_lists ll_cur ON ll_cur.id = l.list_id AND ll_cur.is_archive = true
    JOIN lead_lists ll_prev ON ll_prev.id = l.archived_from_list_id AND ll_prev.slug = p_stage_slug
    LEFT JOIN tenant_users tu ON tu.tenant_id = l.tenant_id AND tu.user_id = l.assigned_to
    LEFT JOIN positions p ON p.id = tu.position_id
    LEFT JOIN auth.users u ON u.id = l.assigned_to
    WHERE l.tenant_id = p_tenant
      AND l.deleted_at IS NULL
      AND l.assigned_to = p_user_id
      AND (p_position_slug IS NULL OR p.slug = p_position_slug)
      AND EXISTS (
        SELECT 1 FROM applications a2
        JOIN application_stages s2 ON s2.id = a2.stage_id
        WHERE a2.lead_id = l.id AND a2.tenant_id = p_tenant AND a2.deleted_at IS NULL AND s2.terminal_type = 'won'
      )
  ),
  last_touch AS (
    SELECT lead_id, MAX(touched_at) AS last_touch_at FROM (
      SELECT lead_id, created_at AS touched_at FROM lead_activities
      WHERE tenant_id = p_tenant AND activity_type IN ('call', 'email', 'meeting')
      UNION ALL
      SELECT ln.lead_id, ln.created_at FROM lead_notes ln
      JOIN leads l2 ON l2.id = ln.lead_id
      WHERE l2.tenant_id = p_tenant
    ) touches
    GROUP BY lead_id
  ),
  latest_note AS (
    SELECT DISTINCT ON (ln.lead_id) ln.lead_id, ln.content
    FROM lead_notes ln
    JOIN leads l3 ON l3.id = ln.lead_id
    WHERE l3.tenant_id = p_tenant
    ORDER BY ln.lead_id, ln.created_at DESC
  )
  SELECT
    c.id AS lead_id,
    COALESCE(NULLIF(TRIM(CONCAT(l.first_name, ' ', l.last_name)), ''), l.email, l.display_id, c.id::text) AS display_name,
    c.stage_name,
    c.assignee_email,
    EXTRACT(EPOCH FROM (NOW() - COALESCE(c.stage_changed_at, c.created_at))) / 86400.0 AS days_in_stage,
    lt.last_touch_at,
    LEFT(ln.content, 140) AS note_preview
  FROM candidates c
  JOIN leads l ON l.id = c.id
  LEFT JOIN last_touch lt ON lt.lead_id = c.id
  LEFT JOIN latest_note ln ON ln.lead_id = c.id
  ORDER BY days_in_stage DESC;
$$;

GRANT EXECUTE ON FUNCTION education_relay_leads(UUID, TEXT, TEXT, UUID) TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('245_education_relay_leads.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
