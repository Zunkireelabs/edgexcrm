-- Per-form email autoresponder config, stored as JSONB on form_configs
-- (mirrors the existing steps/branding/attribution JSONB pattern).
-- Shape: { enabled: bool, fire_mode: 'every'|'first', subject: text, body_html: text }
-- Nullable: existing forms get NULL → autoresponder?.enabled is undefined → no-op.
alter table form_configs add column if not exists autoresponder jsonb;
