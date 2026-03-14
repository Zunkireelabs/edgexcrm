-- Phase 2C: GIN index on leads.custom_fields for JSONB query performance
CREATE INDEX IF NOT EXISTS idx_leads_custom_fields_gin
ON leads USING gin (custom_fields);
