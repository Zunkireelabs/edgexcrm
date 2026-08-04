#!/usr/bin/env bash
# seed-application-pipelines-local.sh — dummy data for the Admizz Local (education_consultancy)
# application-country-pipelines feature: Default Pipeline stages, 4 country pipelines
# (Australia/UK/Canada/USA) cloned from Default, and ~18 sample applications spread
# across them so the new UI has something real to render. Idempotent: safe to re-run.
#
#   ./scripts/seed-application-pipelines-local.sh
set -euo pipefail

LOCAL_DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
TENANT_ID="22222222-2222-2222-2222-222222222222"

echo "→ Seeding application pipelines + stages + dummy applications for Admizz Local..."

psql "$LOCAL_DB" -v ON_ERROR_STOP=1 <<SQL

BEGIN;

-- 1. Stages for the tenant's existing Default Pipeline
DO \$\$
DECLARE
  default_pid UUID;
BEGIN
  SELECT id INTO default_pid FROM application_pipelines
  WHERE tenant_id = '$TENANT_ID' AND slug = 'default-pipeline';

  INSERT INTO application_stages (tenant_id, pipeline_id, name, slug, position, color, is_default, is_terminal, terminal_type)
  VALUES
    ('$TENANT_ID', default_pid, 'Shortlisted', 'shortlisted', 0, '#6b7280', true, false, NULL),
    ('$TENANT_ID', default_pid, 'Documents Collection', 'documents-collection', 1, '#3b82f6', false, false, NULL),
    ('$TENANT_ID', default_pid, 'Application Submitted', 'application-submitted', 2, '#f59e0b', false, false, NULL),
    ('$TENANT_ID', default_pid, 'Offer Received', 'offer-received', 3, '#8b5cf6', false, false, NULL),
    ('$TENANT_ID', default_pid, 'Deposit Paid', 'deposit-paid', 4, '#06b6d4', false, false, NULL),
    ('$TENANT_ID', default_pid, 'Enrolled', 'enrolled', 5, '#22c55e', false, true, 'won'),
    ('$TENANT_ID', default_pid, 'Rejected', 'rejected', 6, '#ef4444', false, true, 'lost')
  ON CONFLICT (tenant_id, pipeline_id, slug) DO NOTHING;
END \$\$;

-- 2. Countries (drives the "one pipeline per country" list in the pipeline settings UI)
INSERT INTO countries (tenant_id, name, is_active)
VALUES
  ('$TENANT_ID', 'Australia', true),
  ('$TENANT_ID', 'United Kingdom', true),
  ('$TENANT_ID', 'Canada', true),
  ('$TENANT_ID', 'USA', true)
ON CONFLICT (tenant_id, name) DO NOTHING;

-- 3. One pipeline per country, cloning the Default Pipeline's stage set
--    (slug algorithm matches ensureApplicationPipelineForCountry() / migration 197)
DO \$\$
DECLARE
  default_pid UUID;
  country_row RECORD;
  new_pid UUID;
  stage_row RECORD;
  cslug TEXT;
BEGIN
  SELECT id INTO default_pid FROM application_pipelines
  WHERE tenant_id = '$TENANT_ID' AND slug = 'default-pipeline';

  FOR country_row IN
    SELECT name FROM countries WHERE tenant_id = '$TENANT_ID' AND is_active = true
  LOOP
    cslug := trim(both '-' from lower(regexp_replace(country_row.name, '[^a-zA-Z0-9]+', '-', 'g')));

    INSERT INTO application_pipelines (tenant_id, name, slug, is_default, position, is_active)
    VALUES ('$TENANT_ID', country_row.name, cslug, false, 0, true)
    ON CONFLICT (tenant_id, slug) DO NOTHING
    RETURNING id INTO new_pid;

    IF new_pid IS NOT NULL THEN
      FOR stage_row IN
        SELECT name, slug, position, color, is_default, is_terminal, terminal_type
        FROM application_stages WHERE tenant_id = '$TENANT_ID' AND pipeline_id = default_pid
        ORDER BY position
      LOOP
        INSERT INTO application_stages (tenant_id, pipeline_id, name, slug, position, color, is_default, is_terminal, terminal_type)
        VALUES ('$TENANT_ID', new_pid, stage_row.name, stage_row.slug, stage_row.position, stage_row.color, stage_row.is_default, stage_row.is_terminal, stage_row.terminal_type)
        ON CONFLICT (tenant_id, pipeline_id, slug) DO NOTHING;
      END LOOP;
    END IF;
    new_pid := NULL;
  END LOOP;
END \$\$;

-- 4. Dummy applications: pick from existing local leads, spread across country
--    pipelines/stages/universities so the Kanban + list views have real rows to show.
DO \$\$
DECLARE
  counselor_uid UUID := 'de1dd86b-b489-4a8b-8ef2-3af2fcbadfaf';
  lead_ids UUID[];
  app_specs RECORD;
