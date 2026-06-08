-- F4: Per-key origin allowlist for the public submit endpoint.
-- NULL or empty array = key works from any origin (preserves current behaviour; non-breaking).
ALTER TABLE integration_keys ADD COLUMN IF NOT EXISTS allowed_origins text[];
