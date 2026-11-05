-- Migration 280: Pulse (EDGEX-82) — per-person team activity report for education_consultancy.
--
-- Slice 1: numbers + rule-based signals, NO LLM. Four read-only SECURITY DEFINER RPCs modelled on
-- education_relay_aggregates (mig 241): LANGUAGE sql STABLE, SET search_path = public, EXECUTE granted to
-- service_role only (the API always goes through authenticateRequest + scopedClient -> db.raw().rpc()).
--
--   education_pulse_moves(...)         resolved stage moves (shared building block of the three below)
--   education_pulse_overview(...)      scoreboard + funnel in ONE pass (what the page calls); person_stats / funnel
--                                      are thin wrappers over it: one row per (user, window-bucket), and the funnel JSON
--   education_pulse_events(...)        the rows behind any number (evidence drawer)
--   education_pulse_person_daily / _timeline   the person drawer's daily chart and "What they did"
--
-- WINDOWS. The caller passes the CURRENT window [p_from, p_to). Bucket 0 = that window, bucket 1 = the equal-length
-- window immediately before it ("previous"), buckets 1..4 = the 4 windows "usual" is the mean of. One call covers
-- all five windows (span = p_from - 4*len .. p_to) — no 5 round-trips.
--
-- BINDING DEFINITIONS (docs/PULSE-BRIEF.md §2 — mirrored by features/pulse/lib/definitions.ts, unit-tested there):
--   Stage move   audit_logs entity_type='lead', action IN ('lead.updated','lead.graduated'), changes ? 'list'.
--                Destination = changes.list_ids.new when present, else list name, else list slug (check-in wrote a
--                slug into list.old). Unmatched -> not counted per stage ("Other stage"), reported in quality stats.
--   Actor        audit_logs.user_id           ("Did" columns)
--   Holder       changes.holder.new > changes.assigned_to.new > latest PRIOR assigned_to audit change > current
--                leads.assigned_to (counted as 'current_fallback' and reported)          ("Owns" columns)
--   Bulk move    changes.via.new = 'bulk', or (historical) >= p_bulk_min stage moves by one actor inside one
--                p_bulk_seconds bucket. Bulk moves are NOT in anyone's "Did" scores; they are tallied separately.
--   Notes        lead_notes joined through leads.tenant_id; new = created_at in window; edited = edited_at in window
--                AND edited_at > created_at + 1 minute; excludes AI-written (ai_tool_call_id) and soft-deleted leads.
--   Received     person became the assignee: audit assigned_to.new = person (old <> new)  UNION  leads created in
--                the window held by the person AT CREATION (initial assignment is NOT audited — lead.created has no
--                assigned_to — so: the `old` of the lead's first later reassignment if there is one, else the
--                current assignee). De-duplicated per (person, lead, bucket).
--   Prospects / Reached Applications (Owns)  moves into those lists, credited to the holder IMMEDIATELY BEFORE the move
--                (= who delivered the lead: assigned_to.old when the assignee changed in the same event, else the holder;
--                the relay re-assigns the lead as it enters the next stage, so the after-holder is the NEXT person), once per lead.
--   Back / archived (Did)  non-bulk moves to an earlier stage or into the archive list. Moved-forward chips are forward-only.
--   Applications filed (Owns)  applications.created_at in window, not deleted, by applications.assigned_to,
--                falling back to the lead's assignee.
--   Excluded lists  is_staging OR slug = 'migration-qc' OR access.mode <> 'all' (the admin-only/staging lists).
--
-- INDEXES.
--   idx_audit_logs_lead_stage_events — PARTIAL on audit_logs (tenant_id, created_at) for the lead update/graduate
--   rows Pulse scans. A plain (non-CONCURRENTLY) CREATE INDEX takes a SHARE lock on audit_logs for the build
--   (blocks writes, not reads); the migration runner is transactional so CONCURRENTLY is not an option. Safe on
--   small/medium tables; see the PR for the measured row count and build time before promoting to prod.
--   (Notes-by-time indexes are added only if EXPLAIN demands them — see the PR.)
--
--   Expected before/after row counts: 0 rows touched (functions + indexes only).
--   Rollback:
--     DROP FUNCTION IF EXISTS education_pulse_person_timeline(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, INT, INT, INT);
--     DROP FUNCTION IF EXISTS education_pulse_person_daily(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, INT, INT);
--     DROP FUNCTION IF EXISTS education_pulse_events(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, TEXT, UUID, INT, INT, INT, INT);
--     DROP FUNCTION IF EXISTS education_pulse_funnel(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, INT, INT);
--     DROP FUNCTION IF EXISTS education_pulse_person_stats(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, INT, INT);
--     DROP FUNCTION IF EXISTS education_pulse_overview(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, INT, INT);
--     DROP FUNCTION IF EXISTS education_pulse_moves(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT);
--     DROP FUNCTION IF EXISTS education_pulse_bucket(TIMESTAMPTZ, TIMESTAMPTZ, INTERVAL);
--     DROP INDEX IF EXISTS idx_audit_logs_lead_stage_events;
--   Applied: stage HELD / prod HELD (local only).

BEGIN;

CREATE INDEX IF NOT EXISTS idx_audit_logs_lead_stage_events
  ON audit_logs (tenant_id, created_at)
  WHERE entity_type = 'lead' AND action IN ('lead.updated', 'lead.graduated');

-- Which window bucket a timestamp falls in: 0 = current, 1 = previous, ... (t must be < p_to).
CREATE OR REPLACE FUNCTION education_pulse_bucket(p_t TIMESTAMPTZ, p_to TIMESTAMPTZ, p_len INTERVAL)
RETURNS INT
LANGUAGE sql IMMUTABLE AS $$
  SELECT GREATEST(CEIL(EXTRACT(EPOCH FROM (p_to - p_t)) / EXTRACT(EPOCH FROM p_len))::INT - 1, 0);
$$;

