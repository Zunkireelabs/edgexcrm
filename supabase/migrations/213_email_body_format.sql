-- Migration 213: email_forward_rules.body_format — persist whether a rule's
-- body is plain text or full HTML, instead of re-inferring it at send time.
--
-- Why: the send path runs preserveLineBreaks() unconditionally, which
-- corrupts CSS inside a pasted <style> block (newlines between selectors/
-- properties get turned into literal <br>, breaking media queries). The
-- editor already knows which mode the admin is authoring in — persist that
-- fact instead of guessing. See docs/EMAIL-HTML-BODY-FORMAT-BRIEF.md.
--
-- Additive only. Expected before/after row counts: email_forward_rules row
-- count unchanged (0 rows added/removed); every existing row gets
-- body_format = 'text' via the column DEFAULT (deliberate — every rule
-- authored before this migration was plain text and must keep rendering
-- exactly as it does today).
-- Rollback: ALTER TABLE email_forward_rules DROP COLUMN IF EXISTS body_format;
-- Applied: stage HELD / prod HELD.

BEGIN;

ALTER TABLE email_forward_rules
  ADD COLUMN IF NOT EXISTS body_format TEXT NOT NULL DEFAULT 'text'
  CHECK (body_format IN ('text', 'html'));

-- form_configs.autoresponder.body_format lives in the existing JSONB column
-- (form_configs.autoresponder) — no migration needed for that surface.

DO $$
DECLARE v_total INT;
BEGIN
  SELECT COUNT(*) INTO v_total FROM email_forward_rules;
  RAISE NOTICE '213 email_forward_rules.body_format: % rows now default to ''text''', v_total;
END$$;

INSERT INTO public.schema_migrations (version) VALUES ('213_email_body_format.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
