-- Migration 156: real_estate industry — relabel entity terms for CRE capital vertical
--
-- The `real_estate` industries row shipped with brokerage-oriented labels
-- ("Property Types" / "Property Type"). The EdgeX real_estate vertical is a
-- CRE sponsor / capital-raise workspace, where the industry entity is the
-- asset class of an offering. Relabel the entity terms accordingly. This only
-- touches the single `real_estate` lookup row — no tenant data, no other
-- industry. The brokerage default pipeline is irrelevant (the raise funnel is
-- per-offering, driven by investor_commitments) and is left untouched.
--
-- Expected before/after row counts:
--   industries where id='real_estate': 1 row updated (0 on re-run — guarded).
--   All other industries / tenants: 0 rows touched.
--
-- Rollback:
--   UPDATE public.industries
--     SET entity_type_label='Property Types', entity_type_singular='Property Type'
--     WHERE id='real_estate';
--
-- Applied: local only (2026-07-15) / stage HELD / prod HELD.

BEGIN;

-- Idempotent: the WHERE guard makes a re-run a 0-row no-op.
UPDATE public.industries
   SET entity_type_label    = 'Asset Classes',
       entity_type_singular = 'Asset Class'
 WHERE id = 'real_estate'
   AND (entity_type_label IS DISTINCT FROM 'Asset Classes'
        OR entity_type_singular IS DISTINCT FROM 'Asset Class');

INSERT INTO public.schema_migrations (version) VALUES ('156_real_estate_industry.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