-- ── resolved stage moves ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION education_pulse_moves(
  p_tenant UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_bulk_min INT, p_bulk_seconds INT
)
RETURNS TABLE (
  audit_id      UUID,
  lead_id       UUID,
  actor_id      UUID,
  at            TIMESTAMPTZ,
  old_label     TEXT,
  new_label     TEXT,
  label_shape   TEXT,
  from_list_id  UUID,
  to_list_id    UUID,
  from_sort     INT,
  to_sort       INT,
  from_slug     TEXT,
  to_slug       TEXT,
  to_is_archive BOOLEAN,
  to_excluded   BOOLEAN,
  from_via      TEXT,
  to_via        TEXT,
  holder_id     UUID,
  holder_source TEXT,
  is_bulk       BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH lists AS (
    SELECT id, lower(btrim(name)) AS n, lower(btrim(slug)) AS s, slug, sort_order, is_archive,
           (is_staging OR slug = 'migration-qc' OR COALESCE(access->>'mode', 'all') <> 'all') AS excluded
    FROM lead_lists WHERE tenant_id = p_tenant
  ),
  by_name AS (SELECT DISTINCT ON (n) * FROM lists ORDER BY n, sort_order),
  by_slug AS (SELECT DISTINCT ON (s) * FROM lists ORDER BY s, sort_order),
  -- MATERIALIZED: pull every JSON field out ONCE into scalar columns. Left inlined, the planner re-extracted the
  -- jsonb paths for each of the six list joins below (~450ms of 600ms at Admizz scale).
  raw AS MATERIALIZED (
    SELECT a.id AS audit_id, a.entity_id AS lead_id, a.user_id AS actor_id, a.created_at AS at,
           a.changes #>> '{list,old}' AS old_label,
           a.changes #>> '{list,new}' AS new_label,
           NULLIF(a.changes #>> '{list_ids,old}', '')::UUID AS old_id,
           NULLIF(a.changes #>> '{list_ids,new}', '')::UUID AS new_id,
           NULLIF(a.changes #>> '{holder,new}', '')::UUID AS holder_new,
           NULLIF(a.changes #>> '{assigned_to,new}', '')::UUID AS assigned_new,
           NULLIF(a.changes #>> '{assigned_to,old}', '')::UUID AS assigned_old,
           (a.changes ? 'assigned_to'
             AND (a.changes #>> '{assigned_to,old}') IS DISTINCT FROM (a.changes #>> '{assigned_to,new}')) AS assign_changed,
           a.changes #>> '{via,new}' AS via,
           lower(btrim(a.changes #>> '{list,new}')) AS new_key,
           lower(btrim(a.changes #>> '{list,old}')) AS old_key
    FROM audit_logs a
    WHERE a.tenant_id = p_tenant
      AND a.entity_type = 'lead'
      AND a.action IN ('lead.updated', 'lead.graduated')
      AND a.created_at >= p_from AND a.created_at < p_to
      AND a.changes ? 'list'
  ),
  res AS (
    SELECT r.*,
      COALESCE(ti.id, tn.id, ts.id)                       AS to_id,
      COALESCE(ti.sort_order, tn.sort_order, ts.sort_order) AS to_sort,
      COALESCE(ti.slug, tn.slug, ts.slug)                 AS to_slug,
      COALESCE(ti.is_archive, tn.is_archive, ts.is_archive, false) AS to_archive,
      COALESCE(ti.excluded, tn.excluded, ts.excluded, false)       AS to_excluded,
      CASE WHEN ti.id IS NOT NULL THEN 'id' WHEN tn.id IS NOT NULL THEN 'name'
           WHEN ts.id IS NOT NULL THEN 'slug' ELSE 'unmatched' END AS to_via,
      COALESCE(fi.id, fn.id, fs.id)                       AS from_id,
      COALESCE(fi.sort_order, fn.sort_order, fs.sort_order) AS from_sort,
      COALESCE(fi.slug, fn.slug, fs.slug)                 AS from_slug,
      CASE WHEN fi.id IS NOT NULL THEN 'id' WHEN fn.id IS NOT NULL THEN 'name'
           WHEN fs.id IS NOT NULL THEN 'slug' ELSE 'unmatched' END AS from_via
    FROM raw r
    LEFT JOIN lists   ti ON ti.id = r.new_id
    LEFT JOIN by_name tn ON tn.n = r.new_key
    LEFT JOIN by_slug ts ON ts.s = r.new_key
    LEFT JOIN lists   fi ON fi.id = r.old_id
    LEFT JOIN by_name fn ON fn.n = r.old_key
    LEFT JOIN by_slug fs ON fs.s = r.old_key
  ),
  held AS (
    SELECT res.*,
      -- Holder IMMEDIATELY BEFORE the move = who delivered the lead to this stage (relay hand-offs re-assign the lead
      -- in the same event, so crediting the AFTER-holder would credit the next person in the relay):
      --   1. assigned_to.old, when the assignee changed in this very event (nobody held it -> the actor)
      --   2. otherwise the assignee did not change, so holder.new IS the holder before
      --   3. rows without holder: the latest PRIOR assigned_to audit change, then the current assignee (reported)
      CASE WHEN res.assign_changed THEN COALESCE(res.assigned_old, res.actor_id)
           WHEN res.holder_new IS NOT NULL THEN res.holder_new
           ELSE COALESCE(prior.u, l.assigned_to) END AS holder_id,
      CASE WHEN res.assign_changed AND res.assigned_old IS NOT NULL THEN 'assigned_to'
           WHEN res.assign_changed THEN 'actor'
           WHEN res.holder_new IS NOT NULL THEN 'holder'
           WHEN prior.u        IS NOT NULL THEN 'prior_audit'
           WHEN l.assigned_to  IS NOT NULL THEN 'current_fallback'
           ELSE 'none' END AS holder_source
    FROM res
    JOIN leads l ON l.id = res.lead_id AND l.tenant_id = p_tenant AND l.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT NULLIF(p.changes #>> '{assigned_to,new}', '')::UUID AS u
      FROM audit_logs p
      WHERE NOT res.assign_changed AND res.holder_new IS NULL
        AND p.entity_type = 'lead' AND p.entity_id = res.lead_id
        AND p.changes ? 'assigned_to' AND p.created_at < res.at
      ORDER BY p.created_at DESC LIMIT 1
    ) prior ON true
  ),
  -- Historical bulk heuristic: stage moves per (actor, p_bulk_seconds bucket). A narrow GROUP BY joined back — much
  -- cheaper than a window function over the wide rows (which sorted ~35k jsonb-carrying rows to disk at Admizz scale).
  bk AS (
    SELECT COALESCE(actor_id, '00000000-0000-0000-0000-000000000000'::UUID) AS actor_k,
           floor(extract(epoch FROM at) / GREATEST(p_bulk_seconds, 1)) AS b,
           count(*) AS c
    FROM held GROUP BY 1, 2
  )
  SELECT h.audit_id, h.lead_id, h.actor_id, h.at, h.old_label, h.new_label,
         CASE WHEN h.old_label ~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN 'slug' ELSE 'name' END,
         h.from_id, h.to_id, h.from_sort, h.to_sort, h.from_slug, h.to_slug, h.to_archive, h.to_excluded,
         h.from_via, h.to_via, h.holder_id, h.holder_source,
         (COALESCE(h.via = 'bulk', false) OR bk.c >= p_bulk_min)
  FROM held h
  JOIN bk ON bk.actor_k = COALESCE(h.actor_id, '00000000-0000-0000-0000-000000000000'::UUID)
         AND bk.b = floor(extract(epoch FROM h.at) / GREATEST(p_bulk_seconds, 1));
$$;

-- ── overview: scoreboard + funnel in ONE pass ───────────────────────────────
-- The stage moves are resolved once (MATERIALIZED) and shared by the people aggregates and the funnel. Every event
-- source is aggregated to (person, bucket) BEFORE anything is unioned, so nothing wide is ever sorted (an earlier
-- version unioned ~250k raw event rows and sorted them: 1.4s at Admizz scale).
CREATE OR REPLACE FUNCTION education_pulse_overview(
  p_tenant UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tz TEXT, p_branch UUID DEFAULT NULL,
  p_bulk_min INT DEFAULT 20, p_bulk_seconds INT DEFAULT 60
)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH w AS (SELECT (p_to - p_from) AS len, p_from - 4 * (p_to - p_from) AS span_from),
  mv AS MATERIALIZED (
    SELECT m.*, education_pulse_bucket(m.at, p_to, w.len) AS b
    FROM w, education_pulse_moves(p_tenant, w.span_from, p_to, p_bulk_min, p_bulk_seconds) m
  ),
  -- ── people ──
  moves_a AS (
    SELECT actor_id AS u, b, count(*) AS n FROM mv
    WHERE NOT is_bulk AND NOT to_excluded AND actor_id IS NOT NULL GROUP BY actor_id, b
  ),
  stage_a AS (
    SELECT u, b, jsonb_object_agg(sk, n) AS m
    FROM (SELECT actor_id AS u, b, COALESCE(to_list_id::TEXT, 'other') AS sk, count(*) AS n FROM mv
          WHERE NOT is_bulk AND NOT to_excluded AND actor_id IS NOT NULL
            AND NOT to_is_archive AND (from_sort IS NULL OR to_sort > from_sort)   -- FORWARD destinations only
          GROUP BY actor_id, b, 3) x
    GROUP BY u, b
  ),
  back_a AS (
    SELECT actor_id AS u, b, count(*) AS n FROM mv
    WHERE NOT is_bulk AND NOT to_excluded AND actor_id IS NOT NULL AND ((to_sort < from_sort) OR to_is_archive)
    GROUP BY actor_id, b
  ),
  -- Back / archived moves broken down by DESTINATION (an earlier stage, or the archive list) — the v4 scoreboard has
  -- one numeric column per destination stage, forward and back kept apart.
  back_stage_a AS (
    SELECT u, b, jsonb_object_agg(sk, n) AS m
    FROM (SELECT actor_id AS u, b, COALESCE(to_list_id::TEXT, 'other') AS sk, count(*) AS n FROM mv
          WHERE NOT is_bulk AND NOT to_excluded AND actor_id IS NOT NULL AND ((to_sort < from_sort) OR to_is_archive)
          GROUP BY actor_id, b, 3) x
    GROUP BY u, b
  ),
  bulk_a AS (SELECT actor_id AS u, b, count(*) AS n FROM mv WHERE is_bulk AND actor_id IS NOT NULL GROUP BY actor_id, b),
  pros_a AS (
    SELECT holder_id AS u, b, count(DISTINCT lead_id) AS n FROM mv
    WHERE to_slug = 'prospects' AND NOT to_excluded AND holder_id IS NOT NULL GROUP BY holder_id, b
  ),
  reach_a AS (
    SELECT holder_id AS u, b, count(DISTINCT lead_id) AS n FROM mv
    WHERE to_slug = 'applications' AND NOT to_excluded AND holder_id IS NOT NULL GROUP BY holder_id, b
  ),
  status_a AS (
    SELECT a.user_id AS u, education_pulse_bucket(a.created_at, p_to, w.len) AS b, count(*) AS n
    FROM audit_logs a, w
    WHERE a.tenant_id = p_tenant AND a.entity_type = 'lead' AND a.action IN ('lead.updated', 'lead.graduated')
      AND a.created_at >= w.span_from AND a.created_at < p_to AND a.user_id IS NOT NULL AND a.changes ? 'status'
      AND (a.changes #>> '{status,old}') IS DISTINCT FROM (a.changes #>> '{status,new}')
    GROUP BY 1, 2
  ),
  calls_a AS (
    SELECT la.user_id AS u, education_pulse_bucket(la.created_at, p_to, w.len) AS b, count(*) AS n
    FROM lead_activities la, w
    WHERE la.tenant_id = p_tenant AND la.activity_type = 'call' AND la.created_at >= w.span_from AND la.created_at < p_to
    GROUP BY 1, 2
  ),
  notes_new_a AS (
    SELECT n.user_id AS u, education_pulse_bucket(n.created_at, p_to, w.len) AS b, count(*) AS n
    FROM lead_notes n JOIN leads l ON l.id = n.lead_id AND l.tenant_id = p_tenant AND l.deleted_at IS NULL, w
    WHERE n.created_at >= w.span_from AND n.created_at < p_to AND n.ai_tool_call_id IS NULL GROUP BY 1, 2
  ),
  notes_ed_a AS (
    SELECT n.user_id AS u, education_pulse_bucket(n.edited_at, p_to, w.len) AS b, count(*) AS n
    FROM lead_notes n JOIN leads l ON l.id = n.lead_id AND l.tenant_id = p_tenant AND l.deleted_at IS NULL, w
    WHERE n.edited_at >= w.span_from AND n.edited_at < p_to AND n.edited_at > n.created_at + INTERVAL '1 minute'
      AND n.ai_tool_call_id IS NULL GROUP BY 1, 2
  ),
  recv_a AS (
    SELECT u, b, count(*) AS n FROM (
      SELECT DISTINCT u, b, lead_id FROM (
        SELECT NULLIF(a.changes #>> '{assigned_to,new}', '')::UUID AS u,
               education_pulse_bucket(a.created_at, p_to, w.len) AS b, a.entity_id AS lead_id
        FROM audit_logs a, w
        WHERE a.tenant_id = p_tenant AND a.entity_type = 'lead' AND a.action IN ('lead.updated', 'lead.graduated')
          AND a.created_at >= w.span_from AND a.created_at < p_to AND a.changes ? 'assigned_to'
          AND (a.changes #>> '{assigned_to,old}') IS DISTINCT FROM (a.changes #>> '{assigned_to,new}')
          AND NULLIF(a.changes #>> '{assigned_to,new}', '') IS NOT NULL
        UNION ALL
        SELECT CASE WHEN fr.has THEN fr.old_u ELSE l.assigned_to END,
               education_pulse_bucket(l.created_at, p_to, w.len), l.id
        FROM leads l, w
        LEFT JOIN LATERAL (
          SELECT true AS has, NULLIF(a.changes #>> '{assigned_to,old}', '')::UUID AS old_u
          FROM audit_logs a
          WHERE a.entity_type = 'lead' AND a.entity_id = l.id AND a.changes ? 'assigned_to' AND a.created_at >= l.created_at
          ORDER BY a.created_at LIMIT 1
        ) fr ON true
        WHERE l.tenant_id = p_tenant AND l.deleted_at IS NULL AND l.created_at >= w.span_from AND l.created_at < p_to
      ) src WHERE u IS NOT NULL
    ) d GROUP BY u, b
  ),
  apps_a AS (
    SELECT COALESCE(ap.assigned_to, l.assigned_to) AS u, education_pulse_bucket(ap.created_at, p_to, w.len) AS b, count(*) AS n
    FROM applications ap JOIN leads l ON l.id = ap.lead_id, w
    WHERE ap.tenant_id = p_tenant AND ap.deleted_at IS NULL AND ap.created_at >= w.span_from AND ap.created_at < p_to
    GROUP BY 1, 2
  ),
  agg AS (
    SELECT u, b, 'moves' AS k, n FROM moves_a
    UNION ALL SELECT u, b, 'bulk_moves', n FROM bulk_a
    UNION ALL SELECT u, b, 'back_archived', n FROM back_a
    UNION ALL SELECT u, b, 'prospects', n FROM pros_a
    UNION ALL SELECT u, b, 'reached_applications', n FROM reach_a
    UNION ALL SELECT u, b, 'status_changes', n FROM status_a
    UNION ALL SELECT u, b, 'calls', n FROM calls_a
    UNION ALL SELECT u, b, 'notes_new', n FROM notes_new_a
    UNION ALL SELECT u, b, 'notes_edited', n FROM notes_ed_a
    UNION ALL SELECT u, b, 'received', n FROM recv_a
    UNION ALL SELECT u, b, 'applications_filed', n FROM apps_a
  ),
  people AS (
    SELECT g.u, g.b,
           jsonb_build_object(
             'calls',                COALESCE(sum(g.n) FILTER (WHERE g.k = 'calls'), 0),
             'notes',                COALESCE(sum(g.n) FILTER (WHERE g.k IN ('notes_new', 'notes_edited')), 0),
             'moves',                COALESCE(sum(g.n) FILTER (WHERE g.k = 'moves'), 0),
             'back_archived',        COALESCE(sum(g.n) FILTER (WHERE g.k = 'back_archived'), 0),
             'status_changes',       COALESCE(sum(g.n) FILTER (WHERE g.k = 'status_changes'), 0),
             'received',             COALESCE(sum(g.n) FILTER (WHERE g.k = 'received'), 0),
             'prospects',            COALESCE(sum(g.n) FILTER (WHERE g.k = 'prospects'), 0),
             'reached_applications', COALESCE(sum(g.n) FILTER (WHERE g.k = 'reached_applications'), 0),
             'applications_filed',   COALESCE(sum(g.n) FILTER (WHERE g.k = 'applications_filed'), 0)) AS counts,
           COALESCE(sum(g.n) FILTER (WHERE g.k = 'notes_new'), 0)    AS notes_new,
           COALESCE(sum(g.n) FILTER (WHERE g.k = 'notes_edited'), 0) AS notes_edited,
           COALESCE(sum(g.n) FILTER (WHERE g.k = 'bulk_moves'), 0)   AS bulk_moves
    FROM agg g
    WHERE g.u IS NOT NULL
      AND (p_branch IS NULL OR EXISTS (
        SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = p_tenant AND tu.user_id = g.u AND tu.branch_id = p_branch))
    GROUP BY g.u, g.b
  ),
  people_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'user_id', p.u, 'bucket', p.b, 'counts', p.counts, 'notes_new', p.notes_new, 'notes_edited', p.notes_edited,
      'moves_by_stage', COALESCE(sa.m, '{}'::JSONB), 'back_by_stage', COALESCE(ba.m, '{}'::JSONB),
      'bulk_moves', p.bulk_moves)), '[]'::JSONB) AS j
    FROM people p
    LEFT JOIN stage_a sa ON sa.u = p.u AND sa.b = p.b
    LEFT JOIN back_stage_a ba ON ba.u = p.u AND ba.b = p.b
  ),
  -- ── funnel ──
  fmv AS (SELECT m.* FROM mv m JOIN leads l ON l.id = m.lead_id AND (p_branch IS NULL OR l.branch_id = p_branch)),
  lists AS (
    SELECT id, name, slug, sort_order, is_archive FROM lead_lists
    WHERE tenant_id = p_tenant AND NOT (is_staging OR slug = 'migration-qc' OR COALESCE(access->>'mode', 'all') <> 'all')
  ),
  buckets AS (SELECT generate_series(0, 4) AS b),
  ent AS (SELECT to_list_id AS id, b, count(DISTINCT lead_id) AS n FROM fmv GROUP BY to_list_id, b),
  flow AS (
    SELECT from_list_id AS id, b,
           count(DISTINCT lead_id) FILTER (WHERE to_sort > from_sort AND NOT to_is_archive) AS fwd,
           count(DISTINCT lead_id) FILTER (WHERE (to_sort < from_sort) OR to_is_archive)    AS outn
    FROM fmv WHERE from_list_id IS NOT NULL AND to_list_id IS NOT NULL GROUP BY from_list_id, b
  ),
  daily AS (
    SELECT to_list_id AS id, ((at AT TIME ZONE p_tz)::DATE)::TEXT AS d, count(DISTINCT lead_id) AS n
    FROM fmv WHERE b = 0 AND to_list_id IS NOT NULL GROUP BY to_list_id, ((at AT TIME ZONE p_tz)::DATE)
  ),
  -- "Was in stage N during the window" = held at the window's start + entered in the window. Leads currently in N
  -- that have NO stage move in the window were there all window; leads WITH a move are counted by the moves
  -- (a move out of N means it was in N; a move into N means it entered). The two sets are disjoint, and every lead
  -- that moved forward out of N is in the base, so forward / base can never exceed 100%.
  -- Distinct ids of leads that moved in the window, built ONCE and hash-anti-joined. (A correlated NOT EXISTS over the
  -- unindexed fmv CTE rescanned ~34k rows per lead: 46 s at Admizz scale.)
  moved_ids AS MATERIALIZED (SELECT DISTINCT lead_id FROM fmv WHERE b = 0),
  -- NOT IN (subquery) plans as a HASHED subplan (lead_id is never NULL); the planner's 1-row CTE estimate otherwise
  -- picks a nested-loop anti join. MATERIALIZED so the five per-stage lookups below read it once, not five times.
  cur_a AS MATERIALIZED (
    SELECT l.list_id AS id, count(*) AS n
    FROM leads l
    WHERE l.tenant_id = p_tenant AND l.deleted_at IS NULL AND l.list_id IS NOT NULL
      AND (p_branch IS NULL OR l.branch_id = p_branch)
      AND l.id NOT IN (SELECT lead_id FROM moved_ids)
    GROUP BY l.list_id
  ),
  touch_a AS MATERIALIZED (
    SELECT id, count(DISTINCT lead_id) AS n FROM (
      SELECT from_list_id AS id, lead_id FROM fmv WHERE b = 0 AND from_list_id IS NOT NULL
      UNION ALL
      SELECT to_list_id, lead_id FROM fmv WHERE b = 0 AND to_list_id IS NOT NULL
    ) t GROUP BY id
  ),
  stages AS (
    SELECT jsonb_agg(jsonb_build_object(
      'list_id', l.id, 'name', l.name, 'slug', l.slug, 'sort_order', l.sort_order, 'is_archive', l.is_archive,
      'base', COALESCE((SELECT n FROM cur_a WHERE cur_a.id = l.id), 0) + COALESCE((SELECT n FROM touch_a WHERE touch_a.id = l.id), 0),
      'entered', (SELECT jsonb_agg(COALESCE(e.n, 0) ORDER BY bk.b) FROM buckets bk LEFT JOIN ent  e ON e.id = l.id AND e.b = bk.b),
      'forward', (SELECT jsonb_agg(COALESCE(f.fwd, 0) ORDER BY bk.b) FROM buckets bk LEFT JOIN flow f ON f.id = l.id AND f.b = bk.b),
      'out',     (SELECT jsonb_agg(COALESCE(f.outn, 0) ORDER BY bk.b) FROM buckets bk LEFT JOIN flow f ON f.id = l.id AND f.b = bk.b),
      'daily',   COALESCE((SELECT jsonb_agg(jsonb_build_object('day', d.d, 'n', d.n) ORDER BY d.d) FROM daily d WHERE d.id = l.id), '[]'::JSONB)
    ) ORDER BY l.sort_order) AS j
    FROM lists l
  ),
  newleads AS (
    SELECT jsonb_agg(COALESCE(x.n, 0) ORDER BY bk.b) AS j, COALESCE(sum(x.imported), 0) AS imported
    FROM buckets bk
    LEFT JOIN (
      SELECT education_pulse_bucket(l.created_at, p_to, w.len) AS b,
             count(*) FILTER (WHERE NOT (l.custom_fields ? 'import_batch')) AS n,
             count(*) FILTER (WHERE l.custom_fields ? 'import_batch')       AS imported
      FROM leads l, w
      WHERE l.tenant_id = p_tenant AND l.deleted_at IS NULL AND l.created_at >= w.span_from AND l.created_at < p_to
        AND (p_branch IS NULL OR l.branch_id = p_branch)
      GROUP BY 1
    ) x ON x.b = bk.b
  ),
  newleads_daily AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('day', d, 'n', n) ORDER BY d), '[]'::JSONB) AS j
    FROM (
      SELECT ((l.created_at AT TIME ZONE p_tz)::DATE)::TEXT AS d, count(*) AS n
      FROM leads l
      WHERE l.tenant_id = p_tenant AND l.deleted_at IS NULL AND NOT (l.custom_fields ? 'import_batch')
        AND l.created_at >= p_from AND l.created_at < p_to AND (p_branch IS NULL OR l.branch_id = p_branch)
      GROUP BY 1
    ) s
  ),
  quality AS (
    SELECT jsonb_build_object(
      'total', count(*),
      'holder_source', jsonb_build_object(
        'holder',           count(*) FILTER (WHERE holder_source = 'holder'),
        'assigned_to',      count(*) FILTER (WHERE holder_source = 'assigned_to'),
        'actor',            count(*) FILTER (WHERE holder_source = 'actor'),
        'prior_audit',      count(*) FILTER (WHERE holder_source = 'prior_audit'),
        'current_fallback', count(*) FILTER (WHERE holder_source = 'current_fallback'),
        'none',             count(*) FILTER (WHERE holder_source = 'none')),
      'destination', jsonb_build_object(
        'id',        count(*) FILTER (WHERE to_via = 'id'),
        'name',      count(*) FILTER (WHERE to_via = 'name'),
        'slug',      count(*) FILTER (WHERE to_via = 'slug'),
        'unmatched', count(*) FILTER (WHERE to_via = 'unmatched')),
      'origin_slug_shaped', jsonb_build_object(
        'total',     count(*) FILTER (WHERE old_label IS NOT NULL AND label_shape = 'slug'),
        'unmatched', count(*) FILTER (WHERE old_label IS NOT NULL AND label_shape = 'slug' AND from_via = 'unmatched')),
      'origin_name_shaped', jsonb_build_object(
        'total',     count(*) FILTER (WHERE old_label IS NOT NULL AND label_shape = 'name'),
        'unmatched', count(*) FILTER (WHERE old_label IS NOT NULL AND label_shape = 'name' AND from_via = 'unmatched'))
    ) AS j
    FROM mv
  )
  SELECT jsonb_build_object(
    'people', (SELECT j FROM people_json),
    'funnel', jsonb_build_object(
      'stages',            COALESCE((SELECT j FROM stages), '[]'::JSONB),
      'new_leads',         (SELECT j FROM newleads),
      'new_leads_daily',   (SELECT j FROM newleads_daily),
      'imported_excluded', (SELECT imported FROM newleads),
      'quality',           (SELECT j FROM quality)));
$$;

-- Thin wrappers (stable signatures): one implementation, two views of it.
CREATE OR REPLACE FUNCTION education_pulse_person_stats(
  p_tenant UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_branch UUID DEFAULT NULL,
  p_bulk_min INT DEFAULT 20, p_bulk_seconds INT DEFAULT 60
)
RETURNS TABLE (
  user_id UUID, bucket INT, counts JSONB, notes_new BIGINT, notes_edited BIGINT, moves_by_stage JSONB,
  back_by_stage JSONB, bulk_moves BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (r ->> 'user_id')::UUID, (r ->> 'bucket')::INT, r -> 'counts', (r ->> 'notes_new')::BIGINT,
         (r ->> 'notes_edited')::BIGINT, r -> 'moves_by_stage', r -> 'back_by_stage', (r ->> 'bulk_moves')::BIGINT
  FROM jsonb_array_elements(
    education_pulse_overview(p_tenant, p_from, p_to, 'UTC', p_branch, p_bulk_min, p_bulk_seconds) -> 'people') r;
$$;

CREATE OR REPLACE FUNCTION education_pulse_funnel(
  p_tenant UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tz TEXT, p_branch UUID DEFAULT NULL,
  p_bulk_min INT DEFAULT 20, p_bulk_seconds INT DEFAULT 60
)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT education_pulse_overview(p_tenant, p_from, p_to, p_tz, p_branch, p_bulk_min, p_bulk_seconds) -> 'funnel';
$$;

-- ── evidence drawer ──────────────────────────────────────────────────────────
-- p_metric: calls | notes | moves | status_changes | received | prospects | reached_applications |
--           applications_filed | stage_out | new_leads | untouched
-- p_detail: notes -> 'new' | 'edited';  moves -> destination list id;  stage_out -> origin list id
-- p_user_id: the ACTOR for Did metrics (calls/notes/moves/status_changes), the HOLDER/owner for the rest.
-- Only the CURRENT window [p_from, p_to) is listed.
CREATE OR REPLACE FUNCTION education_pulse_events(
  p_tenant UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_metric TEXT, p_user_id UUID DEFAULT NULL,
  p_detail TEXT DEFAULT NULL, p_branch UUID DEFAULT NULL,
  p_limit INT DEFAULT 25, p_offset INT DEFAULT 0, p_bulk_min INT DEFAULT 20, p_bulk_seconds INT DEFAULT 60
)
RETURNS TABLE (
  lead_id     UUID,
  display_id  TEXT,
  lead_name   TEXT,
  at          TIMESTAMPTZ,
  actor_id    UUID,
  holder_id   UUID,
  from_label  TEXT,
  to_label    TEXT,
  detail      TEXT,
  total       BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH mv AS (
    SELECT * FROM education_pulse_moves(p_tenant, p_from, p_to, p_bulk_min, p_bulk_seconds)
  ),
  rows_ AS (
    -- moves (Did): non-bulk, not into excluded lists, optional destination
    SELECT m.lead_id, m.at, m.actor_id, m.holder_id, m.old_label AS from_label, m.new_label AS to_label,
           NULL::TEXT AS detail
    FROM mv m
    WHERE p_metric = 'moves' AND NOT m.is_bulk AND NOT m.to_excluded
      AND (p_user_id IS NULL OR m.actor_id = p_user_id)
      AND (p_detail IS NULL OR m.to_list_id::TEXT = p_detail OR (p_detail = 'other' AND m.to_list_id IS NULL))
    UNION ALL
    SELECT m.lead_id, m.at, m.actor_id, m.holder_id, m.old_label, m.new_label, NULL
    FROM mv m
    WHERE p_metric = 'moves_forward' AND NOT m.is_bulk AND NOT m.to_excluded AND NOT m.to_is_archive
      AND (m.from_sort IS NULL OR m.to_sort > m.from_sort)
      AND (p_user_id IS NULL OR m.actor_id = p_user_id)
      AND (p_detail IS NULL OR m.to_list_id::TEXT = p_detail OR (p_detail = 'other' AND m.to_list_id IS NULL))
    UNION ALL
    SELECT m.lead_id, m.at, m.actor_id, m.holder_id, m.old_label, m.new_label, NULL
    FROM mv m
    WHERE p_metric = 'back_archived' AND NOT m.is_bulk AND NOT m.to_excluded
      AND ((m.to_sort < m.from_sort) OR m.to_is_archive)
      AND (p_user_id IS NULL OR m.actor_id = p_user_id)
    UNION ALL
    SELECT m.lead_id, m.at, m.actor_id, m.holder_id, m.old_label, m.new_label, NULL
    FROM mv m
    WHERE p_metric = 'prospects' AND m.to_slug = 'prospects' AND NOT m.to_excluded
      AND (p_user_id IS NULL OR m.holder_id = p_user_id)
    UNION ALL
    SELECT m.lead_id, m.at, m.actor_id, m.holder_id, m.old_label, m.new_label, NULL
    FROM mv m
    WHERE p_metric = 'reached_applications' AND m.to_slug = 'applications' AND NOT m.to_excluded
      AND (p_user_id IS NULL OR m.holder_id = p_user_id)
    UNION ALL
    SELECT m.lead_id, m.at, m.actor_id, m.holder_id, m.old_label, m.new_label, NULL
    FROM mv m
    WHERE p_metric = 'stage_out' AND m.from_list_id::TEXT = p_detail
      AND (m.to_sort < m.from_sort OR m.to_is_archive)
    UNION ALL
    SELECT a.entity_id, a.created_at, a.user_id, NULL::UUID, a.changes #>> '{status,old}', a.changes #>> '{status,new}', NULL
    FROM audit_logs a
    WHERE p_metric = 'status_changes' AND a.tenant_id = p_tenant AND a.entity_type = 'lead'
      AND a.action IN ('lead.updated', 'lead.graduated') AND a.created_at >= p_from AND a.created_at < p_to
      AND a.changes ? 'status' AND (a.changes #>> '{status,old}') IS DISTINCT FROM (a.changes #>> '{status,new}')
      AND (p_user_id IS NULL OR a.user_id = p_user_id)
    UNION ALL
    SELECT la.lead_id, la.created_at, la.user_id, NULL, NULL, la.call_outcome::TEXT, la.subject
    FROM lead_activities la
    WHERE p_metric = 'calls' AND la.tenant_id = p_tenant AND la.activity_type = 'call'
      AND la.created_at >= p_from AND la.created_at < p_to AND (p_user_id IS NULL OR la.user_id = p_user_id)
    UNION ALL
    SELECT n.lead_id, n.created_at, n.user_id, NULL, NULL, NULL, 'new'
    FROM lead_notes n JOIN leads l ON l.id = n.lead_id AND l.tenant_id = p_tenant AND l.deleted_at IS NULL
    WHERE p_metric = 'notes' AND COALESCE(p_detail, 'new') = 'new' AND n.ai_tool_call_id IS NULL
      AND n.created_at >= p_from AND n.created_at < p_to AND (p_user_id IS NULL OR n.user_id = p_user_id)
    UNION ALL
    SELECT n.lead_id, n.edited_at, n.user_id, NULL, NULL, NULL, 'edited'
    FROM lead_notes n JOIN leads l ON l.id = n.lead_id AND l.tenant_id = p_tenant AND l.deleted_at IS NULL
    WHERE p_metric = 'notes' AND COALESCE(p_detail, 'edited') = 'edited' AND n.ai_tool_call_id IS NULL
      AND n.edited_at >= p_from AND n.edited_at < p_to AND n.edited_at > n.created_at + INTERVAL '1 minute'
      AND (p_user_id IS NULL OR n.user_id = p_user_id)
    UNION ALL
    SELECT a.entity_id, a.created_at, a.user_id, NULLIF(a.changes #>> '{assigned_to,new}', '')::UUID,
           a.changes #>> '{assigned_to,old}', a.changes #>> '{assigned_to,new}', 'assigned'
    FROM audit_logs a
    WHERE p_metric = 'received' AND a.tenant_id = p_tenant AND a.entity_type = 'lead'
      AND a.action IN ('lead.updated', 'lead.graduated') AND a.created_at >= p_from AND a.created_at < p_to
      AND a.changes ? 'assigned_to'
      AND (a.changes #>> '{assigned_to,old}') IS DISTINCT FROM (a.changes #>> '{assigned_to,new}')
      AND NULLIF(a.changes #>> '{assigned_to,new}', '') IS NOT NULL
      AND (p_user_id IS NULL OR NULLIF(a.changes #>> '{assigned_to,new}', '')::UUID = p_user_id)
    UNION ALL
    SELECT l.id, l.created_at, NULL, CASE WHEN fr.has THEN fr.old_u ELSE l.assigned_to END, NULL, NULL, 'created'
    FROM leads l
    LEFT JOIN LATERAL (
      SELECT true AS has, NULLIF(a.changes #>> '{assigned_to,old}', '')::UUID AS old_u
      FROM audit_logs a
      WHERE a.entity_type = 'lead' AND a.entity_id = l.id AND a.changes ? 'assigned_to' AND a.created_at >= l.created_at
      ORDER BY a.created_at LIMIT 1
    ) fr ON true
    WHERE p_metric = 'received' AND l.tenant_id = p_tenant AND l.deleted_at IS NULL
      AND l.created_at >= p_from AND l.created_at < p_to
      AND (p_user_id IS NULL OR (CASE WHEN fr.has THEN fr.old_u ELSE l.assigned_to END) = p_user_id)
    UNION ALL
    SELECT ap.lead_id, ap.created_at, ap.created_by, COALESCE(ap.assigned_to, l.assigned_to), NULL, NULL,
           ap.university_name
    FROM applications ap JOIN leads l ON l.id = ap.lead_id
    WHERE p_metric = 'applications_filed' AND ap.tenant_id = p_tenant AND ap.deleted_at IS NULL
      AND ap.created_at >= p_from AND ap.created_at < p_to
      AND (p_user_id IS NULL OR COALESCE(ap.assigned_to, l.assigned_to) = p_user_id)
    UNION ALL
    SELECT l.id, l.created_at, NULL, l.assigned_to, NULL, NULL, NULL
    FROM leads l
    WHERE p_metric = 'new_leads' AND l.tenant_id = p_tenant AND l.deleted_at IS NULL
      AND NOT (l.custom_fields ? 'import_batch') AND l.created_at >= p_from AND l.created_at < p_to
    UNION ALL
    -- untouched: same predicate as education_intake_alarm, older than 48h at p_to
    SELECT l.id, l.created_at, NULL, l.assigned_to, NULL, NULL, NULL
    FROM leads l JOIN lead_lists ll ON ll.id = l.list_id AND ll.is_intake = true
    WHERE p_metric = 'untouched' AND l.tenant_id = p_tenant AND l.deleted_at IS NULL
      AND l.created_at < p_to - INTERVAL '48 hours'
      AND NOT EXISTS (SELECT 1 FROM lead_activities la WHERE la.lead_id = l.id AND la.activity_type IN ('call', 'email', 'meeting'))
      AND NOT EXISTS (SELECT 1 FROM lead_notes ln WHERE ln.lead_id = l.id)
  ),
  -- The scoreboard counts these once per (lead, person); list them once too, so a number always equals its list.
  deduped AS (
    (SELECT DISTINCT ON (lead_id, holder_id) * FROM rows_
      WHERE p_metric IN ('received', 'prospects', 'reached_applications')
      ORDER BY lead_id, holder_id, at)
    UNION ALL
    SELECT * FROM rows_ WHERE p_metric NOT IN ('received', 'prospects', 'reached_applications')
  )
  SELECT r.lead_id, l.display_id::TEXT, btrim(COALESCE(l.first_name, '') || ' ' || COALESCE(l.last_name, '')),
         r.at, r.actor_id, r.holder_id, r.from_label, r.to_label, r.detail,
         count(*) OVER () AS total
  FROM deduped r
  JOIN leads l ON l.id = r.lead_id AND l.tenant_id = p_tenant AND (p_branch IS NULL OR l.branch_id = p_branch)
  ORDER BY r.at DESC, r.lead_id
  LIMIT GREATEST(p_limit, 1) OFFSET GREATEST(p_offset, 0);
$$;

-- ── person drawer: daily series + timeline ──────────────────────────────────
-- Daily Did-activity (calls + new/edited notes + non-bulk stage moves) for ONE person, in the tenant timezone.
CREATE OR REPLACE FUNCTION education_pulse_person_daily(
  p_tenant UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tz TEXT, p_user_id UUID,
  p_bulk_min INT DEFAULT 20, p_bulk_seconds INT DEFAULT 60
)
RETURNS TABLE (day TEXT, calls BIGINT, notes BIGINT, moves BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ev AS (
    SELECT ((la.created_at AT TIME ZONE p_tz)::DATE) AS d, 'calls' AS k
    FROM lead_activities la
    WHERE la.tenant_id = p_tenant AND la.activity_type = 'call' AND la.user_id = p_user_id
      AND la.created_at >= p_from AND la.created_at < p_to
    UNION ALL
    SELECT ((n.created_at AT TIME ZONE p_tz)::DATE), 'notes'
    FROM lead_notes n JOIN leads l ON l.id = n.lead_id AND l.tenant_id = p_tenant AND l.deleted_at IS NULL
    WHERE n.user_id = p_user_id AND n.ai_tool_call_id IS NULL AND n.created_at >= p_from AND n.created_at < p_to
    UNION ALL
    SELECT ((n.edited_at AT TIME ZONE p_tz)::DATE), 'notes'
    FROM lead_notes n JOIN leads l ON l.id = n.lead_id AND l.tenant_id = p_tenant AND l.deleted_at IS NULL
    WHERE n.user_id = p_user_id AND n.ai_tool_call_id IS NULL AND n.edited_at >= p_from AND n.edited_at < p_to
      AND n.edited_at > n.created_at + INTERVAL '1 minute'
    UNION ALL
    SELECT ((m.at AT TIME ZONE p_tz)::DATE), 'moves'
    FROM education_pulse_moves(p_tenant, p_from, p_to, p_bulk_min, p_bulk_seconds) m
    WHERE m.actor_id = p_user_id AND NOT m.is_bulk AND NOT m.to_excluded
  ),
  days AS (
    SELECT generate_series((p_from AT TIME ZONE p_tz)::DATE, ((p_to - INTERVAL '1 microsecond') AT TIME ZONE p_tz)::DATE, INTERVAL '1 day')::DATE AS d
  )
  SELECT days.d::TEXT,
         count(*) FILTER (WHERE ev.k = 'calls'),
         count(*) FILTER (WHERE ev.k = 'notes'),
         count(*) FILTER (WHERE ev.k = 'moves')
  FROM days LEFT JOIN ev ON ev.d = days.d
  GROUP BY days.d ORDER BY days.d;
$$;

-- "What they did": the person's own recent actions, newest first.
CREATE OR REPLACE FUNCTION education_pulse_person_timeline(
  p_tenant UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_user_id UUID, p_limit INT DEFAULT 30,
  p_bulk_min INT DEFAULT 20, p_bulk_seconds INT DEFAULT 60
)
RETURNS TABLE (at TIMESTAMPTZ, kind TEXT, lead_id UUID, display_id TEXT, lead_name TEXT, detail TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH rows_ AS (
    SELECT la.created_at AS at, 'call' AS kind, la.lead_id, la.call_outcome::TEXT AS detail
    FROM lead_activities la
    WHERE la.tenant_id = p_tenant AND la.activity_type = 'call' AND la.user_id = p_user_id
      AND la.created_at >= p_from AND la.created_at < p_to
    UNION ALL
    SELECT n.created_at, 'note', n.lead_id, NULL
    FROM lead_notes n JOIN leads l ON l.id = n.lead_id AND l.tenant_id = p_tenant AND l.deleted_at IS NULL
    WHERE n.user_id = p_user_id AND n.ai_tool_call_id IS NULL AND n.created_at >= p_from AND n.created_at < p_to
    UNION ALL
    SELECT m.at, CASE WHEN m.is_bulk THEN 'bulk_move' ELSE 'move' END, m.lead_id,
           COALESCE(m.old_label, '—') || ' → ' || COALESCE(m.new_label, '—')
    FROM education_pulse_moves(p_tenant, p_from, p_to, p_bulk_min, p_bulk_seconds) m
    WHERE m.actor_id = p_user_id
    UNION ALL
    SELECT a.created_at, 'status', a.entity_id, (a.changes #>> '{status,old}') || ' → ' || (a.changes #>> '{status,new}')
    FROM audit_logs a
    WHERE a.tenant_id = p_tenant AND a.entity_type = 'lead' AND a.action IN ('lead.updated', 'lead.graduated')
      AND a.user_id = p_user_id AND a.created_at >= p_from AND a.created_at < p_to AND a.changes ? 'status'
      AND (a.changes #>> '{status,old}') IS DISTINCT FROM (a.changes #>> '{status,new}')
  )
  SELECT r.at, r.kind, r.lead_id, l.display_id::TEXT, btrim(COALESCE(l.first_name, '') || ' ' || COALESCE(l.last_name, '')), r.detail
  FROM rows_ r JOIN leads l ON l.id = r.lead_id AND l.tenant_id = p_tenant
  ORDER BY r.at DESC LIMIT GREATEST(p_limit, 1);
$$;

REVOKE ALL ON FUNCTION education_pulse_person_daily(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION education_pulse_person_timeline(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, INT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION education_pulse_moves(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION education_pulse_overview(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION education_pulse_person_stats(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION education_pulse_funnel(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION education_pulse_events(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, TEXT, UUID, INT, INT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION education_pulse_moves(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION education_pulse_overview(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION education_pulse_person_stats(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION education_pulse_funnel(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION education_pulse_person_daily(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION education_pulse_person_timeline(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, INT, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION education_pulse_events(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, TEXT, UUID, INT, INT, INT, INT) TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('280_education_pulse.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
