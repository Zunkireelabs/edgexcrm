-- Lead Tags
-- =========
-- Adds a `tags` array column to the leads table for industry-specific
-- categorization. The first user is education_consultancy: leads get
-- tagged "student" or "parent" via the check-in flow and the public form.
--
-- NOTE: this migration was originally applied to staging/prod directly
-- via Supabase MCP on 2026-05-24 by Anish; the commit that introduced
-- the feature code did not include the SQL. This file exists to keep
-- the migrations folder in sync with the DB so future fresh installs
-- have the same schema. Uses IF NOT EXISTS guards so re-applying is a
-- no-op.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

-- GIN index for tag membership queries (e.g. WHERE tags @> ARRAY['student']).
CREATE INDEX IF NOT EXISTS idx_leads_tags ON leads USING GIN (tags);
