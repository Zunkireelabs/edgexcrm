-- F3: per-form API key binding
-- form_id NULL = key works for any form in the tenant (non-breaking default)
ALTER TABLE integration_keys
  ADD COLUMN IF NOT EXISTS form_id uuid REFERENCES form_configs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_integration_keys_form_id ON integration_keys(form_id);

-- raw_key column is dead: not referenced in code, NULL on all existing rows
ALTER TABLE integration_keys DROP COLUMN IF EXISTS raw_key;
