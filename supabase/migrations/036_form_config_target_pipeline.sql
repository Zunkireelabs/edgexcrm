ALTER TABLE form_configs
  ADD COLUMN target_pipeline_id UUID REFERENCES pipelines(id) ON DELETE SET NULL;

COMMENT ON COLUMN form_configs.target_pipeline_id IS
  'Optional pipeline that submissions route to. NULL = tenant default pipeline. Lead lands at the pipeline''s first/default stage.';
