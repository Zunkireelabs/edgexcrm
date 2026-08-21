-- Migration 209: fix real_estate's stale default_pipeline_stages + seed home_moving industry
--
-- Part 1 — real_estate: `default_pipeline_stages` still holds the original
-- brokerage-oriented pipeline (New -> Property Shown -> Offer Made -> Under
-- Contract -> Closed/Lost) seeded in 012_industry_customization.sql. Migration
-- 164_real_estate_industry.sql relabeled the entity terms ("Asset Classes") for
-- the CRE capital-raise rebuild but left this column untouched. The vertical's
-- real funnel lives entirely in investor_commitments.status (prospect ->
-- soft_commit -> subscribed -> funded/declined) — leads.stage_id is only a
-- formality (NOT NULL constraint), irrelevant to the product. The one existing
-- demo tenant (scripts/seed-real-estate-demo.sh) already proves this by
-- hand-creating a single "Active" stage instead of using this default at all.
-- Nobody has run the official scripts/onboard-tenant.ts for real_estate yet —
-- if they did today it would seed the nonsense brokerage stages. Replace with
-- a single "Active" stage matching what the demo script does by hand.
--
-- Part 2 — home_moving: new industries row, a literal clone of real_estate's
-- shape (same entity_type_label/singular/icon/default_pipeline_stages) so the
-- soon-to-follow home_moving tenant onboards onto the same correct default the
-- real_estate fix above establishes. See src/industries/home-moving/manifest.ts
-- for the app-layer half of this clone (Offerings/Investors/Data Room, reusing
-- real_estate's offerings feature + AI tool pack as-is).
--
-- Expected before/after row counts:
--   industries: 8 -> 9 rows (1 new home_moving row; 0 on re-run, ON CONFLICT DO NOTHING).
--   industries where id='real_estate': 1 row updated (0 on re-run — guarded).
--   No other table touched, no tenant data touched.
--
-- Rollback:
--   UPDATE public.industries SET default_pipeline_stages = '[
--     {"name": "New", "slug": "new", "position": 0, "color": "#3b82f6", "is_default": true, "is_terminal": false},
--     {"name": "Property Shown", "slug": "property-shown", "position": 1, "color": "#f97316", "is_default": false, "is_terminal": false},
--     {"name": "Offer Made", "slug": "offer-made", "position": 2, "color": "#a855f7", "is_default": false, "is_terminal": false},
--     {"name": "Under Contract", "slug": "under-contract", "position": 3, "color": "#eab308", "is_default": false, "is_terminal": false},
--     {"name": "Closed", "slug": "closed", "position": 4, "color": "#22c55e", "is_default": false, "is_terminal": true},
--     {"name": "Lost", "slug": "lost", "position": 5, "color": "#ef4444", "is_default": false, "is_terminal": true}
--   ]'::jsonb WHERE id = 'real_estate';
--   DELETE FROM public.industries WHERE id = 'home_moving';
--
-- Applied: local <pending> / stage HELD / prod HELD.

BEGIN;

-- Part 1: idempotent — the WHERE guard makes a re-run a 0-row no-op.
UPDATE public.industries
   SET default_pipeline_stages = '[
     {"name": "Active", "slug": "active", "position": 0, "color": "#3b82f6", "is_default": true, "is_terminal": false}
   ]'::jsonb
 WHERE id = 'real_estate'
   AND default_pipeline_stages IS DISTINCT FROM '[
     {"name": "Active", "slug": "active", "position": 0, "color": "#3b82f6", "is_default": true, "is_terminal": false}
   ]'::jsonb;

-- Part 2: idempotent — ON CONFLICT DO NOTHING.
INSERT INTO public.industries
  (id, name, description, entity_type_label, entity_type_singular, icon, default_pipeline_stages)
VALUES (
  'home_moving',
  'Home Moving',
  'Investor-backed home-moving / relocation vertical — literal clone of the real_estate CRE capital-raise pattern (offerings, investor commitments, data room).',
  'Asset Classes',
  'Asset Class',
  'building',
  '[
    {"name": "Active", "slug": "active", "position": 0, "color": "#3b82f6", "is_default": true, "is_terminal": false}
  ]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.schema_migrations (version) VALUES ('209_home_moving_industry.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
