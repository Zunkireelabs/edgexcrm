-- Migration 240: link an applicant_documents row to a specific Qualification level
--
-- Uploading a Marksheet/Transcript/Certificate today has no way to say WHICH
-- qualification (SEE/+2/Bachelor's/Master's) it belongs to -- just a flat
-- `document_type` category. This adds a nullable tag column so the Student
-- Details popup's Qualification cards can show "N document(s) attached" per
-- level. No CHECK constraint -- kept loose the same way `document_type`
-- itself and `degree_level` are, not a rigid enum.
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: 0 rows touched (schema-only, new nullable column).
--   Rollback: ALTER TABLE applicant_documents DROP COLUMN IF EXISTS qualification_level;
--   NOT YET APPLIED to any database (stage or prod) — written for review only,
--   per this repo's "no DB access" rule. Apply via the normal PR pipeline.
--
-- Passport & Citizenship linking needs NO equivalent column -- the existing
-- `document_type` values ('passport', 'identity_document') already are that
-- link, since Passport & Citizenship is a single fixed section per lead.

BEGIN;

ALTER TABLE applicant_documents
  ADD COLUMN IF NOT EXISTS qualification_level TEXT;

INSERT INTO public.schema_migrations (version) VALUES ('240_applicant_document_qualification_link.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
