-- 074_seed_agentics_import_source.sql
-- Adds the 9th lead_import_sources row for the Agentics leads file.
-- Loaded raw (no dedup at load time) → IN CRM = raw: 2,512 / 2,512 (100%).
-- ON CONFLICT DO NOTHING — re-runnable.

BEGIN;

INSERT INTO lead_import_sources
  (tenant_id, staging_list_id, source_label, raw_rows, dropped_rows, no_contact_rows, with_contact_rows, notes, sort_order)
VALUES
  (
    'febeb37c-521c-4f29-adbb-0195b2eede88',
    'd1d9ceda-c479-427e-9da8-0ceda5bdc3b1',
    'Agentics leads',
    2512,
    0,
    4,
    2508,
    'Agentics/Facebook campaign; loaded raw (dedup deferred to routing)',
    9
  )
ON CONFLICT (tenant_id, staging_list_id, source_label) DO NOTHING;

COMMIT;
