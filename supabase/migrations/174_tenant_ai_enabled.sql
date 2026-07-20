-- Migration 174: per-tenant AI enablement flag
--
-- ADR-001 Decision 5 (docs/ai-native-efforts/working/BRIEF-D5-PER-TENANT-AI-FLAG.md)
-- requires AI rollout in a fixed order — Zunkiree Labs -> Mobilise -> Admizz
-- last, and only after written client consent (Admizz is data controller for
-- student PII; EdgeX is processor). Today the only switches are the
-- environment-level AI_ASSISTANT_ENABLED / AI_INGESTION_ENABLED flags in
-- src/lib/ai/flag.ts, which enable the assistant/ingestion for every tenant
-- in the environment simultaneously. This column is the per-tenant grant the
-- consent paperwork will describe; the env flags remain the environment-wide
-- kill switch (both must be true for a tenant to get AI).
--
-- DEFAULT false is deliberate and load-bearing: every existing tenant lands
-- opted-out. Turning AI on is an explicit per-tenant act. Do not backfill any
-- tenant to true in this migration, including Zunkiree's own.
--
-- Expected before/after row counts: public.tenants row count unchanged
-- (nullable-free, defaulted column added only); all existing rows land as
-- ai_enabled = false.
--
-- Rollback:
--   ALTER TABLE public.tenants DROP COLUMN IF EXISTS ai_enabled;
--
-- Applied: local only (2026-07-19) / stage HELD / prod HELD.

BEGIN;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT false;

INSERT INTO public.schema_migrations (version) VALUES ('174_tenant_ai_enabled.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
