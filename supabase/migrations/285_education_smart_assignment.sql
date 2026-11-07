-- Migration 285: EDGEX-87 A3 — smart lead assignment (rule-based, explainable, learns from results). NOT an LLM.
-- ROLLBACK: DROP FUNCTION IF EXISTS public.education_assignment_stats_refresh(UUID, INT, INT);
--           DROP TABLE IF EXISTS public.lead_assignment_stats; DROP TABLE IF EXISTS public.lead_assignment_decisions;
--           DROP TABLE IF EXISTS public.lead_assignment_settings;
--           (and delete this file's row from schema_migrations)
--
-- 1. lead_assignment_settings: per tenant, mode off (default) | shadow | auto, and which positions take first contact on new
--    leads (position SLUGS). NULL until the owner confirms/changes it; until then the set is LEARNED (the positions of active members
--    who received most new leads in the last 60 days, covering >= 80%). Owner / admin edit it; the server writes it.
-- 2. lead_assignment_decisions: every pick, stored: mode, all candidates with each factor's value and score, the pick (NULL when nobody could take
--    it), the why-line, how the lead's branch was treated, the lead's prior branch (for Undo), and the human outcome (matched / overridden / undone). One decision per
--    lead (UNIQUE) so the Inngest function is idempotent.
-- 3. lead_assignment_stats: the nightly refresh's results, one row per person per destination ('*' = overall), read by the scorer:
--      received / progressed   leads the person holds that reached THEM in the last p_days (default 120, by
--                              coalesce(assigned_at, created_at)), and how many are now at "Qualified" or beyond (the lead
--                              list whose slug is 'qualified' and every list after it by sort_order, archive lists excluded)
--      speed_n / median_first_contact_min   for leads received in the last p_speed_days (default 30): minutes from
--                              coalesce(assigned_at, created_at) to the first CONTACT = a lead_activities row OR a human
--                              lead_notes row (ai_tool_call_id IS NULL). Same definition as home/lib/contact.ts and migration 284.
--      flag_7d                 Pulse's 7-day red / amber / green flag, written by the nightly job (not by this function).
--    Attribution is to the CURRENT holder (assigned_to), and only CURRENT tenant members get rows; leads held by people who
--    left (no tenant_users row) are ignored. Leads reassigned away count for their current holder. That is an
--    approximation: there is no per-holder history of progress.
--    Sparse tenants: rows carry raw counts only. Smoothing toward the team rate and minimum sample sizes are applied by the
--    scorer (home/lib/assignment/weights.ts), so a person with 3 leads never looks like a 100% closer.
--
-- Additive only. Before/after counts: 3 new tables (0 rows), 1 new function, no existing row touched.
--   Applied: stage <date> / prod HELD.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lead_assignment_settings (
  tenant_id            UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  mode                 TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'shadow', 'auto')),
  first_touch_positions TEXT[], -- NULL = never saved: the positions are LEARNED from who received new leads in the last 60 days (home/lib/assignment/learn-positions.ts)
  updated_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.lead_assignment_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lead_assignment_settings_select" ON public.lead_assignment_settings;
