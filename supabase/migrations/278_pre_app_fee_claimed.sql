-- Migration 278: allow 'claimed' as a pre-application (processing) fee status.
--
-- A counsellor reports a received fee as 'claimed'; an owner/admin later verifies it
-- (-> paid / waiver) or rejects it (-> unpaid). 'claimed' never blocks consent,
-- applications or stage moves; it is an audit marker only.
--
-- Additive: widens one CHECK constraint, touches no rows.
--   Expected before/after row counts: leads: unchanged (0 rows touched).
--   Rollback: UPDATE leads SET pre_app_fee_status = NULL, pre_app_fee_amount = NULL
--     WHERE pre_app_fee_status = 'claimed';  then re-add the CHECK with
--     ('paid','unpaid','waiver') only (see 086_lead_pre_application_fee.sql).
--   Applied: stage HELD / prod HELD (rides the deploy pipeline migrate job).

BEGIN;

-- Drop whichever CHECK currently guards this column (084 created it inline, so its
-- name was auto-generated), without assuming the name.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'public.leads'::regclass
      AND con.contype = 'c'
      AND att.attname = 'pre_app_fee_status'
  LOOP
    EXECUTE format('ALTER TABLE public.leads DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_pre_app_fee_status_check
  CHECK (pre_app_fee_status IN ('paid', 'unpaid', 'waiver', 'claimed'));

COMMENT ON COLUMN public.leads.pre_app_fee_status IS
  'Pre-application fee state: paid | unpaid | waiver | claimed (reported by a counsellor, awaiting owner/admin verification) (NULL = not set)';

INSERT INTO public.schema_migrations (version) VALUES ('278_pre_app_fee_claimed.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
