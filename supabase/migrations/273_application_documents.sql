-- Migration 273: Link applicant documents to a university application (and the note they were attached in)
--
-- Additive only. Wrapped in BEGIN/COMMIT.
--   Expected before/after row counts: applicant_documents: unchanged (2 new nullable columns, 2 partial
--     indexes, and the document_type CHECK widened by two values — no row is touched or rejected).
--   Rollback: ALTER TABLE applicant_documents DROP COLUMN IF EXISTS application_id, DROP COLUMN IF EXISTS application_note_id;
--             then re-add applicant_documents_document_type_check WITHOUT 'conditional_offer'/'unconditional_offer'
--             (only safe while no row uses those two values).
--   Applied: stage HELD (rides deploy-staging.yml) / prod HELD (rides the production-db approval gate).
--
-- education_consultancy: counselors attach the university's offer letters (offer / conditional / unconditional)
-- to a note on the application page. The Documents section then groups those files under the application's
-- name. A document keeps belonging to the student: deleting the application or the note only clears the link
-- (ON DELETE SET NULL) — the file and its record stay in the student's Documents.
--
-- Two new document types so "conditional" and "unconditional" are separate from a plain "offer letter".
-- The type list is a CHECK constraint, so it is dropped and re-added with the full list (idempotent).

BEGIN;

ALTER TABLE applicant_documents
  ADD COLUMN IF NOT EXISTS application_id      UUID REFERENCES applications(id)      ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS application_note_id UUID REFERENCES application_notes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_applicant_documents_application
  ON applicant_documents (application_id) WHERE application_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_applicant_documents_application_note
  ON applicant_documents (application_note_id) WHERE application_note_id IS NOT NULL;

ALTER TABLE applicant_documents DROP CONSTRAINT IF EXISTS applicant_documents_document_type_check;
ALTER TABLE applicant_documents ADD CONSTRAINT applicant_documents_document_type_check CHECK (document_type IN (
  'passport', 'marksheet', 'transcript', 'certificate', 'cv', 'recommendation_letter',
  'financial_document', 'bank_statement', 'english_test_result', 'offer_letter',
  'conditional_offer', 'unconditional_offer',
  'visa_document', 'identity_document', 'other'
));

INSERT INTO public.schema_migrations (version) VALUES ('273_application_documents.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
