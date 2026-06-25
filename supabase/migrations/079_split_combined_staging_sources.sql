-- 079_split_combined_staging_sources.sql
-- Staging keeps every file appearance as its own row — no source-combining.
-- Split the 68 rows whose intake_source is "A | B" into two single-source rows
-- (original keeps A; an inserted duplicate carries B). Also drop the mig-078
-- unique-count helper, now unnecessary (each row has exactly one source, so the
-- per-file sum equals the row/list count).
-- NOTE: normalized_email is GENERATED ALWAYS and display_id is omitted (regenerates
-- to NULL); both are excluded from the column list. All combined rows have exactly
-- 2 sources (guarded). Rollback is non-trivial (duplicated rows); take a snapshot first.

BEGIN;

-- before-guards
DO $$
DECLARE v_combined INT; v_total INT; v_three INT;
BEGIN
  SELECT COUNT(*) INTO v_combined FROM leads
   WHERE tenant_id='febeb37c-521c-4f29-adbb-0195b2eede88' AND deleted_at IS NULL
     AND list_id='d1d9ceda-c479-427e-9da8-0ceda5bdc3b1' AND intake_source LIKE '% | %';
  SELECT COUNT(*) INTO v_three FROM leads
   WHERE tenant_id='febeb37c-521c-4f29-adbb-0195b2eede88' AND deleted_at IS NULL
     AND list_id='d1d9ceda-c479-427e-9da8-0ceda5bdc3b1'
     AND (length(intake_source)-length(replace(intake_source,' | ','')))/length(' | ') >= 2;
  SELECT COUNT(*) INTO v_total FROM leads
   WHERE tenant_id='febeb37c-521c-4f29-adbb-0195b2eede88' AND deleted_at IS NULL
     AND list_id='d1d9ceda-c479-427e-9da8-0ceda5bdc3b1';
  RAISE NOTICE 'Before: combined=% (expect 68), 3+source=% (expect 0), list total=% (expect 8626)', v_combined, v_three, v_total;
  IF v_combined <> 68 THEN RAISE EXCEPTION 'Expected 68 combined rows, got %. Rollback.', v_combined; END IF;
  IF v_three  <> 0  THEN RAISE EXCEPTION 'Found % rows with 3+ sources; this split only handles 2. Rollback.', v_three; END IF;
END $$;

-- 1. insert the second-source copy of each combined row (explicit column list:
--    excludes id [default], normalized_email [generated], display_id [→NULL])
INSERT INTO leads (
  tenant_id, session_id, step, is_final, status, first_name, last_name, email, phone,
  city, country, custom_fields, file_urls, created_at, updated_at, deleted_at,
  idempotency_key, stage_id, assigned_to, intake_source, intake_medium, intake_campaign,
  preferred_contact_method, form_config_id, entity_id, ai_score, ai_priority,
  ai_score_updated_at, pipeline_id, tags, account_id, lead_type, converted_at,
  converted_contact_id, ref_code, merged_into, last_activity_at, company_name, designation,
  prospect_industry, owner_id, salutation, company_email, branch_id, list_id, destinations,
  field_of_study, degree_level, archive_reason
)
SELECT
  tenant_id, session_id, step, is_final, status, first_name, last_name, email, phone,
  city, country, custom_fields, file_urls, created_at, updated_at, deleted_at,
  idempotency_key, stage_id, assigned_to, split_part(intake_source,' | ',2), intake_medium, intake_campaign,
  preferred_contact_method, form_config_id, entity_id, ai_score, ai_priority,
  ai_score_updated_at, pipeline_id, tags, account_id, lead_type, converted_at,
  converted_contact_id, ref_code, merged_into, last_activity_at, company_name, designation,
  prospect_industry, owner_id, salutation, company_email, branch_id, list_id, destinations,
  field_of_study, degree_level, archive_reason
FROM leads
WHERE tenant_id='febeb37c-521c-4f29-adbb-0195b2eede88' AND deleted_at IS NULL
  AND list_id='d1d9ceda-c479-427e-9da8-0ceda5bdc3b1' AND intake_source LIKE '% | %';

-- 2. collapse originals to their first source
UPDATE leads SET intake_source = split_part(intake_source,' | ',1)
WHERE tenant_id='febeb37c-521c-4f29-adbb-0195b2eede88' AND deleted_at IS NULL
  AND list_id='d1d9ceda-c479-427e-9da8-0ceda5bdc3b1' AND intake_source LIKE '% | %';

-- 3. drop the now-unneeded unique helper (mig 078)
DROP FUNCTION IF EXISTS reconcile_import_sources_unique(UUID, UUID);

-- after-guards
DO $$
DECLARE v_combined INT; v_total INT; v_sum BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_combined FROM leads
   WHERE tenant_id='febeb37c-521c-4f29-adbb-0195b2eede88' AND deleted_at IS NULL
     AND list_id='d1d9ceda-c479-427e-9da8-0ceda5bdc3b1' AND intake_source LIKE '% | %';
  SELECT COUNT(*) INTO v_total FROM leads
   WHERE tenant_id='febeb37c-521c-4f29-adbb-0195b2eede88' AND deleted_at IS NULL
     AND list_id='d1d9ceda-c479-427e-9da8-0ceda5bdc3b1';
  SELECT COALESCE(SUM(in_crm),0) INTO v_sum
   FROM reconcile_import_sources('febeb37c-521c-4f29-adbb-0195b2eede88','d1d9ceda-c479-427e-9da8-0ceda5bdc3b1');
  RAISE NOTICE 'After: combined=% (expect 0), list total=% (expect 8694), reconcile sum=% (expect 8694)', v_combined, v_total, v_sum;
  IF v_combined <> 0    THEN RAISE EXCEPTION 'Combined rows remain (%). Rollback.', v_combined; END IF;
  IF v_total    <> 8694 THEN RAISE EXCEPTION 'Expected 8694 list total, got %. Rollback.', v_total; END IF;
  IF v_sum      <> 8694 THEN RAISE EXCEPTION 'Reconcile sum % != 8694. Rollback.', v_sum; END IF;
END $$;

COMMIT;
