-- Migration 157: convert legacy "parent" lead tag -> "other" on leads.tags
--
-- Parent was retired as a Lead Type (PR #209 / migration 156 renamed the
-- lead_types config row). But existing leads still carried tags = {parent},
-- an orphaned value with no picker to change it. Folding it into "other" makes
-- those leads behave as walk-in Contacts everywhere for free — they get:
--   * included on the Contacts page (.contains(tags, ["other"]))
--   * excluded from Stages/Pipeline (excludeOtherType)
--   * Status/Stage hidden on the detail page (isOtherContact gate)
--   * "Other" shown in the Tag pill/toggle
-- ...with zero UI aliasing, because every one of those paths already keys off
-- "other". tags[0] is the single category slot (migration 098_lead_types.sql),
-- so array_replace on that value is the whole change.
--
-- Additive/reversible DML. Rollback:
--   UPDATE leads SET tags = array_replace(tags, 'other', 'parent')
--   WHERE tenant_id IN (SELECT id FROM tenants WHERE industry_id='education_consultancy')
--   -- (only safe immediately after; once new "other" leads exist it over-reverts)
-- Applied: STAGE ONLY so far — verify before/after counts of {parent} leads.

BEGIN;

-- Scope to education tenants — "parent" is an education-consultancy tag value.
UPDATE leads
SET tags = array_replace(tags, 'parent', 'other'),
    updated_at = NOW()
WHERE 'parent' = ANY(tags)
  AND tenant_id IN (SELECT id FROM tenants WHERE industry_id = 'education_consultancy');

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('157_leads_parent_tag_to_other.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
