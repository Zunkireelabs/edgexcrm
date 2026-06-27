-- CLEANUP: Strip promoted keys from custom_fields after column verification.
-- NON-REVERSIBLE. Opus runs this SEPARATELY, after verifying migration 087 on stage.
-- DO NOT bundle into migration 087 or run without explicit approval.
--
-- Keys stripped: nationality, source_category, source_channel, source_page,
--                program_level, program_category, interested_country, campaign
-- Keys preserved: raw_phone, import_batch (and any other keys)

BEGIN;

DO $$
DECLARE
  rows_updated INTEGER;
BEGIN
  UPDATE leads
  SET custom_fields = custom_fields
    - 'nationality'
    - 'source_category'
    - 'source_channel'
    - 'source_page'
    - 'program_level'
    - 'program_category'
    - 'interested_country'
    - 'campaign'
  WHERE custom_fields ?| ARRAY[
    'nationality','source_category','source_channel','source_page',
    'program_level','program_category','interested_country','campaign'
  ]
    AND deleted_at IS NULL;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE 'Stripped promoted keys from % lead(s)', rows_updated;
END $$;

COMMIT;
