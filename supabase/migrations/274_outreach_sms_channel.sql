-- Migration 274: Outreach channels — a sequence is either 'email' (today) or 'sms'.
--
-- Additive only. The channel lives on the SEQUENCE (authoritative); a lead's enrollment copies it so the
-- "one running cadence per lead" rule can be per channel (a lead may be in one email AND one SMS sequence).
-- email_sequence_steps.channel (mig 176, CHECK ('email')) is left untouched and ignored: the sequence decides.
--
--   email_sequences.channel          NEW, default 'email' -> every existing sequence stays email
--   sequence_enrollments.channel     NEW, default 'email', stamped from the sequence by a BEFORE INSERT trigger
--                                    (so switch_lead_enrollment, bulk enroll and every other insert need no change)
--   sequence_step_drafts.channel     NEW, default 'email', stamped from the enrollment by a BEFORE INSERT trigger
--                                    (the send runners read it to pick the email or SMS sender; for an SMS draft
--                                    body_html holds the plain-text message and subject is '')
--   sequence_step_drafts.sms_message_id  NEW, nullable FK -> sms_messages (the SMS twin of email_message_id, mig 216).
--                                    SMS sends do NOT write a lead_activities row: activity_type is an enum
--                                    (call/email/meeting) read by many dashboards, so it is left alone.
--   uq_enrollment_active_lead        (tenant_id, lead_id)  ->  (tenant_id, lead_id, channel), still partial on active/paused
--
--   Expected before/after row counts: email_sequences N -> N, sequence_enrollments M -> M, sequence_step_drafts D -> D (0 rows inserted/deleted;
--   existing rows take the 'email' default, which is correct because only email existed).
--   Rollback:
--     DROP INDEX IF EXISTS public.uq_enrollment_active_lead_channel;
--     CREATE UNIQUE INDEX IF NOT EXISTS uq_enrollment_active_lead ON public.sequence_enrollments (tenant_id, lead_id) WHERE status IN ('active', 'paused');
--     ALTER TABLE public.sequence_step_drafts DROP COLUMN IF EXISTS sms_message_id;
--     DROP TRIGGER IF EXISTS trg_sequence_draft_channel ON public.sequence_step_drafts;
--     DROP FUNCTION IF EXISTS public.sequence_draft_set_channel();
--     ALTER TABLE public.sequence_step_drafts DROP COLUMN IF EXISTS channel;
--     DROP TRIGGER IF EXISTS trg_sequence_enrollment_channel ON public.sequence_enrollments;
--     DROP FUNCTION IF EXISTS public.sequence_enrollment_set_channel();
--     ALTER TABLE public.sequence_enrollments DROP COLUMN IF EXISTS channel;
--     ALTER TABLE public.email_sequences DROP COLUMN IF EXISTS channel;
--     (only safe while no SMS sequence/enrollment exists)
--   Applied: stage <PENDING> / prod HELD.

BEGIN;

ALTER TABLE public.email_sequences
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms'));

ALTER TABLE public.sequence_enrollments
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms'));

-- Stamp the enrollment's channel from its sequence on insert, so no caller can get it wrong or forget it.
CREATE OR REPLACE FUNCTION public.sequence_enrollment_set_channel() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  SELECT s.channel INTO NEW.channel FROM public.email_sequences s WHERE s.id = NEW.sequence_id;
  IF NEW.channel IS NULL THEN
    NEW.channel := 'email';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sequence_enrollment_channel ON public.sequence_enrollments;
CREATE TRIGGER trg_sequence_enrollment_channel
  BEFORE INSERT ON public.sequence_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.sequence_enrollment_set_channel();

ALTER TABLE public.sequence_step_drafts
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms'));

ALTER TABLE public.sequence_step_drafts
  ADD COLUMN IF NOT EXISTS sms_message_id UUID REFERENCES public.sms_messages(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.sequence_draft_set_channel() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  SELECT e.channel INTO NEW.channel FROM public.sequence_enrollments e WHERE e.id = NEW.enrollment_id;
  IF NEW.channel IS NULL THEN
    NEW.channel := 'email';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sequence_draft_channel ON public.sequence_step_drafts;
CREATE TRIGGER trg_sequence_draft_channel
  BEFORE INSERT ON public.sequence_step_drafts
  FOR EACH ROW EXECUTE FUNCTION public.sequence_draft_set_channel();

-- One running (active/paused) cadence per lead PER CHANNEL. Build the new index first, then drop the old one,
-- so there is never a moment without the guarantee. Existing rows are all 'email', so the new index can't conflict.
CREATE UNIQUE INDEX IF NOT EXISTS uq_enrollment_active_lead_channel
  ON public.sequence_enrollments (tenant_id, lead_id, channel)
  WHERE status IN ('active', 'paused');

DROP INDEX IF EXISTS public.uq_enrollment_active_lead;

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('274_outreach_sms_channel.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