CREATE POLICY "lead_assignment_settings_select" ON public.lead_assignment_settings
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
DROP POLICY IF EXISTS "lead_assignment_settings_service_all" ON public.lead_assignment_settings;
CREATE POLICY "lead_assignment_settings_service_all" ON public.lead_assignment_settings
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.lead_assignment_decisions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id          UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  mode             TEXT NOT NULL CHECK (mode IN ('shadow', 'auto')),
  picked_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  candidates       JSONB NOT NULL DEFAULT '[]'::JSONB,
  why              TEXT,
  fallback         BOOLEAN NOT NULL DEFAULT false, -- legacy, always false: nobody passing the filters now means NO pick (picked_user_id NULL), never a fallback
  branch_basis     TEXT CHECK (branch_basis IN ('none', 'staffed', 'unstaffed')), -- 'unstaffed' = the lead's branch had no active pool member, so it filtered no one
  prior_branch_id  UUID REFERENCES public.branches(id) ON DELETE SET NULL, -- the lead's branch before smart assignment moved it; Undo restores it
  applied          BOOLEAN NOT NULL DEFAULT false,
  outcome          TEXT CHECK (outcome IN ('matched', 'overridden', 'undone')),
  outcome_at       TIMESTAMPTZ,
  outcome_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  acted_as_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- auto mode: the tenant owner the write ran as (earliest-created active owner)
  final_user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lead_assignment_decisions_one_per_lead UNIQUE (tenant_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_assignment_decisions_tenant_created ON public.lead_assignment_decisions (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_assignment_decisions_open ON public.lead_assignment_decisions (tenant_id, lead_id) WHERE outcome IS NULL;

ALTER TABLE public.lead_assignment_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lead_assignment_decisions_service_all" ON public.lead_assignment_decisions;
CREATE POLICY "lead_assignment_decisions_service_all" ON public.lead_assignment_decisions
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.lead_assignment_stats (
  tenant_id                UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  destination              TEXT NOT NULL,
  received                 INT NOT NULL DEFAULT 0,
  progressed               INT NOT NULL DEFAULT 0,
  speed_n                  INT NOT NULL DEFAULT 0,
  median_first_contact_min NUMERIC,
  flag_7d                  TEXT CHECK (flag_7d IN ('red', 'amber', 'green')),
  computed_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, destination)
);

ALTER TABLE public.lead_assignment_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lead_assignment_stats_service_all" ON public.lead_assignment_stats;
CREATE POLICY "lead_assignment_stats_service_all" ON public.lead_assignment_stats
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Nightly refresh of the counts above for ONE tenant. Keeps each row's flag_7d (written separately by the job).
CREATE OR REPLACE FUNCTION public.education_assignment_stats_refresh(
  p_tenant UUID, p_days INT DEFAULT 120, p_speed_days INT DEFAULT 30
)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rows INT;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _assign_stats_new (
    user_id UUID, destination TEXT, received INT, progressed INT, speed_n INT, median_first_contact_min NUMERIC
  ) ON COMMIT DROP;
  TRUNCATE _assign_stats_new;

  INSERT INTO _assign_stats_new (user_id, destination, received, progressed, speed_n, median_first_contact_min)
  WITH q AS (
    SELECT sort_order AS qsort FROM lead_lists WHERE tenant_id = p_tenant AND slug = 'qualified' LIMIT 1
  ),
  recv AS (
    SELECT l.id, l.assigned_to AS uid, l.destinations, COALESCE(l.assigned_at, l.created_at) AS at,
           COALESCE(ll.is_archive, false) = false AND q.qsort IS NOT NULL AND ll.sort_order >= q.qsort AS progressed
    FROM leads l
    LEFT JOIN lead_lists ll ON ll.id = l.list_id
    LEFT JOIN q ON true
    WHERE l.tenant_id = p_tenant AND l.deleted_at IS NULL AND l.assigned_to IS NOT NULL
      AND EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = p_tenant AND tu.user_id = l.assigned_to)
      AND COALESCE(l.assigned_at, l.created_at) >= now() - make_interval(days => p_days)
  ),
  first_contact AS (
    SELECT r.id, r.uid,
           EXTRACT(EPOCH FROM (LEAST(
             (SELECT min(a.created_at) FROM lead_activities a WHERE a.lead_id = r.id AND a.created_at >= r.at),
             (SELECT min(n.created_at) FROM lead_notes n WHERE n.lead_id = r.id AND n.ai_tool_call_id IS NULL AND n.created_at >= r.at)
           ) - r.at)) / 60.0 AS minutes
    FROM recv r
    WHERE r.at >= now() - make_interval(days => p_speed_days)
  ),
  speed AS (
    SELECT uid, count(minutes)::INT AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes) AS med
    FROM first_contact WHERE minutes IS NOT NULL GROUP BY uid
  ),
  overall AS (
    SELECT uid, '*'::TEXT AS destination, count(*)::INT AS received, count(*) FILTER (WHERE progressed)::INT AS progressed
    FROM recv GROUP BY uid
  ),
  per_dest AS (
    SELECT r.uid, d AS destination, count(*)::INT AS received, count(*) FILTER (WHERE r.progressed)::INT AS progressed
    FROM recv r, LATERAL unnest(r.destinations) d
    WHERE r.destinations IS NOT NULL AND cardinality(r.destinations) > 0
    GROUP BY r.uid, d
  )
  SELECT o.uid, o.destination, o.received, o.progressed, COALESCE(s.n, 0), s.med
  FROM overall o LEFT JOIN speed s ON s.uid = o.uid
  UNION ALL
  SELECT p.uid, p.destination, p.received, p.progressed, 0, NULL FROM per_dest p;

  -- Replace the tenant's rows, keeping each person's last flag_7d.
  CREATE TEMP TABLE IF NOT EXISTS _assign_flags (user_id UUID, destination TEXT, flag_7d TEXT) ON COMMIT DROP;
  TRUNCATE _assign_flags;
  INSERT INTO _assign_flags SELECT user_id, destination, flag_7d FROM lead_assignment_stats WHERE tenant_id = p_tenant;
  DELETE FROM lead_assignment_stats WHERE tenant_id = p_tenant;
  INSERT INTO lead_assignment_stats (tenant_id, user_id, destination, received, progressed, speed_n, median_first_contact_min, flag_7d, computed_at)
  SELECT p_tenant, n.user_id, n.destination, n.received, n.progressed, n.speed_n, n.median_first_contact_min, f.flag_7d, now()
  FROM _assign_stats_new n
  LEFT JOIN _assign_flags f ON f.user_id = n.user_id AND f.destination = n.destination;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.education_assignment_stats_refresh(UUID, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.education_assignment_stats_refresh(UUID, INT, INT) TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('285_education_smart_assignment.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
