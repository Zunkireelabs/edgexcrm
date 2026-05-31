-- Per-form default UTM values (used when the form URL has no ?utm_... params).
-- URL params still override these defaults at submission time.
ALTER TABLE form_configs ADD COLUMN attribution JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN form_configs.attribution IS
  'Per-form default UTM values: { default_source, default_medium, default_campaign }. URL params still override these.';