BEGIN
  SELECT array_agg(id ORDER BY created_at) INTO lead_ids
  FROM leads WHERE tenant_id = '$TENANT_ID' AND deleted_at IS NULL;

  IF array_length(lead_ids, 1) IS NULL OR array_length(lead_ids, 1) < 5 THEN
    RAISE NOTICE 'Not enough local leads to seed applications, skipping.';
    RETURN;
  END IF;

  FOR app_specs IN
    SELECT * FROM (VALUES
      (0,  'Australia',       'Monash University',                 'Master of IT',                'Feb 2027', 'application-submitted', 21500.00, false, false),
      (1,  'Australia',       'University of Melbourne',            'Master of Data Science',       'Jul 2027', 'shortlisted',            24000.00, false, false),
      (2,  'Australia',       'Deakin University',                  'Bachelor of Business',         'Feb 2027', 'offer-received',         18500.00, true,  false),
      (3,  'United Kingdom',  'University of Manchester',           'MSc Computer Science',         'Sep 2026', 'documents-collection',   26000.00, false, false),
      (4,  'United Kingdom',  'Coventry University',                'MBA',                          'Jan 2027', 'application-submitted',  19800.00, false, false),
      (5,  'United Kingdom',  'University of Leeds',                'MSc Data Analytics',           'Sep 2026', 'enrolled',               25500.00, true,  true),
      (6,  'Canada',          'University of Toronto',              'Master of Engineering',        'Sep 2026', 'shortlisted',            29500.00, false, false),
      (7,  'Canada',          'Conestoga College',                  'PG Diploma Business Analytics','May 2027', 'offer-received',         16800.00, true,  false),
      (8,  'Canada',          'Seneca College',                     'PG Diploma IT Solutions',      'Jan 2027', 'deposit-paid',           15900.00, true,  true),
      (9,  'USA',             'Arizona State University',           'MS Computer Science',          'Aug 2027', 'application-submitted',  32000.00, false, false),
      (10, 'USA',             'Northeastern University',            'MS Information Systems',       'Jan 2027', 'shortlisted',            36500.00, false, false),
      (11, 'Australia',       'RMIT University',                    'Master of Cyber Security',     'Jul 2027', 'documents-collection',   23000.00, false, false),
      (12, 'United Kingdom',  'University of Birmingham',           'MSc Finance',                  'Sep 2026', 'rejected',               24500.00, false, true),
      (13, 'Canada',          'Humber College',                     'PG Diploma Marketing',         'May 2027', 'application-submitted',  15200.00, false, false),
      (14, 'Australia',       'University of Adelaide',             'Master of Nursing',            'Feb 2027', 'enrolled',               22800.00, true,  true),
      (15, 'USA',             'University of Texas at Dallas',      'MS Business Analytics',        'Aug 2027', 'offer-received',         33500.00, true,  false),
      (16, 'United Kingdom',  'Coventry University',                'MSc Cyber Security',           'Jan 2027', 'shortlisted',            20500.00, false, false),
      (17, 'Canada',          'Fanshawe College',                   'PG Diploma Project Management','Sep 2026', 'documents-collection',   14900.00, false, false)
    ) AS t(idx, country, university, program, intake, stage_slug, tuition, fee_paid, deposit_paid)
  LOOP
    INSERT INTO applications (
      tenant_id, lead_id, assigned_to, created_by, university_name, program_name,
      intake_term, country, countries, pipeline_id, stage_id, status,
      application_fee_paid, tuition_fee, deposit_paid
    )
    SELECT
      '$TENANT_ID',
      lead_ids[(app_specs.idx % array_length(lead_ids, 1)) + 1],
      counselor_uid,
      counselor_uid,
      app_specs.university,
      app_specs.program,
      app_specs.intake,
      app_specs.country,
      ARRAY[app_specs.country],
      ap.id,
      st.id,
      app_specs.stage_slug,
      app_specs.fee_paid,
      app_specs.tuition,
      app_specs.deposit_paid
    FROM application_pipelines ap
    JOIN application_stages st ON st.pipeline_id = ap.id AND st.slug = app_specs.stage_slug
    WHERE ap.tenant_id = '$TENANT_ID' AND ap.name = app_specs.country
    ON CONFLICT DO NOTHING;
  END LOOP;
END \$\$;

COMMIT;
SQL

echo "→ Done. Application pipelines summary:"
psql "$LOCAL_DB" -c "
  SELECT ap.name AS pipeline, count(a.id) AS applications
  FROM application_pipelines ap
  LEFT JOIN applications a ON a.pipeline_id = ap.id AND a.deleted_at IS NULL
  WHERE ap.tenant_id = '$TENANT_ID'
  GROUP BY ap.name ORDER BY ap.name;
"
