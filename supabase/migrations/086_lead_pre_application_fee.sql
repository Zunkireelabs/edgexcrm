-- 084_lead_pre_application_fee.sql
-- Pre-Application fee tracking at the lead (student) level.
-- Surfaced in the "Pre Application" card on the lead detail (education_consultancy).
-- Three-state fee status + optional amount (when paid) + optional notes.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS pre_app_fee_status TEXT
    CHECK (pre_app_fee_status IN ('paid', 'unpaid', 'waiver')),
  ADD COLUMN IF NOT EXISTS pre_app_fee_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS pre_app_fee_notes TEXT;

COMMENT ON COLUMN leads.pre_app_fee_status IS 'Pre-application fee state: paid | unpaid | waiver (NULL = not set)';
COMMENT ON COLUMN leads.pre_app_fee_amount IS 'Amount paid when pre_app_fee_status = paid';
COMMENT ON COLUMN leads.pre_app_fee_notes IS 'Optional notes for the pre-application fee';
