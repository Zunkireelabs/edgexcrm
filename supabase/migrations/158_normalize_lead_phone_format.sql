-- Migration 158: normalize leads.phone to the canonical "+<dialcode>-<number>" format
--
-- Bulk-imported leads landed in mixed phone formats. Canonical storage (see
-- src/lib/phone-utils.ts formatPhoneForStorage) is "+977-9803023768". This migration
-- folds the two dominant broken formats into it, conservatively — only unambiguous
-- Nepal numbers are touched; anything with a foreign/ambiguous shape is LEFT ALONE.
--
-- Transforms (prod counts at authoring time, deleted_at IS NULL):
--   1. bare Nepal mobile  ^9[0-9]{9}$        (14423) -> '+977-' || phone
--   2. +977 without dash  ^\+977[0-9]+$      ( 1452) -> '+977-' || rest
--   3. four specific "weird" rows (space/extra-dash) -> exact canonical value
--
-- LEFT UNTOUCHED ON PURPOSE (flagged for later / app-side handling):
--   - already correct +977-<num> (1394)
--   - other country code WITH dash +XX-<num> (13)
--   - foreign +code without dash e.g. +91.../+880... (31) — ambiguous code split
--   - 10-digit NOT starting 9 e.g. Indian 7xxx/8xxx (9) — must not force +977
--   - non-10-digit bare junk (12) and empty/null (306)
--
-- Reversible: every mutated row's old phone is snapshotted into _mig158_phone_backup
-- FIRST. Rollback = UPDATE leads l SET phone = b.old_phone FROM _mig158_phone_backup b
-- WHERE l.id = b.lead_id. Idempotent: after running, no row matches the source patterns
-- (bare -> +977-, +977 -> +977-), and the snapshot INSERT is ON CONFLICT DO NOTHING.

BEGIN;

CREATE TABLE IF NOT EXISTS _mig158_phone_backup (
  lead_id      UUID PRIMARY KEY,
  old_phone    TEXT,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Snapshot every row this migration will touch, before mutating.
INSERT INTO _mig158_phone_backup (lead_id, old_phone)
SELECT id, phone FROM leads
WHERE deleted_at IS NULL
  AND (
    phone ~ '^9[0-9]{9}$'
    OR phone ~ '^\+977[0-9]+$'
    OR phone IN ('+977 9869298178', '984 0221056', '+977-984 3392536', '+977-985-1053963')
  )
ON CONFLICT (lead_id) DO NOTHING;

-- 1. bare Nepal mobile -> +977-<num>
UPDATE leads SET phone = '+977-' || phone, updated_at = NOW()
WHERE deleted_at IS NULL AND phone ~ '^9[0-9]{9}$';

-- 2. +977 without dash -> +977-<rest>
UPDATE leads SET phone = '+977-' || substring(phone FROM 5), updated_at = NOW()
WHERE deleted_at IS NULL AND phone ~ '^\+977[0-9]+$';

-- 3. specific weird rows -> canonical
UPDATE leads SET phone = '+977-9869298178', updated_at = NOW()
  WHERE deleted_at IS NULL AND phone = '+977 9869298178';
UPDATE leads SET phone = '+977-9840221056', updated_at = NOW()
  WHERE deleted_at IS NULL AND phone = '984 0221056';
UPDATE leads SET phone = '+977-9843392536', updated_at = NOW()
  WHERE deleted_at IS NULL AND phone = '+977-984 3392536';
UPDATE leads SET phone = '+977-9851053963', updated_at = NOW()
  WHERE deleted_at IS NULL AND phone = '+977-985-1053963';

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('158_normalize_lead_phone_format.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
