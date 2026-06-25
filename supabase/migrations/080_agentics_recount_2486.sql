-- 080_agentics_recount_2486.sql
-- Corrects the Agentics leads row in lead_import_sources.
-- Original load (mig 074) used file 9 (2,512 rows); file 9.1 de-duped 26 exact-dup rows,
-- leaving 2,486 distinct people. The staging list was force-reloaded with 9.1 on 2026-06-25.
-- Loader data-quality stats: withEmail=2436, withPhone=2466, withNeither=4 (name-only).
-- with_contact_rows = 2486 - 4 = 2482.

BEGIN;

UPDATE lead_import_sources
SET
  raw_rows          = 2486,
  dropped_rows      = 26,
  no_contact_rows   = 4,
  with_contact_rows = 2482,
  notes             = 'Agentics/Facebook campaign; file 9.1 (26 exact-dup rows removed at source); loaded raw (dedup deferred to routing)'
WHERE
  tenant_id        = 'febeb37c-521c-4f29-adbb-0195b2eede88'
  AND staging_list_id = 'd1d9ceda-c479-427e-9da8-0ceda5bdc3b1'
  AND source_label = 'Agentics leads';

COMMIT;
