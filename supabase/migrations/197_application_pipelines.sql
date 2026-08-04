BEGIN;

CREATE TABLE IF NOT EXISTS application_pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_application_pipelines_tenant ON application_pipelines(tenant_id);

ALTER TABLE application_pipelines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "application_pipelines_select" ON application_pipelines;
CREATE POLICY "application_pipelines_select" ON application_pipelines
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "application_pipelines_insert" ON application_pipelines;
CREATE POLICY "application_pipelines_insert" ON application_pipelines
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "application_pipelines_update" ON application_pipelines;
CREATE POLICY "application_pipelines_update" ON application_pipelines
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "application_pipelines_delete" ON application_pipelines;
CREATE POLICY "application_pipelines_delete" ON application_pipelines
  FOR DELETE USING (is_tenant_admin(tenant_id));

DROP TRIGGER IF EXISTS trigger_application_pipelines_updated_at ON application_pipelines;
CREATE TRIGGER trigger_application_pipelines_updated_at
  BEFORE UPDATE ON application_pipelines FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Single-default enforcement, mirroring ensure_single_default_deal_pipeline()
-- (047_deal_pipelines.sql). Without this, PATCH /api/v1/application-pipelines/[id]
-- (reachable from the pipeline settings modal's "Set as default" checkbox) can leave
-- a tenant with 0 or 2+ pipelines flagged is_default — and every .eq("is_default",
-- true).maybeSingle() lookup in pipeline-resolution.ts errors on 2+ rows, which the
-- caller silently treats as "no default pipeline found" (new country pipelines then
-- get zero cloned stages; the zero-declared-destination fallback stops resolving).
CREATE OR REPLACE FUNCTION ensure_single_default_application_pipeline()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE application_pipelines
    SET is_default = false
    WHERE tenant_id = NEW.tenant_id
      AND id != NEW.id
      AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_ensure_single_default_application_pipeline ON application_pipelines;
CREATE TRIGGER trigger_ensure_single_default_application_pipeline
  BEFORE INSERT OR UPDATE OF is_default ON application_pipelines
  FOR EACH ROW
  WHEN (NEW.is_default = true)
  EXECUTE FUNCTION ensure_single_default_application_pipeline();

ALTER TABLE application_stages ADD COLUMN IF NOT EXISTS pipeline_id
  UUID REFERENCES application_pipelines(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_application_stages_pipeline ON application_stages(pipeline_id);

ALTER TABLE applications ADD COLUMN IF NOT EXISTS pipeline_id
  UUID REFERENCES application_pipelines(id);

CREATE INDEX IF NOT EXISTS idx_applications_pipeline ON applications(pipeline_id);

ALTER TABLE application_stages DROP CONSTRAINT IF EXISTS application_stages_tenant_id_slug_key;

ALTER TABLE application_stages DROP CONSTRAINT IF EXISTS application_stages_tenant_pipeline_slug_key;
ALTER TABLE application_stages ADD CONSTRAINT application_stages_tenant_pipeline_slug_key
  UNIQUE (tenant_id, pipeline_id, slug);

-- The application-pipelines UI/API (stage editor, create/update/delete routes) was
-- built assuming application_stages has a writable is_terminal boolean alongside
-- terminal_type, mirroring how leads.pipeline_stages already works. That column
-- never existed here (application_stages only ever had terminal_type). Add it for
-- real rather than rewrite every read/write site that already assumes it exists.
ALTER TABLE application_stages ADD COLUMN IF NOT EXISTS is_terminal BOOLEAN NOT NULL DEFAULT false;

UPDATE application_stages
SET is_terminal = true
WHERE terminal_type IS NOT NULL AND is_terminal = false;

-- Data migration
DO $$
DECLARE
  tenant_row RECORD;
  default_pipeline_id UUID;
  country_pipeline_id UUID;
  stage_row RECORD;
  country_name TEXT;
  country_slug TEXT;
  existing_pipeline_count INTEGER;
BEGIN
  FOR tenant_row IN
    SELECT id, industry_id FROM tenants WHERE industry_id = 'education_consultancy'
  LOOP
    -- 1. Seed a Default Pipeline for every education_consultancy tenant
    INSERT INTO application_pipelines (tenant_id, name, slug, is_default, position, is_active)
    VALUES (tenant_row.id, 'Default Pipeline', 'default-pipeline', true, 0, true)
    ON CONFLICT (tenant_id, slug) DO NOTHING
    RETURNING id INTO default_pipeline_id;

    -- If the default pipeline already existed (ON CONFLICT), fetch it
    IF default_pipeline_id IS NULL THEN
      SELECT id INTO default_pipeline_id
      FROM application_pipelines
      WHERE tenant_id = tenant_row.id AND slug = 'default-pipeline';
    END IF;

    -- 2. Backfill existing application_stages rows with pipeline_id = default pipeline
    UPDATE application_stages
    SET pipeline_id = default_pipeline_id
    WHERE tenant_id = tenant_row.id AND pipeline_id IS NULL;

    -- 3. Backfill existing applications rows with pipeline_id = default pipeline
    UPDATE applications
    SET pipeline_id = default_pipeline_id
    WHERE tenant_id = tenant_row.id AND pipeline_id IS NULL;

    -- 4. Seed one additional pipeline per active country row.
    -- Slug algorithm MUST match ensureApplicationPipelineForCountry() in
    -- src/lib/applications/pipeline-resolution.ts (and the POST /api/v1/application-pipelines
    -- route's own slugify) — country names are free-text admin input (up to 255 chars,
    -- no character restriction), so a punctuation-only-vs-regex mismatch here previously
    -- meant a country like "Korea, South" got a different slug from this backfill than
    -- from the live create-pipeline path, producing a silent duplicate pipeline the next
    -- time that country was deleted/recreated.
    FOR country_name, country_slug IN
      SELECT name, trim(both '-' from lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')))
      FROM countries
      WHERE tenant_id = tenant_row.id AND is_active = true
    LOOP
      -- Skip if slug would collide with the default pipeline slug
      IF country_slug = 'default-pipeline' THEN
        country_slug := country_slug || '-' || substr(tenant_row.id::text, 1, 8);
      END IF;

      SELECT COUNT(*) INTO existing_pipeline_count
      FROM application_pipelines
      WHERE tenant_id = tenant_row.id AND slug = country_slug;

      IF existing_pipeline_count = 0 THEN
        INSERT INTO application_pipelines (tenant_id, name, slug, is_default, position, is_active)
        VALUES (tenant_row.id, country_name, country_slug, false, 0, true)
        RETURNING id INTO country_pipeline_id;

        -- 5. Clone the Default pipeline's full stage set into the new country pipeline
        FOR stage_row IN
          SELECT name, slug, position, color, is_default, is_terminal, terminal_type
          FROM application_stages
          WHERE tenant_id = tenant_row.id AND pipeline_id = default_pipeline_id
          ORDER BY position
        LOOP
          INSERT INTO application_stages (
            tenant_id, pipeline_id, name, slug, position, color,
            is_default, is_terminal, terminal_type
          )
          VALUES (
            tenant_row.id, country_pipeline_id,
            stage_row.name, stage_row.slug, stage_row.position, stage_row.color,
            stage_row.is_default, stage_row.is_terminal, stage_row.terminal_type
          )
          ON CONFLICT (tenant_id, pipeline_id, slug) DO NOTHING;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

INSERT INTO public.schema_migrations (version) VALUES ('197_application_pipelines.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;