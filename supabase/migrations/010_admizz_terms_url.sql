-- Migration 010: Add terms_url to Admizz form checkbox fields
-- Fixes Terms & Conditions link pointing to /terms (non-existent page)
-- Sets correct URL: https://admizzeducation.com/privacy-policy

-- Update all Admizz form_configs: add terms_url to any terms_accepted checkbox field
UPDATE form_configs
SET steps = (
  SELECT jsonb_agg(
    jsonb_set(
      step,
      '{fields}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN field->>'name' = 'terms_accepted'
            THEN field || '{"terms_url": "https://admizzeducation.com/privacy-policy"}'::jsonb
            ELSE field
          END
        )
        FROM jsonb_array_elements(step->'fields') AS field
      )
    )
  )
  FROM jsonb_array_elements(steps) AS step
)
WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88';
