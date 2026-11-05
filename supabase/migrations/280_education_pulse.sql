-- Migration 280: Pulse (EDGEX-82) — per-person team activity report for education_consultancy.
--
-- Slice 1: numbers + rule-based signals, NO LLM. Four read-only SECURITY DEFINER RPCs modelled on
-- education_relay_aggregates (mig 241): LANGUAGE sql STABLE, SET search_path = public, EXECUTE granted to
-- service_role only (the API always goes through authenticateRequest + scopedClient -> db.raw().rpc()).
--
--   education_pulse_moves(...)         resolved stage moves (shared building block of the three below)
--   education_pulse_person_stats(...)  one row per (user, window-bucket): every scoreboard column
--   education_pulse_funnel(...)        stage flow per bucket + daily series + new leads in + data-quality stats
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
--   Prospects / Reached Applications (Owns)  moves into those lists, attributed to the HOLDER, once per lead.
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
  raw AS (
    SELECT a.id AS audit_id, a.entity_id AS lead_id, a.user_id AS actor_id, a.created_at AS at,
           a.changes #>> '{list,old}' AS old_label,
           a.changes #>> '{list,new}' AS new_label,
           NULLIF(a.changes #>> '{list_ids,old}', '')::UUID AS old_id,
           NULLIF(a.changes #>> '{list_ids,new}', '')::UUID AS new_id,
           NULLIF(a.changes #>> '{holder,new}', '')::UUID AS holder_new,
           NULLIF(a.changes #>> '{assigned_to,new}', '')::UUID AS assigned_new,
           a.changes #>> '{via,new}' AS via
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
    LEFT JOIN by_name tn ON tn.n = lower(btrim(r.new_label))
    LEFT JOIN by_slug ts ON ts.s = lower(btrim(r.new_label))
    LEFT JOIN lists   fi ON fi.id = r.old_id
    LEFT JOIN by_name fn ON fn.n = lower(btrim(r.old_label))
    LEFT JOIN by_slug fs ON fs.s = lower(btrim(r.old_label))
  ),
  held AS (
    SELECT res.*,
      COALESCE(res.holder_new, res.assigned_new, prior.u, l.assigned_to) AS holder_id,
      CASE WHEN res.holder_new   IS NOT NULL THEN 'holder'
           WHEN res.assigned_new IS NOT NULL THEN 'assigned_to'
           WHEN prior.u          IS NOT NULL THEN 'prior_audit'
           WHEN l.assigned_to    IS NOT NULL THEN 'current_fallback'
           ELSE 'none' END AS holder_source
    FROM res
    JOIN leads l ON l.id = res.lead_id AND l.tenant_id = p_tenant AND l.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT NULLIF(p.changes #>> '{assigned_to,new}', '')::UUID AS u
      FROM audit_logs p
      WHERE res.holder_new IS NULL AND res.assigned_new IS NULL
        AND p.entity_type = 'lead' AND p.entity_id = res.lead_id
        AND p.changes ? 'assigned_to' AND p.created_at < res.at
      ORDER BY p.created_at DESC LIMIT 1
    ) prior ON true
  )
  SELECT h.audit_id, h.lead_id, h.actor_id, h.at, h.old_label, h.new_label,
         CASE WHEN h.old_label ~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN 'slug' ELSE 'name' END,
         h.from_id, h.to_id, h.from_sort, h.to_sort, h.from_slug, h.to_slug, h.to_archive, h.to_excluded,
         h.from_via, h.to_via, h.holder_id, h.holder_source,
         (COALESCE(h.via = 'bulk', false)
          OR count(*) OVER (PARTITION BY h.actor_id, floor(extract(epoch FROM h.at) / GREATEST(p_bulk_seconds, 1))) >= p_bulk_min)
  FROM held h;
$$;

-- ── scoreboard ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION education_pulse_person_stats(
  p_tenant UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_branch UUID DEFAULT NULL,
  p_bulk_min INT DEFAULT 20, p_bulk_seconds INT DEFAULT 60
)
RETURNS TABLE (
  user_id        UUID,
  bucket         INT,
  counts         JSONB,
  notes_new      BIGINT,
  notes_edited   BIGINT,
  moves_by_stage JSONB,
  bulk_moves     BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH w AS (SELECT (p_to - p_from) AS len, p_from - 4 * (p_to - p_from) AS span_from),
  mv AS (
    SELECT m.* FROM w, education_pulse_moves(p_tenant, w.span_from, p_to, p_bulk_min, p_bulk_seconds) m
  ),
  ev AS (
    -- Did: stage moves (not bulk, not into an excluded list), by actor
    SELECT mv.actor_id AS u, education_pulse_bucket(mv.at, p_to, w.len) AS b, 'moves' AS k,
           mv.lead_id, COALESCE(mv.to_list_id::TEXT, 'other') AS sk
    FROM mv, w WHERE NOT mv.is_bulk AND NOT mv.to_excluded AND mv.actor_id IS NOT NULL
    UNION ALL
    SELECT mv.actor_id, education_pulse_bucket(mv.at, p_to, w.len), 'bulk_moves', mv.lead_id, NULL
    FROM mv, w WHERE mv.is_bulk AND mv.actor_id IS NOT NULL
    UNION ALL
    -- Owns: moves into Prospects / Applications, by holder (bulk included — it is about the lead's journey)
    SELECT mv.holder_id, education_pulse_bucket(mv.at, p_to, w.len), 'prospects', mv.lead_id, NULL
    FROM mv, w WHERE mv.to_slug = 'prospects' AND NOT mv.to_excluded AND mv.holder_id IS NOT NULL
    UNION ALL
    SELECT mv.holder_id, education_pulse_bucket(mv.at, p_to, w.len), 'reached_applications', mv.lead_id, NULL
    FROM mv, w WHERE mv.to_slug = 'applications' AND NOT mv.to_excluded AND mv.holder_id IS NOT NULL
    UNION ALL
    -- Did: status changes
    SELECT a.user_id, education_pulse_bucket(a.created_at, p_to, w.len), 'status_changes', a.entity_id, NULL
    FROM audit_logs a, w
    WHERE a.tenant_id = p_tenant AND a.entity_type = 'lead' AND a.action IN ('lead.updated', 'lead.graduated')
      AND a.created_at >= w.span_from AND a.created_at < p_to AND a.user_id IS NOT NULL
      AND a.changes ? 'status'
      AND (a.changes #>> '{status,old}') IS DISTINCT FROM (a.changes #>> '{status,new}')
    UNION ALL
    -- Did: calls
    SELECT la.user_id, education_pulse_bucket(la.created_at, p_to, w.len), 'calls', la.lead_id, NULL
    FROM lead_activities la, w
    WHERE la.tenant_id = p_tenant AND la.activity_type = 'call'
      AND la.created_at >= w.span_from AND la.created_at < p_to
    UNION ALL
    -- Did: notes (new)
    SELECT n.user_id, education_pulse_bucket(n.created_at, p_to, w.len), 'notes_new', n.lead_id, NULL
    FROM lead_notes n JOIN leads l ON l.id = n.lead_id AND l.tenant_id = p_tenant AND l.deleted_at IS NULL, w
    WHERE n.created_at >= w.span_from AND n.created_at < p_to AND n.ai_tool_call_id IS NULL
    UNION ALL
    -- Did: notes (edited in window)
    SELECT n.user_id, education_pulse_bucket(n.edited_at, p_to, w.len), 'notes_edited', n.lead_id, NULL
    FROM lead_notes n JOIN leads l ON l.id = n.lead_id AND l.tenant_id = p_tenant AND l.deleted_at IS NULL, w
    WHERE n.edited_at >= w.span_from AND n.edited_at < p_to AND n.edited_at > n.created_at + INTERVAL '1 minute'
      AND n.ai_tool_call_id IS NULL
    UNION ALL
    -- Received (a): became the assignee via an audited change
    SELECT NULLIF(a.changes #>> '{assigned_to,new}', '')::UUID, education_pulse_bucket(a.created_at, p_to, w.len),
           'received', a.entity_id, NULL
    FROM audit_logs a, w
    WHERE a.tenant_id = p_tenant AND a.entity_type = 'lead' AND a.action IN ('lead.updated', 'lead.graduated')
      AND a.created_at >= w.span_from AND a.created_at < p_to
      AND a.changes ? 'assigned_to'
      AND (a.changes #>> '{assigned_to,old}') IS DISTINCT FROM (a.changes #>> '{assigned_to,new}')
      AND NULLIF(a.changes #>> '{assigned_to,new}', '') IS NOT NULL
    UNION ALL
    -- Received (b): created in the window, held by the person at creation (initial assignment is not audited)
    SELECT CASE WHEN fr.has THEN fr.old_u ELSE l.assigned_to END,
           education_pulse_bucket(l.created_at, p_to, w.len), 'received', l.id, NULL
    FROM leads l, w
    LEFT JOIN LATERAL (
      SELECT true AS has, NULLIF(a.changes #>> '{assigned_to,old}', '')::UUID AS old_u
      FROM audit_logs a
      WHERE a.entity_type = 'lead' AND a.entity_id = l.id AND a.changes ? 'assigned_to' AND a.created_at >= l.created_at
      ORDER BY a.created_at LIMIT 1
    ) fr ON true
    WHERE l.tenant_id = p_tenant AND l.deleted_at IS NULL AND l.created_at >= w.span_from AND l.created_at < p_to
    UNION ALL
    -- Owns: applications filed
    SELECT COALESCE(ap.assigned_to, l.assigned_to), education_pulse_bucket(ap.created_at, p_to, w.len),
           'applications_filed', ap.lead_id, NULL
    FROM applications ap JOIN leads l ON l.id = ap.lead_id, w
    WHERE ap.tenant_id = p_tenant AND ap.deleted_at IS NULL
      AND ap.created_at >= w.span_from AND ap.created_at < p_to
  ),
  stage_counts AS (
    SELECT u, b, jsonb_object_agg(sk, n) AS m
    FROM (SELECT u, b, sk, count(*) AS n FROM ev WHERE k = 'moves' GROUP BY u, b, sk) s
    GROUP BY u, b
  )
  SELECT ev.u, ev.b,
         jsonb_build_object(
           'calls',                count(*)                FILTER (WHERE ev.k = 'calls'),
           'notes',                count(*)                FILTER (WHERE ev.k IN ('notes_new', 'notes_edited')),
           'moves',                count(*)                FILTER (WHERE ev.k = 'moves'),
           'status_changes',       count(*)                FILTER (WHERE ev.k = 'status_changes'),
           'received',             count(DISTINCT ev.lead_id) FILTER (WHERE ev.k = 'received'),
           'prospects',            count(DISTINCT ev.lead_id) FILTER (WHERE ev.k = 'prospects'),
           'reached_applications', count(DISTINCT ev.lead_id) FILTER (WHERE ev.k = 'reached_applications'),
           'applications_filed',   count(*)                FILTER (WHERE ev.k = 'applications_filed')
         ),
         count(*) FILTER (WHERE ev.k = 'notes_new'),
         count(*) FILTER (WHERE ev.k = 'notes_edited'),
         COALESCE(sc.m, '{}'::JSONB),
         count(*) FILTER (WHERE ev.k = 'bulk_moves')
  FROM ev
  LEFT JOIN stage_counts sc ON sc.u = ev.u AND sc.b = ev.b
  WHERE ev.u IS NOT NULL
    AND (p_branch IS NULL OR EXISTS (
      SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = p_tenant AND tu.user_id = ev.u AND tu.branch_id = p_branch))
  GROUP BY ev.u, ev.b, sc.m;
$$;

-- ── funnel ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION education_pulse_funnel(
  p_tenant UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tz TEXT, p_branch UUID DEFAULT NULL,
  p_bulk_min INT DEFAULT 20, p_bulk_seconds INT DEFAULT 60
)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH w AS (SELECT (p_to - p_from) AS len, p_from - 4 * (p_to - p_from) AS span_from),
  allmv AS (
    SELECT m.* FROM w, education_pulse_moves(p_tenant, w.span_from, p_to, p_bulk_min, p_bulk_seconds) m
  ),
  mv AS (
    SELECT m.*, education_pulse_bucket(m.at, p_to, w.len) AS b
    FROM allmv m JOIN leads l ON l.id = m.lead_id AND (p_branch IS NULL OR l.branch_id = p_branch), w
  ),
  lists AS (
    SELECT id, name, slug, sort_order, is_archive FROM lead_lists
    WHERE tenant_id = p_tenant AND NOT (is_staging OR slug = 'migration-qc' OR COALESCE(access->>'mode', 'all') <> 'all')
  ),
  buckets AS (SELECT generate_series(0, 4) AS b),
  ent AS (SELECT to_list_id AS id, b, count(DISTINCT lead_id) AS n FROM mv GROUP BY to_list_id, b),
  flow AS (
    SELECT from_list_id AS id, b,
           count(DISTINCT lead_id) FILTER (WHERE to_sort > from_sort AND NOT to_is_archive) AS fwd,
           count(DISTINCT lead_id) FILTER (WHERE (to_sort < from_sort) OR to_is_archive)    AS outn
    FROM mv WHERE from_list_id IS NOT NULL AND to_list_id IS NOT NULL GROUP BY from_list_id, b
  ),
  daily AS (
    SELECT to_list_id AS id, ((at AT TIME ZONE p_tz)::DATE)::TEXT AS d, count(DISTINCT lead_id) AS n
    FROM mv WHERE b = 0 AND to_list_id IS NOT NULL GROUP BY to_list_id, ((at AT TIME ZONE p_tz)::DATE)
  ),
  stages AS (
    SELECT jsonb_agg(jsonb_build_object(
      'list_id', l.id, 'name', l.name, 'slug', l.slug, 'sort_order', l.sort_order, 'is_archive', l.is_archive,
      'entered', (SELECT jsonb_agg(COALESCE(e.n, 0) ORDER BY bk.b) FROM buckets bk LEFT JOIN ent  e ON e.id = l.id AND e.b = bk.b),
      'forward', (SELECT jsonb_agg(COALESCE(f.fwd, 0) ORDER BY bk.b) FROM buckets bk LEFT JOIN flow f ON f.id = l.id AND f.b = bk.b),
      'out',     (SELECT jsonb_agg(COALESCE(f.outn, 0) ORDER BY bk.b) FROM buckets bk LEFT JOIN flow f ON f.id = l.id AND f.b = bk.b),
      'daily',   COALESCE((SELECT jsonb_agg(jsonb_build_object('day', d.d, 'n', d.n) ORDER BY d.d) FROM daily d WHERE d.id = l.id), '[]'::JSONB)
    ) ORDER BY l.sort_order) AS j
    FROM lists l
  ),
  newleads AS (
    SELECT jsonb_agg(COALESCE(x.n, 0) ORDER BY bk.b) AS j,
           COALESCE(sum(x.imported), 0) AS imported
    FROM buckets bk
    LEFT JOIN (
      SELECT education_pulse_bucket(l.created_at, p_to, w.len) AS b,
             count(*) FILTER (WHERE NOT (l.custom_fields ? 'import_batch')) AS n,
             count(*) FILTER (WHERE l.custom_fields ? 'import_batch')       AS imported
      FROM leads l, w
      WHERE l.tenant_id = p_tenant AND l.deleted_at IS NULL
        AND l.created_at >= w.span_from AND l.created_at < p_to
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
    FROM allmv
  )
  SELECT jsonb_build_object(
    'stages',           COALESCE((SELECT j FROM stages), '[]'::JSONB),
    'new_leads',        (SELECT j FROM newleads),
    'new_leads_daily',  (SELECT j FROM newleads_daily),
    'imported_excluded', (SELECT imported FROM newleads),
    'quality',          (SELECT j FROM quality)
  );
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
  )
  SELECT r.lead_id, l.display_id::TEXT, btrim(COALESCE(l.first_name, '') || ' ' || COALESCE(l.last_name, '')),
         r.at, r.actor_id, r.holder_id, r.from_label, r.to_label, r.detail,
         count(*) OVER () AS total
  FROM rows_ r
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
REVOKE ALL ON FUNCTION education_pulse_person_stats(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION education_pulse_funnel(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION education_pulse_events(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, TEXT, UUID, INT, INT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION education_pulse_moves(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION education_pulse_person_stats(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION education_pulse_funnel(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION education_pulse_person_daily(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION education_pulse_person_timeline(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, INT, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION education_pulse_events(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, TEXT, UUID, INT, INT, INT, INT) TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('280_education_pulse.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
