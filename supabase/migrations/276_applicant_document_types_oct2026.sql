-- Migration 276: four more applicant document types, so each of the client's nine document categories has something to file under.
--
-- Client request (WhatsApp, Oct 2026) for education tenants: Documents are grouped under nine headings (Personal Identity,
-- Academic Records, English Proficiency, Application Essays & References, Work Experience & Gap, Financial Documents,
-- University Offers & Confirmations, Visa & Pre-Departure, Enrollment). Seven of them already had a type; these four do not:
--   statement_of_purpose  -> Application Essays & References
--   experience_letter     -> Work Experience & Gap
--   gap_explanation       -> Work Experience & Gap
--   enrollment_document   -> Enrollment
--
-- The CATEGORY of a document is computed from its type in code (src/lib/documents/constants.ts) and is not stored, so this
-- changes no existing row: it only WIDENS the list of allowed types, exactly as migration 273 did for the offer types.
--
-- Numbered 276 because 274 and 275 belong to the Outreach SMS channel PR (#627); numbers are globally unique.
--
--   Expected before/after row counts: applicant_documents N -> N (0 rows inserted, updated or deleted).
--   Rollback (only safe while no row uses one of the four new types):
--     ALTER TABLE applicant_documents DROP CONSTRAINT IF EXISTS applicant_documents_document_type_check;
--     ALTER TABLE applicant_documents ADD CONSTRAINT applicant_documents_document_type_check CHECK (document_type IN (
--       'passport', 'marksheet', 'transcript', 'certificate', 'cv', 'recommendation_letter',
--       'financial_document', 'bank_statement', 'english_test_result', 'offer_letter',
--       'conditional_offer', 'unconditional_offer',
--       'visa_document', 'identity_document', 'other'
--     ));
--   Applied: local <PENDING> / stage <PENDING> / prod HELD.

BEGIN;

ALTER TABLE applicant_documents DROP CONSTRAINT IF EXISTS applicant_documents_document_type_check;
ALTER TABLE applicant_documents ADD CONSTRAINT applicant_documents_document_type_check CHECK (document_type IN (
  'passport', 'marksheet', 'transcript', 'certificate', 'cv', 'recommendation_letter',
  'financial_document', 'bank_statement', 'english_test_result', 'offer_letter',
  'conditional_offer', 'unconditional_offer',
  'visa_document', 'identity_document',
  'statement_of_purpose', 'experience_letter', 'gap_explanation', 'enrollment_document',
  'other'
));

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('276_applicant_document_types_oct2026.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
