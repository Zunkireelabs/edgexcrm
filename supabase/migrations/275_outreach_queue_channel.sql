-- Migration 275: "Queue next" (sequence_enrollment_queue) becomes per channel.
--
-- Migration 274 made the one-running-sequence-per-lead rule per channel (a lead may run one email AND one SMS
-- sequence). The queue of "start this next, when their current sequence ends" must follow, or:
--   - a lead with a waiting EMAIL sequence could never have a waiting SMS one (one waiting row per lead), and
--   - an email enrollment ending would start a queued SMS sequence (and the other way round).
--
-- Additive only. The queue row copies the channel of its sequence on insert (BEFORE INSERT trigger), so the code that
-- inserts queue rows needs no change; existing rows take 'email' (only email existed).
--
--   sequence_enrollment_queue.channel   NEW, default 'email', stamped from the sequence
--   uq_enrollment_queue_waiting_lead    (tenant_id, lead_id)  ->  (tenant_id, lead_id, channel), still partial on 'waiting'
--
--   Expected before/after row counts: sequence_enrollment_queue Q -> Q (0 rows inserted/deleted).
--   Rollback:
--     DROP INDEX IF EXISTS public.uq_enrollment_queue_waiting_lead_channel;
--     CREATE UNIQUE INDEX IF NOT EXISTS uq_enrollment_queue_waiting_lead ON public.sequence_enrollment_queue (tenant_id, lead_id) WHERE status = 'waiting';
--     DROP TRIGGER IF EXISTS trg_sequence_queue_channel ON public.sequence_enrollment_queue;
--     DROP FUNCTION IF EXISTS public.sequence_queue_set_channel();
--     ALTER TABLE public.sequence_enrollment_queue DROP COLUMN IF EXISTS channel;
--     (only safe while no waiting SMS queue row exists)
--   Applied: local <PENDING> / stage <PENDING> / prod HELD.

BEGIN;

ALTER TABLE public.sequence_enrollment_queue
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms'));

CREATE OR REPLACE FUNCTION public.sequence_queue_set_channel() RETURNS TRIGGER
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

DROP TRIGGER IF EXISTS trg_sequence_queue_channel ON public.sequence_enrollment_queue;
CREATE TRIGGER trg_sequence_queue_channel
  BEFORE INSERT ON public.sequence_enrollment_queue
  FOR EACH ROW EXECUTE FUNCTION public.sequence_queue_set_channel();

-- One waiting "next sequence" per lead PER CHANNEL. New index first, then drop the old, so there is never a gap.
CREATE UNIQUE INDEX IF NOT EXISTS uq_enrollment_queue_waiting_lead_channel
  ON public.sequence_enrollment_queue (tenant_id, lead_id, channel)
  WHERE status = 'waiting';

DROP INDEX IF EXISTS public.uq_enrollment_queue_waiting_lead;

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('275_outreach_queue_channel.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
