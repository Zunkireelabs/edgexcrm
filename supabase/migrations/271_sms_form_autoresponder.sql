-- Migration 271: SMS form confirmation (autoresponder) — one-off sends tied to a form
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: sms_messages UNCHANGED (new nullable column + a
--   widened CHECK + a partial index; no rows touched).
--   Rollback: DROP INDEX IF EXISTS idx_sms_messages_form_autoresponder_phone;
--             ALTER TABLE sms_messages DROP COLUMN IF EXISTS form_config_id;
--             -- and restore the old CHECK: source IN ('blast','manual','sequence')
--             -- (only safe while no row has source = 'form_autoresponder').
--   Applied: stage <pending> / prod HELD.
--
-- Context: the per-form "Confirmation SMS" (autoresponder.sms on form_configs) sends one text
-- to the submitter. Those rows are neither blast, manual nor sequence sends, so they get their
-- own `source`, and carry `form_config_id` so the sender can de-duplicate a retried submission
-- (same phone number + same form within a short window) and so support can see which form triggered it.
-- The SMS config itself lives inside the existing form_configs.autoresponder JSONB, so there is
-- no form_configs column to add — nothing on the public form-submission path depends on this
-- migration having run.

BEGIN;

ALTER TABLE sms_messages
  ADD COLUMN IF NOT EXISTS form_config_id UUID REFERENCES form_configs(id) ON DELETE SET NULL;

-- Widen the `source` CHECK. It was declared inline in 203, so its name is auto-generated;
-- find it by definition rather than by name so this works however it was named, and is a
-- no-op on a re-run (the replacement below already contains 'form_autoresponder').
DO $$
DECLARE
  v_name text;
BEGIN
  SELECT c.conname INTO v_name
  FROM pg_constraint c
  WHERE c.conrelid = 'public.sms_messages'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%source%'
    AND pg_get_constraintdef(c.oid) ILIKE '%sequence%'
    AND pg_get_constraintdef(c.oid) NOT ILIKE '%form_autoresponder%';

  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.sms_messages DROP CONSTRAINT %I', v_name);
  END IF;
END $$;

ALTER TABLE sms_messages DROP CONSTRAINT IF EXISTS sms_messages_source_check;
ALTER TABLE sms_messages
  ADD CONSTRAINT sms_messages_source_check
  CHECK (source IN ('blast', 'manual', 'sequence', 'form_autoresponder'));

-- Duplicate-send lookup: "has this phone number already been texted by this form recently?"
-- Keyed on the number, not the lead — a resubmission can create a new lead row for the same person.
DROP INDEX IF EXISTS idx_sms_messages_form_autoresponder;
CREATE INDEX IF NOT EXISTS idx_sms_messages_form_autoresponder_phone
  ON sms_messages (form_config_id, to_phone, created_at DESC)
  WHERE source = 'form_autoresponder';

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('271_sms_form_autoresponder.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
