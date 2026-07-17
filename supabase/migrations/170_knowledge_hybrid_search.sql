-- Migration 170: knowledge_hybrid_search RPC (Phase 2C retrieval)
--
-- Hybrid retrieval over knowledge_chunks (migration 161): a vector-similarity
-- arm and a Postgres full-text-search arm, merged via Reciprocal Rank Fusion
-- (RRF, 1/(60+rank) per arm, summed per chunk). Pure-vector search misses
-- exact codes/names/rare tokens that keyword search finds trivially; FTS
-- alone misses paraphrased/semantic matches — RRF gets both without a
-- re-ranker model (docs/ai-native-efforts/02-PHASE-2-KNOWLEDGE-LAYER.md §5).
--
-- Trust model: this function takes p_tenant_id as a PARAMETER and filters by
-- it directly (no session/RLS-derived tenant lookup) — same trust model as
-- scopedClientForTenant(): the caller (retrieve.ts, always via the service-role
-- client's rpc() wrapper) is responsible for supplying the correct tenant_id.
-- Because of that, this function must NEVER be callable by `authenticated`/
-- `anon` roles (a user-context call could pass an arbitrary tenant_id and read
-- cross-tenant chunks) — only the service role may execute it. RLS on
-- knowledge_chunks still protects any future user-context SELECT path.
--
-- websearch_to_tsquery (not to_tsquery) is used deliberately: it never throws
-- on arbitrary user input (unbalanced quotes, bare operators, etc.), which
-- to_tsquery would reject with a syntax error.
--
-- Also widens ai_usage_events.surface's CHECK constraint (migration 160) to
-- allow 'retrieval' — retrieve.ts logs one usage row per call with that
-- surface value, and the original constraint only allowed
-- assistant|ingestion|background_agent.
--
-- Expected before/after row counts: 0 rows touched (function + constraint
-- definitions only).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS knowledge_hybrid_search(uuid, vector(1024), text, int);
--   ALTER TABLE ai_usage_events DROP CONSTRAINT IF EXISTS ai_usage_events_surface_check;
--   ALTER TABLE ai_usage_events ADD CONSTRAINT ai_usage_events_surface_check
--     CHECK (surface IN ('assistant','ingestion','background_agent'));
--
-- Applied: local only (2026-07-17) / stage HELD / prod HELD.

BEGIN;

CREATE OR REPLACE FUNCTION knowledge_hybrid_search(
  p_tenant_id uuid,
  p_query_embedding vector(1024),
  p_query text,
  p_limit int DEFAULT 12
) RETURNS TABLE (
  chunk_id uuid,
  kb_item_id uuid,
  chunk_index int,
  content text,
  metadata jsonb,
  rrf_score float
)
LANGUAGE sql
STABLE
AS $$
  WITH vector_arm AS (
    SELECT
      id,
      row_number() OVER (ORDER BY embedding <=> p_query_embedding) AS rank
    FROM knowledge_chunks
    WHERE tenant_id = p_tenant_id
      AND embedding IS NOT NULL
    ORDER BY embedding <=> p_query_embedding
    LIMIT 24
  ),
  keyword_arm AS (
    SELECT
      id,
      row_number() OVER (ORDER BY ts_rank(content_tsv, websearch_to_tsquery('english', p_query)) DESC) AS rank
    FROM knowledge_chunks
    WHERE tenant_id = p_tenant_id
      AND content_tsv @@ websearch_to_tsquery('english', p_query)
    ORDER BY ts_rank(content_tsv, websearch_to_tsquery('english', p_query)) DESC
    LIMIT 24
  ),
  fused AS (
    SELECT
      id,
      sum(1.0 / (60 + rank)) AS rrf_score
    FROM (
      SELECT id, rank FROM vector_arm
      UNION ALL
      SELECT id, rank FROM keyword_arm
    ) arms
    GROUP BY id
  )
  SELECT
    c.id AS chunk_id,
    c.kb_item_id,
    c.chunk_index,
    c.content,
    c.metadata,
    f.rrf_score
  FROM fused f
  JOIN knowledge_chunks c ON c.id = f.id
  ORDER BY f.rrf_score DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION knowledge_hybrid_search(uuid, vector(1024), text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION knowledge_hybrid_search(uuid, vector(1024), text, int) FROM anon;
REVOKE ALL ON FUNCTION knowledge_hybrid_search(uuid, vector(1024), text, int) FROM authenticated;
-- No GRANT to service_role needed — Supabase's ALTER DEFAULT PRIVILEGES
-- grants EXECUTE on new public-schema functions to anon/authenticated/
-- service_role explicitly (not just via PUBLIC). That default grant is
-- exactly why the anon/authenticated REVOKEs above must be explicit — and
-- why service_role keeps EXECUTE after them (verified live:
-- has_function_privilege = f/f/t for authenticated/anon/service_role).

ALTER TABLE ai_usage_events DROP CONSTRAINT IF EXISTS ai_usage_events_surface_check;
ALTER TABLE ai_usage_events ADD CONSTRAINT ai_usage_events_surface_check
  CHECK (surface IN ('assistant', 'ingestion', 'background_agent', 'retrieval'));

INSERT INTO public.schema_migrations (version) VALUES ('170_knowledge_hybrid_search.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
