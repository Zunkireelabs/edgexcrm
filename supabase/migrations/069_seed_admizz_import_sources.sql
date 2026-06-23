-- 069_seed_admizz_import_sources.sql
-- Seeds the 8 Admizz import-source manifest rows into lead_import_sources.
-- source_label values are the EXACT DB strings (no "N - " prefix).
-- Labels verified 2026-06-23 against live stage intake_source components.
-- ON CONFLICT DO NOTHING — safe to re-run.

BEGIN;

DO $$
DECLARE
  before_count INT;
BEGIN
  SELECT COUNT(*) INTO before_count FROM lead_import_sources
  WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88';
  RAISE NOTICE '069 BEFORE: admizz import_source rows=%', before_count;
END $$;

INSERT INTO lead_import_sources
  (tenant_id, staging_list_id, source_label, raw_rows, dropped_rows, no_contact_rows, with_contact_rows, notes, sort_order)
VALUES
  ('febeb37c-521c-4f29-adbb-0195b2eede88', 'd1d9ceda-c479-427e-9da8-0ceda5bdc3b1', 'Sohan Leads',                      803,  0,   80, 723, NULL,                              1),
  ('febeb37c-521c-4f29-adbb-0195b2eede88', 'd1d9ceda-c479-427e-9da8-0ceda5bdc3b1', 'RKU Alumni',                         82,  0,    0,  82, 'has email',                       2),
  ('febeb37c-521c-4f29-adbb-0195b2eede88', 'd1d9ceda-c479-427e-9da8-0ceda5bdc3b1', 'Ritesh Leads',                      692,  0,    0, 692, NULL,                              3),
  ('febeb37c-521c-4f29-adbb-0195b2eede88', 'd1d9ceda-c479-427e-9da8-0ceda5bdc3b1', 'NEB10K',                           2499,  0,    4,2495, NULL,                              4),
  ('febeb37c-521c-4f29-adbb-0195b2eede88', 'd1d9ceda-c479-427e-9da8-0ceda5bdc3b1', 'UK Expo 2026',                      133,  0,    0, 133, 'has email; destinations=UK',      5),
  ('febeb37c-521c-4f29-adbb-0195b2eede88', 'd1d9ceda-c479-427e-9da8-0ceda5bdc3b1', 'Model Secondary School - Management',1025, 88,  64, 873, 'student roster',                  6),
  ('febeb37c-521c-4f29-adbb-0195b2eede88', 'd1d9ceda-c479-427e-9da8-0ceda5bdc3b1', 'Model Secondary School - Science',  1025,279,  56, 690, 'student roster',                  7),
  ('febeb37c-521c-4f29-adbb-0195b2eede88', 'd1d9ceda-c479-427e-9da8-0ceda5bdc3b1', 'NEB Sample',                        299,  0,    4, 295, NULL,                              8)
ON CONFLICT (tenant_id, staging_list_id, source_label) DO NOTHING;

DO $$
DECLARE
  after_count INT;
BEGIN
  SELECT COUNT(*) INTO after_count FROM lead_import_sources
  WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88';
  RAISE NOTICE '069 AFTER: admizz import_source rows=%', after_count;
  IF after_count < 8 THEN
    RAISE EXCEPTION '069 ABORT: expected >=8 rows for Admizz, got %', after_count;
  END IF;
END $$;

COMMIT;
