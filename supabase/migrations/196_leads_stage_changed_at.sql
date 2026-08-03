BEGIN;

ALTER TABLE leads ADD COLUMN stage_changed_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE leads SET stage_changed_at = updated_at;

COMMIT;