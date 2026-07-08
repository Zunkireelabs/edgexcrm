


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."activity_type" AS ENUM (
    'call',
    'email',
    'meeting'
);


ALTER TYPE "public"."activity_type" OWNER TO "postgres";


CREATE TYPE "public"."call_outcome" AS ENUM (
    'connected',
    'left_voicemail',
    'no_answer',
    'busy',
    'wrong_number'
);


ALTER TYPE "public"."call_outcome" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_education_display_ids"("p_tenant" "uuid", "p_prefix" "text", "p_lead_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $_$
DECLARE
  v_base bigint;
BEGIN
  -- Serialize per tenant so two concurrent moves can't grab the same block.
  PERFORM pg_advisory_xact_lock(hashtext(p_tenant::text || ':' || p_prefix));

  -- Numeric max (NOT string order — avoids the ADM-99/ADM-100 bug).
  SELECT coalesce(max((regexp_replace(display_id, '[^0-9]', '', 'g'))::bigint), 0)
    INTO v_base
  FROM leads
  WHERE tenant_id = p_tenant
    AND display_id ~ ('^' || p_prefix || '-[0-9]+$');

  WITH targets AS (
    SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
    FROM leads
    WHERE tenant_id = p_tenant
      AND id = ANY(p_lead_ids)
      AND display_id IS NULL
  )
  UPDATE leads l
  SET display_id = p_prefix || '-' ||
        lpad((v_base + t.rn)::text, greatest(3, length((v_base + t.rn)::text)), '0')
  FROM targets t
  WHERE l.id = t.id;
END;
$_$;


ALTER FUNCTION "public"."assign_education_display_ids"("p_tenant" "uuid", "p_prefix" "text", "p_lead_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_notification"("p_tenant_id" "uuid", "p_user_id" "uuid", "p_type" "text", "p_title" "text", "p_message" "text", "p_link" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_notification_id UUID;
BEGIN
  INSERT INTO notifications (tenant_id, user_id, type, title, message, link)
  VALUES (p_tenant_id, p_user_id, p_type, p_title, p_message, p_link)
  RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$$;


ALTER FUNCTION "public"."create_notification"("p_tenant_id" "uuid", "p_user_id" "uuid", "p_type" "text", "p_title" "text", "p_message" "text", "p_link" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_single_default_deal_pipeline"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE deal_pipelines
    SET is_default = false
    WHERE tenant_id = NEW.tenant_id
      AND id != NEW.id
      AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."ensure_single_default_deal_pipeline"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_single_default_pipeline"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE pipelines
    SET is_default = false
    WHERE tenant_id = NEW.tenant_id
      AND id != NEW.id
      AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."ensure_single_default_pipeline"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_scoped_leads"("p_tenant_id" "uuid", "p_scope_mode" "text", "p_user_id" "uuid", "p_branch_id" "uuid" DEFAULT NULL::"uuid", "p_branch_member_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_pipeline_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_list_id" "uuid" DEFAULT NULL::"uuid", "p_exclude_list_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_status" "text" DEFAULT NULL::"text", "p_search" "text" DEFAULT NULL::"text", "p_include_converted" boolean DEFAULT false, "p_only_deleted" boolean DEFAULT false, "p_require_stage" boolean DEFAULT false, "p_order_by" "text" DEFAULT 'last_activity_at'::"text", "p_assigned_to" "uuid" DEFAULT NULL::"uuid", "p_page" integer DEFAULT 1, "p_page_size" integer DEFAULT 20) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH filtered AS (
    SELECT l.*
    FROM leads l
    WHERE l.tenant_id = p_tenant_id
      AND (CASE WHEN p_only_deleted THEN l.deleted_at IS NOT NULL ELSE l.deleted_at IS NULL END)
      AND (p_include_converted OR l.converted_at IS NULL)
      AND (NOT p_require_stage OR l.stage_id IS NOT NULL)
      AND (
        (p_scope_mode = 'self' AND (
          l.assigned_to = p_user_id
          OR EXISTS (SELECT 1 FROM lead_collaborators lc WHERE lc.lead_id = l.id AND lc.user_id = p_user_id)
          OR EXISTS (SELECT 1 FROM lead_branches lb WHERE lb.lead_id = l.id AND lb.assigned_to = p_user_id)
        ))
        OR (p_scope_mode = 'branch' AND (
          (p_branch_member_ids IS NOT NULL AND l.assigned_to = ANY (p_branch_member_ids))
          OR (l.assigned_to IS NULL AND p_branch_id IS NOT NULL AND l.branch_id = p_branch_id)
        ))
      )
      AND (p_assigned_to IS NULL OR l.assigned_to = p_assigned_to)
      AND (p_pipeline_ids IS NULL OR l.pipeline_id = ANY (p_pipeline_ids))
      AND (
        CASE
          WHEN p_list_id IS NOT NULL THEN l.list_id = p_list_id
          WHEN p_exclude_list_ids IS NOT NULL THEN (l.list_id IS NULL OR NOT (l.list_id = ANY (p_exclude_list_ids)))
          ELSE TRUE
        END
      )
      AND (p_status IS NULL OR l.status = p_status)
      AND (
        p_search IS NULL OR p_search = '' OR (
          l.first_name ILIKE '%' || p_search || '%'
          OR l.last_name ILIKE '%' || p_search || '%'
          OR l.email ILIKE '%' || p_search || '%'
          OR l.phone ILIKE '%' || p_search || '%'
        )
      )
  ),
  counted AS (
    SELECT f.*, count(*) OVER () AS total_count
    FROM filtered f
    ORDER BY
      CASE WHEN p_order_by = 'created_at' THEN f.created_at END DESC NULLS LAST,
      CASE WHEN p_order_by = 'last_activity_at' THEN f.last_activity_at END DESC NULLS LAST,
      f.id DESC
    LIMIT GREATEST(p_page_size, 0)
    OFFSET (GREATEST(p_page, 1) - 1) * GREATEST(p_page_size, 0)
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(counted) - 'total_count') FROM counted), '[]'::jsonb),
    'total', COALESCE((SELECT MAX(total_count) FROM counted), 0)
  );
$$;


ALTER FUNCTION "public"."get_scoped_leads"("p_tenant_id" "uuid", "p_scope_mode" "text", "p_user_id" "uuid", "p_branch_id" "uuid", "p_branch_member_ids" "uuid"[], "p_pipeline_ids" "uuid"[], "p_list_id" "uuid", "p_exclude_list_ids" "uuid"[], "p_status" "text", "p_search" "text", "p_include_converted" boolean, "p_only_deleted" boolean, "p_require_stage" boolean, "p_order_by" "text", "p_assigned_to" "uuid", "p_page" integer, "p_page_size" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_tenant_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid();
$$;


ALTER FUNCTION "public"."get_user_tenant_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_tenant_role"("p_tenant_id" "uuid") RETURNS character varying
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ SELECT role FROM tenant_users WHERE tenant_id = p_tenant_id AND user_id = auth.uid() LIMIT 1; $$;


ALTER FUNCTION "public"."get_user_tenant_role"("p_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_tenant_admin"("p_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenant_users
    WHERE tenant_id = p_tenant_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$;


ALTER FUNCTION "public"."is_tenant_admin"("p_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_education_display_id"("p_tenant" "uuid", "p_prefix" "text") RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    AS $_$
  select p_prefix || '-' || lpad(n::text, greatest(3, length(n::text)), '0')
  from (
    select coalesce(
      max((regexp_replace(display_id, '[^0-9]', '', 'g'))::bigint), 0
    ) + 1 as n
    from leads
    where tenant_id = p_tenant
      and display_id like p_prefix || '-%'
      and display_id ~ ('^' || p_prefix || '-[0-9]+$')
  ) sub;
$_$;


ALTER FUNCTION "public"."next_education_display_id"("p_tenant" "uuid", "p_prefix" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_import_sources"("p_tenant" "uuid", "p_staging_list" "uuid") RETURNS TABLE("source_label" "text", "raw_rows" integer, "dropped_rows" integer, "no_contact_rows" integer, "with_contact_rows" integer, "notes" "text", "sort_order" integer, "in_crm" bigint, "still_in_staging" bigint, "routed_out" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH exploded AS (
    SELECT
      TRIM(s) AS source_file,
      COALESCE(ll.is_staging, FALSE) AS in_staging   -- in ANY staging list?
    FROM leads l
    LEFT JOIN lead_lists ll ON ll.id = l.list_id
    CROSS JOIN LATERAL unnest(string_to_array(l.intake_source, ' | ')) AS s
    WHERE l.tenant_id = p_tenant
      AND l.deleted_at IS NULL
      AND l.intake_source IS NOT NULL
  ),
  agg AS (
    SELECT
      source_file,
      COUNT(*)                               AS in_crm,
      COUNT(*) FILTER (WHERE in_staging)     AS still_in_staging,
      COUNT(*) FILTER (WHERE NOT in_staging) AS routed_out
    FROM exploded
    GROUP BY source_file
  )
  SELECT
    lis.source_label, lis.raw_rows, lis.dropped_rows, lis.no_contact_rows,
    lis.with_contact_rows, lis.notes, lis.sort_order,
    COALESCE(a.in_crm, 0), COALESCE(a.still_in_staging, 0), COALESCE(a.routed_out, 0)
  FROM lead_import_sources lis
  LEFT JOIN agg a ON a.source_file = lis.source_label
  WHERE lis.tenant_id = p_tenant
    AND lis.staging_list_id = p_staging_list
  ORDER BY lis.sort_order;
$$;


ALTER FUNCTION "public"."reconcile_import_sources"("p_tenant" "uuid", "p_staging_list" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_proposal_number"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $_$
DECLARE v_base bigint;
BEGIN
  IF NEW.proposal_number IS NULL OR NEW.proposal_number = '' THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id::text || ':PROP'));
    SELECT coalesce(max((regexp_replace(proposal_number,'[^0-9]','','g'))::bigint),0)
      INTO v_base FROM proposals
      WHERE tenant_id = NEW.tenant_id AND proposal_number ~ '^PROP-[0-9]+$';
    NEW.proposal_number := 'PROP-' || lpad((v_base+1)::text, greatest(4, length((v_base+1)::text)), '0');
  END IF;
  RETURN NEW;
END;$_$;


ALTER FUNCTION "public"."set_proposal_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "primary_contact_email" "text",
    "notes" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "primary_contact_id" "uuid",
    "owner_id" "uuid"
);


ALTER TABLE "public"."accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."affiliates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "ref_code" "text" NOT NULL,
    "email" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "affiliates_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"])))
);


ALTER TABLE "public"."affiliates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "agent_type" "text" DEFAULT 'agent'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "agents_agent_type_check" CHECK (("agent_type" = ANY (ARRAY['agent'::"text", 'super_agent'::"text"])))
);


ALTER TABLE "public"."agents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."application_stages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" character varying(100) NOT NULL,
    "slug" character varying(100) NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "color" character varying(7) DEFAULT '#6b7280'::character varying,
    "is_default" boolean DEFAULT false,
    "terminal_type" character varying(10),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "application_stages_terminal_type_check" CHECK ((("terminal_type")::"text" = ANY (ARRAY[('won'::character varying)::"text", ('lost'::character varying)::"text"])))
);


ALTER TABLE "public"."application_stages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "assigned_to" "uuid",
    "university_name" "text" NOT NULL,
    "program_name" "text" NOT NULL,
    "intake_term" "text",
    "country" "text",
    "stage_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'shortlisted'::"text" NOT NULL,
    "offer_type" "text",
    "application_deadline" "date",
    "application_fee_paid" boolean DEFAULT false NOT NULL,
    "tuition_fee" numeric(14,2),
    "deposit_paid" boolean DEFAULT false NOT NULL,
    "offer_letter_url" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "agent_id" "uuid",
    "applied_date" "date",
    "intake_start_date" "date",
    CONSTRAINT "applications_offer_type_check" CHECK (("offer_type" = ANY (ARRAY['conditional'::"text", 'unconditional'::"text"])))
);


ALTER TABLE "public"."applications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."applications_backup_appuploads" (
    "id" "uuid",
    "tenant_id" "uuid",
    "lead_id" "uuid",
    "assigned_to" "uuid",
    "university_name" "text",
    "program_name" "text",
    "intake_term" "text",
    "country" "text",
    "stage_id" "uuid",
    "status" "text",
    "offer_type" "text",
    "application_deadline" "date",
    "application_fee_paid" boolean,
    "tuition_fee" numeric(14,2),
    "deposit_paid" boolean,
    "offer_letter_url" "text",
    "notes" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "agent_id" "uuid",
    "applied_date" "date",
    "intake_start_date" "date"
);


ALTER TABLE "public"."applications_backup_appuploads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attendance_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "tenant_user_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "work_date" "date" NOT NULL,
    "clock_in_at" timestamp with time zone,
    "clock_out_at" timestamp with time zone,
    "status" "text" DEFAULT 'present'::"text" NOT NULL,
    "source" "text" DEFAULT 'self_clock'::"text" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "attendance_records_source_check" CHECK (("source" = ANY (ARRAY['self_clock'::"text", 'manual'::"text"]))),
    CONSTRAINT "attendance_records_status_check" CHECK (("status" = ANY (ARRAY['present'::"text", 'absent'::"text", 'remote'::"text", 'half_day'::"text"])))
);


ALTER TABLE "public"."attendance_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "action" character varying(100) NOT NULL,
    "entity_type" character varying(50) NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "changes" "jsonb" DEFAULT '{}'::"jsonb",
    "ip_address" "inet",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."automation_email_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "lead_id" "uuid",
    "form_config_id" "uuid",
    "source" "text" NOT NULL,
    "to_email" "text" NOT NULL,
    "subject" "text",
    "status" "text" NOT NULL,
    "error" "text",
    "provider_message_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "automation_email_log_source_check" CHECK (("source" = ANY (ARRAY['form_autoresponder'::"text", 'stage_rule'::"text"]))),
    CONSTRAINT "automation_email_log_status_check" CHECK (("status" = ANY (ARRAY['sent'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."automation_email_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."branches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "manager_user_id" "uuid",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."branches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaign_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "campaign_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "match_id" "text" NOT NULL,
    "match_label" "text" DEFAULT ''::"text" NOT NULL,
    "home_team" "text",
    "away_team" "text",
    "home_score" integer,
    "away_score" integer,
    "outcome" "text",
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "source" "text" DEFAULT 'espn'::"text" NOT NULL,
    "locked" boolean DEFAULT false NOT NULL,
    "fetched_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "match_date" timestamp with time zone,
    "winner_email" "text",
    CONSTRAINT "campaign_results_outcome_check" CHECK (("outcome" = ANY (ARRAY['team_a'::"text", 'team_b'::"text", 'draw'::"text"]))),
    CONSTRAINT "campaign_results_source_check" CHECK (("source" = ANY (ARRAY['espn'::"text", 'manual'::"text"]))),
    CONSTRAINT "campaign_results_status_check" CHECK (("status" = ANY (ARRAY['scheduled'::"text", 'final'::"text"])))
);


ALTER TABLE "public"."campaign_results" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "type" "text" DEFAULT 'prediction_leaderboard'::"text" NOT NULL,
    "form_config_id" "uuid",
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "public_enabled" boolean DEFAULT false NOT NULL,
    "public_token" "text",
    CONSTRAINT "campaigns_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'final'::"text"])))
);


ALTER TABLE "public"."campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."class_enrollments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "class_id" "uuid" NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "fee_paid" boolean DEFAULT false NOT NULL,
    "fee_amount" numeric(14,2),
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."class_enrollments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."classes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "default_fee" numeric(14,2),
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."classes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."connected_email_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "provider" character varying(50) DEFAULT 'gmail'::character varying NOT NULL,
    "email" character varying(255) NOT NULL,
    "refresh_token" "text" NOT NULL,
    "access_token" "text",
    "token_expiry" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "display_name" "text"
);


ALTER TABLE "public"."connected_email_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."consent_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "title" "text" DEFAULT 'Student Consent & Authorization'::"text" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "require_drawn_signature" boolean DEFAULT false NOT NULL,
    "link_expiry_days" integer DEFAULT 14 NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."consent_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "account_id" "uuid" NOT NULL,
    "first_name" "text" NOT NULL,
    "last_name" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "title" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "assigned_to" "uuid",
    "notes" "text",
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "contacts_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"])))
);


ALTER TABLE "public"."contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "channel_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "external_contact_id" "text" NOT NULL,
    "contact_phone" "text",
    "contact_display_name" "text",
    "last_message_at" timestamp with time zone,
    "last_message_preview" "text",
    "last_message_direction" "text",
    "unread_count" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "snoozed_until" timestamp with time zone,
    "stage_tag" "text",
    "assignee_type" "text" DEFAULT 'unassigned'::"text" NOT NULL,
    "assigned_to_user_id" "uuid",
    "assigned_ai_agent_id" "uuid",
    "lead_id" "uuid",
    "contact_id" "uuid",
    "ai_autonomy" "text" DEFAULT 'off'::"text" NOT NULL,
    "meta" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "conversations_ai_autonomy_check" CHECK (("ai_autonomy" = ANY (ARRAY['off'::"text", 'suggest'::"text", 'autonomous'::"text"]))),
    CONSTRAINT "conversations_assignee_type_check" CHECK (("assignee_type" = ANY (ARRAY['unassigned'::"text", 'human'::"text", 'ai_agent'::"text"]))),
    CONSTRAINT "conversations_last_message_direction_check" CHECK (("last_message_direction" = ANY (ARRAY['inbound'::"text", 'outbound'::"text"]))),
    CONSTRAINT "conversations_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'closed'::"text", 'snoozed'::"text"])))
);


ALTER TABLE "public"."conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."countries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."countries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."courses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."courses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dashboards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "widgets" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "granted_position_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."dashboards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deal_contacts" (
    "deal_id" "uuid" NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "role" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "deal_contacts_role_check" CHECK (("role" = ANY (ARRAY['primary'::"text", 'technical'::"text", 'billing'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."deal_contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deal_pipelines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" character varying(100) NOT NULL,
    "slug" character varying(100) NOT NULL,
    "description" "text",
    "is_default" boolean DEFAULT false,
    "position" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."deal_pipelines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deal_stages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" character varying(100) NOT NULL,
    "slug" character varying(100) NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "color" character varying(7) DEFAULT '#6b7280'::character varying,
    "is_default" boolean DEFAULT false,
    "is_terminal" boolean DEFAULT false,
    "terminal_type" character varying(10),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "pipeline_id" "uuid" NOT NULL,
    "probability" smallint DEFAULT 50 NOT NULL,
    CONSTRAINT "deal_stages_probability_check" CHECK ((("probability" >= 0) AND ("probability" <= 100))),
    CONSTRAINT "deal_stages_terminal_type_check" CHECK ((("terminal_type")::"text" = ANY (ARRAY[('won'::character varying)::"text", ('lost'::character varying)::"text"])))
);


ALTER TABLE "public"."deal_stages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "account_id" "uuid",
    "primary_contact_id" "uuid",
    "stage_id" "uuid" NOT NULL,
    "amount" numeric(14,2),
    "currency" "text" DEFAULT 'NPR'::"text" NOT NULL,
    "close_date" "date",
    "owner_id" "uuid",
    "deal_type" "text",
    "priority" "text",
    "description" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "last_activity_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "pipeline_id" "uuid",
    "probability" smallint,
    CONSTRAINT "deals_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "deals_probability_check" CHECK ((("probability" IS NULL) OR (("probability" >= 0) AND ("probability" <= 100)))),
    CONSTRAINT "deals_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'won'::"text", 'lost'::"text"])))
);


ALTER TABLE "public"."deals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."departments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "lead_tenant_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."departments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_forward_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" character varying(255) NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "smtp_email" character varying(255),
    "smtp_password" "text",
    "smtp_host" character varying(255) DEFAULT 'smtp.gmail.com'::character varying,
    "smtp_port" integer DEFAULT 587,
    "pipeline_id" "uuid" NOT NULL,
    "stage_id" "uuid" NOT NULL,
    "subject" character varying(500) NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "email_account_id" "uuid",
    "from_name" character varying(255)
);


ALTER TABLE "public"."email_forward_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_sync_state" (
    "connected_email_account_id" "uuid" NOT NULL,
    "last_history_id" "text",
    "last_synced_at" timestamp with time zone,
    "last_error" "text",
    "consecutive_error_count" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."email_sync_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_threads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "connected_email_account_id" "uuid" NOT NULL,
    "gmail_thread_id" "text" NOT NULL,
    "lead_id" "uuid",
    "contact_id" "uuid",
    "subject" "text",
    "last_message_at" timestamp with time zone,
    "message_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."email_threads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."emails" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "thread_id" "uuid" NOT NULL,
    "connected_email_account_id" "uuid" NOT NULL,
    "direction" "text" NOT NULL,
    "from_email" "text" NOT NULL,
    "from_name" "text",
    "to_emails" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "cc_emails" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "bcc_emails" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "subject" "text",
    "body_html" "text",
    "body_text" "text",
    "gmail_message_id" "text" NOT NULL,
    "rfc_message_id" "text" NOT NULL,
    "in_reply_to" "text",
    "rfc_references" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "sent_at" timestamp with time zone,
    "received_at" timestamp with time zone,
    "sender_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "read_at" timestamp with time zone,
    CONSTRAINT "emails_direction_check" CHECK (("direction" = ANY (ARRAY['outbound'::"text", 'inbound'::"text"])))
);


ALTER TABLE "public"."emails" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employee_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_user_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "employment_type" "text",
    "employment_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "billable" boolean DEFAULT true NOT NULL,
    "weekly_capacity_hours" numeric DEFAULT 40 NOT NULL,
    "job_title" "text",
    "hire_date" "date",
    "date_of_birth" "date",
    "phone" "text",
    "address" "text",
    "photo_url" "text",
    "emergency_contact" "jsonb",
    "department_id" "uuid",
    "manager_tenant_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "employee_profiles_employment_status_check" CHECK (("employment_status" = ANY (ARRAY['active'::"text", 'on_leave'::"text", 'notice'::"text", 'terminated'::"text"]))),
    CONSTRAINT "employee_profiles_employment_type_check" CHECK (("employment_type" = ANY (ARRAY['full_time'::"text", 'part_time'::"text", 'contractor'::"text", 'intern'::"text"])))
);


ALTER TABLE "public"."employee_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employee_skills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "tenant_user_id" "uuid" NOT NULL,
    "skill_id" "uuid" NOT NULL,
    "proficiency" smallint,
    "years" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "employee_skills_proficiency_check" CHECK ((("proficiency" >= 1) AND ("proficiency" <= 5)))
);


ALTER TABLE "public"."employee_skills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "type" character varying(100) NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb",
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "attempts" integer DEFAULT 0,
    "last_error" "text",
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "events_status_check" CHECK ((("status")::"text" = ANY (ARRAY[('pending'::character varying)::"text", ('processing'::character varying)::"text", ('completed'::character varying)::"text", ('failed'::character varying)::"text"])))
);


ALTER TABLE "public"."events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" character varying(255) DEFAULT 'Default Form'::character varying NOT NULL,
    "is_active" boolean DEFAULT true,
    "steps" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "branding" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "redirect_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "slug" character varying(100) NOT NULL,
    "attribution" "jsonb" DEFAULT '{}'::"jsonb",
    "target_pipeline_id" "uuid",
    "autoresponder" "jsonb"
);


ALTER TABLE "public"."form_configs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."form_configs"."attribution" IS 'Per-form default UTM values (default_source/default_medium/default_campaign). URL params still override these.';



COMMENT ON COLUMN "public"."form_configs"."target_pipeline_id" IS 'Optional pipeline that submissions route to. NULL = tenant default pipeline. Lead lands at the pipeline''s first/default stage.';



CREATE TABLE IF NOT EXISTS "public"."holidays" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "name" "text" NOT NULL,
    "holiday_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."holidays" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inbox_channels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "external_account_id" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "access_token" "text",
    "webhook_verify_token_hash" "text",
    "connected_by_user_id" "uuid",
    "last_error" "text",
    "meta" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inbox_channels_provider_check" CHECK (("provider" = ANY (ARRAY['whatsapp'::"text", 'messenger'::"text", 'instagram'::"text", 'sandbox'::"text", 'email'::"text"]))),
    CONSTRAINT "inbox_channels_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'disconnected'::"text", 'error'::"text", 'pending'::"text"])))
);


ALTER TABLE "public"."inbox_channels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."industries" (
    "id" character varying(50) NOT NULL,
    "name" character varying(100) NOT NULL,
    "description" "text",
    "entity_type_label" character varying(100) NOT NULL,
    "entity_type_singular" character varying(100) NOT NULL,
    "icon" character varying(50),
    "default_pipeline_stages" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."industries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."integration_idempotency" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "endpoint" "text" NOT NULL,
    "response" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."integration_idempotency" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."integration_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" character varying(255) NOT NULL,
    "hashed_key" "text" NOT NULL,
    "permissions_detail" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "revoked_at" timestamp with time zone,
    "permissions" "text"[] DEFAULT '{read,write}'::"text"[] NOT NULL,
    "last_used_at" timestamp with time zone,
    "form_id" "uuid",
    "allowed_origins" "text"[]
);


ALTER TABLE "public"."integration_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invite_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "email" character varying(255) NOT NULL,
    "role" character varying(20) NOT NULL,
    "token" character varying(255) NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "accepted_at" timestamp with time zone,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "position_id" "uuid",
    CONSTRAINT "invite_tokens_role_check" CHECK ((("role")::"text" = ANY (ARRAY[('admin'::character varying)::"text", ('viewer'::character varying)::"text", ('counselor'::character varying)::"text"])))
);


ALTER TABLE "public"."invite_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."knowledge_base_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "knowledge_base_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "status" "text" DEFAULT 'ready'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "storage_path" "text",
    "file_name" "text",
    "mime_type" "text",
    "size_bytes" bigint,
    "url" "text",
    "content" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "knowledge_base_items_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'ready'::"text", 'failed'::"text"]))),
    CONSTRAINT "knowledge_base_items_type_check" CHECK (("type" = ANY (ARRAY['file'::"text", 'link'::"text", 'note'::"text"])))
);


ALTER TABLE "public"."knowledge_base_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."knowledge_bases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."knowledge_bases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_activities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "activity_type" "public"."activity_type" NOT NULL,
    "subject" "text",
    "description" "text",
    "call_outcome" "public"."call_outcome",
    "duration_minutes" integer,
    "scheduled_at" timestamp with time zone,
    "location" "text",
    "attendees" "text"[],
    "email_subject" "text",
    "email_body" "text",
    "completed_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "lead_activities_duration_minutes_check" CHECK (("duration_minutes" >= 0))
);


ALTER TABLE "public"."lead_activities" OWNER TO "postgres";


COMMENT ON TABLE "public"."lead_activities" IS 'HubSpot-style activity logging for leads (calls, emails, meetings)';



CREATE TABLE IF NOT EXISTS "public"."lead_assignment_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "from_user_id" "uuid" NOT NULL,
    "to_user_id" "uuid" NOT NULL,
    "from_position_id" "uuid",
    "to_position_id" "uuid",
    "changed_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lead_assignment_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_branches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "assigned_to" "uuid",
    "is_origin" boolean DEFAULT false NOT NULL,
    "shared_by" "uuid",
    "shared_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lead_branches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_checklists" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "title" character varying(255) NOT NULL,
    "is_completed" boolean DEFAULT false NOT NULL,
    "completed_at" timestamp with time zone,
    "completed_by" "uuid",
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "remind_at" timestamp with time zone,
    "reminded_at" timestamp with time zone
);


ALTER TABLE "public"."lead_checklists" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_collaborators" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lead_collaborators" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_consents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'sent'::"text" NOT NULL,
    "method" "text",
    "token" "text",
    "body_snapshot" "text",
    "template_version" integer,
    "signer_name" "text",
    "signature_type" "text",
    "signature_value" "text",
    "signature_image_url" "text",
    "document_url" "text",
    "ip_address" "text",
    "sent_at" timestamp with time zone,
    "sent_via" "text",
    "link_expires_at" timestamp with time zone,
    "signed_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."lead_consents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_duplicate_suggestions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "suggested_lead_id" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "lead_duplicate_suggestions_reason_check" CHECK (("reason" = ANY (ARRAY['phone'::"text", 'name'::"text"]))),
    CONSTRAINT "lead_duplicate_suggestions_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'dismissed'::"text", 'merged'::"text"])))
);


ALTER TABLE "public"."lead_duplicate_suggestions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_import_sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "staging_list_id" "uuid" NOT NULL,
    "source_label" "text" NOT NULL,
    "raw_rows" integer DEFAULT 0 NOT NULL,
    "dropped_rows" integer DEFAULT 0 NOT NULL,
    "no_contact_rows" integer DEFAULT 0 NOT NULL,
    "with_contact_rows" integer DEFAULT 0 NOT NULL,
    "notes" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lead_import_sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_insights" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "score" integer NOT NULL,
    "score_label" "text" NOT NULL,
    "priority_tier" "text" NOT NULL,
    "factors" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "summary" "text" NOT NULL,
    "actions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "engagement" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "generated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '24:00:00'::interval) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "lead_insights_priority_tier_check" CHECK (("priority_tier" = ANY (ARRAY['hot'::"text", 'warm'::"text", 'cold'::"text", 'unlikely'::"text"]))),
    CONSTRAINT "lead_insights_score_check" CHECK ((("score" >= 0) AND ("score" <= 100))),
    CONSTRAINT "lead_insights_score_label_check" CHECK (("score_label" = ANY (ARRAY['High'::"text", 'Medium'::"text", 'Low'::"text"])))
);


ALTER TABLE "public"."lead_insights" OWNER TO "postgres";


COMMENT ON TABLE "public"."lead_insights" IS 'Cached AI-generated insights for leads with 24-hour TTL';



CREATE TABLE IF NOT EXISTS "public"."lead_lists" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_system" boolean DEFAULT false NOT NULL,
    "is_archive" boolean DEFAULT false NOT NULL,
    "is_intake" boolean DEFAULT false NOT NULL,
    "color" "text",
    "access" "jsonb" DEFAULT '{"mode": "all"}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_staging" boolean DEFAULT false NOT NULL,
    "pipeline_id" "uuid"
);


ALTER TABLE "public"."lead_lists" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_merges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "canonical_id" "uuid" NOT NULL,
    "absorbed_id" "uuid" NOT NULL,
    "merged_by" "uuid",
    "source" "text" NOT NULL,
    "repointed_counts" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "field_patch" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "undone_at" timestamp with time zone,
    "synthesized_submission_id" "uuid",
    "repointed_ids" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "lead_merges_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'backfill'::"text"])))
);


ALTER TABLE "public"."lead_merges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_move_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "changed_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "prev_list_id" "uuid",
    "prev_pipeline_id" "uuid",
    "prev_stage_id" "uuid",
    "prev_status" "text",
    "prev_lead_type" "text",
    "prev_archive_reason" "text",
    "prev_assigned_to" "uuid",
    "new_list_id" "uuid",
    "new_assigned_to" "uuid",
    "collaborator_added_user_id" "uuid",
    "reverted_at" timestamp with time zone,
    "reverted_by" "uuid"
);


ALTER TABLE "public"."lead_move_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "user_email" character varying(255) NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "edited_at" timestamp with time zone,
    "checked_out_at" timestamp with time zone
);


ALTER TABLE "public"."lead_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "form_config_id" "uuid",
    "session_id" character varying(100),
    "created_via" "text" NOT NULL,
    "idempotency_key" character varying(100),
    "first_name" "text",
    "last_name" "text",
    "email" "text",
    "phone" "text",
    "city" "text",
    "country" "text",
    "normalized_email" "text",
    "normalized_phone" "text",
    "custom_fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "file_urls" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "intake_source" "text",
    "intake_medium" "text",
    "intake_campaign" "text",
    "entity_id" "uuid",
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "matched_existing" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "lead_submissions_created_via_check" CHECK (("created_via" = ANY (ARRAY['public_form'::"text", 'public_api'::"text", 'integration'::"text", 'manual'::"text", 'backfill'::"text"])))
);


ALTER TABLE "public"."lead_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lead_types" OWNER TO "postgres";


COMMENT ON TABLE "public"."lead_types" IS 'Per-tenant lead type options (slug + label).';



CREATE TABLE IF NOT EXISTS "public"."leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "session_id" character varying(100),
    "step" integer DEFAULT 1,
    "is_final" boolean DEFAULT false,
    "status" character varying(100) DEFAULT 'new'::character varying,
    "first_name" character varying(255),
    "last_name" character varying(255),
    "email" character varying(255),
    "phone" character varying(50),
    "city" character varying(255),
    "country" character varying(100),
    "custom_fields" "jsonb" DEFAULT '{}'::"jsonb",
    "file_urls" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "idempotency_key" character varying(100),
    "stage_id" "uuid",
    "assigned_to" "uuid",
    "intake_source" character varying(100),
    "intake_medium" character varying(100),
    "intake_campaign" character varying(100),
    "preferred_contact_method" character varying(50),
    "form_config_id" "uuid",
    "entity_id" "uuid",
    "ai_score" integer,
    "ai_priority" "text",
    "ai_score_updated_at" timestamp with time zone,
    "pipeline_id" "uuid" NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "account_id" "uuid",
    "lead_type" "text" DEFAULT 'lead'::"text" NOT NULL,
    "display_id" "text",
    "converted_at" timestamp with time zone,
    "converted_contact_id" "uuid",
    "ref_code" "text",
    "normalized_email" "text" GENERATED ALWAYS AS ("lower"("btrim"(("email")::"text"))) STORED,
    "merged_into" "uuid",
    "last_activity_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "company_name" character varying(255),
    "designation" character varying(255),
    "prospect_industry" character varying(64),
    "owner_id" "uuid",
    "salutation" character varying(10),
    "company_email" character varying(255),
    "branch_id" "uuid",
    "list_id" "uuid",
    "destinations" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "field_of_study" "text",
    "degree_level" "text",
    "archive_reason" "text",
    "pre_app_fee_status" "text",
    "pre_app_fee_amount" numeric(14,2),
    "pre_app_fee_notes" "text",
    "nationality" "text",
    "intake_account" "text",
    "normalized_phone" "text",
    "form_source" "text",
    "preferred_university" "text",
    "archived_by" "uuid",
    "archived_at" timestamp with time zone,
    "archived_from_list_id" "uuid",
    "archived_from_status" "text",
    CONSTRAINT "leads_ai_priority_check" CHECK ((("ai_priority" IS NULL) OR ("ai_priority" = ANY (ARRAY['hot'::"text", 'warm'::"text", 'cold'::"text", 'unlikely'::"text"])))),
    CONSTRAINT "leads_ai_score_check" CHECK ((("ai_score" IS NULL) OR (("ai_score" >= 0) AND ("ai_score" <= 100)))),
    CONSTRAINT "leads_pre_app_fee_status_check" CHECK (("pre_app_fee_status" = ANY (ARRAY['paid'::"text", 'unpaid'::"text", 'waiver'::"text"])))
);


ALTER TABLE "public"."leads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leads_listsnapshot_appuploads" (
    "id" "uuid",
    "list_id" "uuid",
    "stage_id" "uuid"
);


ALTER TABLE "public"."leads_listsnapshot_appuploads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leave_adjustments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "tenant_user_id" "uuid" NOT NULL,
    "leave_type_id" "uuid" NOT NULL,
    "year" integer NOT NULL,
    "delta_days" numeric NOT NULL,
    "note" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."leave_adjustments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leave_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "tenant_user_id" "uuid" NOT NULL,
    "leave_type_id" "uuid" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "start_half" boolean DEFAULT false NOT NULL,
    "end_half" boolean DEFAULT false NOT NULL,
    "total_days" numeric NOT NULL,
    "reason" "text",
    "approval_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "approver_tenant_user_id" "uuid",
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "rejection_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "leave_requests_approval_status_check" CHECK (("approval_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."leave_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leave_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "code" "text",
    "color" "text",
    "is_paid" boolean DEFAULT true NOT NULL,
    "requires_approval" boolean DEFAULT true NOT NULL,
    "annual_allotment_days" numeric DEFAULT 0 NOT NULL,
    "allow_half_day" boolean DEFAULT true NOT NULL,
    "carry_forward" boolean DEFAULT false NOT NULL,
    "max_carry_forward_days" numeric,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."leave_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "channel_id" "uuid" NOT NULL,
    "provider_message_id" "text",
    "direction" "text" NOT NULL,
    "author_type" "text" NOT NULL,
    "author_user_id" "uuid",
    "content_text" "text",
    "attachments" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "status" "text" NOT NULL,
    "error" "text",
    "ai_metadata" "jsonb",
    "delivered_at" timestamp with time zone,
    "read_at" timestamp with time zone,
    "provider_timestamp" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "messages_author_type_check" CHECK (("author_type" = ANY (ARRAY['customer'::"text", 'human_agent'::"text", 'ai_agent'::"text", 'system'::"text"]))),
    CONSTRAINT "messages_direction_check" CHECK (("direction" = ANY (ARRAY['inbound'::"text", 'outbound'::"text"]))),
    CONSTRAINT "messages_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'received'::"text", 'queued'::"text", 'sent'::"text", 'delivered'::"text", 'read'::"text", 'failed'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "link" "text",
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."org_layers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."org_layers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."partner_colleges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."partner_colleges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pipeline_stages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" character varying(100) NOT NULL,
    "slug" character varying(100) NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "color" character varying(7) DEFAULT '#6b7280'::character varying,
    "is_default" boolean DEFAULT false,
    "is_terminal" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "pipeline_id" "uuid" NOT NULL,
    "terminal_type" character varying(10),
    CONSTRAINT "pipeline_stages_terminal_type_check" CHECK ((("terminal_type")::"text" = ANY (ARRAY[('won'::character varying)::"text", ('lost'::character varying)::"text"])))
);


ALTER TABLE "public"."pipeline_stages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pipelines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" character varying(100) NOT NULL,
    "slug" character varying(100) NOT NULL,
    "description" "text",
    "is_default" boolean DEFAULT false,
    "position" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "list_id" "uuid"
);


ALTER TABLE "public"."pipelines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."positions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "base_tier" "text" DEFAULT 'member'::"text" NOT NULL,
    "is_system" boolean DEFAULT false NOT NULL,
    "permissions" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "layer_id" "uuid",
    CONSTRAINT "positions_base_tier_check" CHECK (("base_tier" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."positions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_allocations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "tenant_user_id" "uuid" NOT NULL,
    "hours_per_week" numeric NOT NULL,
    "role_on_project" "text",
    "start_date" "date",
    "end_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "project_allocations_hours_positive" CHECK (("hours_per_week" > (0)::numeric))
);


ALTER TABLE "public"."project_allocations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_contacts" (
    "project_id" "uuid" NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "role" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "project_contacts_role_check" CHECK (("role" = ANY (ARRAY['primary'::"text", 'technical'::"text", 'billing'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."project_contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "account_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "default_rate" numeric(10,2),
    "is_billable" boolean DEFAULT true NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "owner_id" "uuid",
    "deal_id" "uuid",
    CONSTRAINT "projects_status_check" CHECK (("status" = ANY (ARRAY['planning'::"text", 'active'::"text", 'in_review'::"text", 'delivered'::"text", 'on_hold'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."proposal_line_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "proposal_id" "uuid" NOT NULL,
    "service_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text",
    "billing_type" "text",
    "quantity" numeric(10,2) DEFAULT 1 NOT NULL,
    "unit_price" numeric(14,2) DEFAULT 0 NOT NULL,
    "hours" numeric(10,2),
    "line_total" numeric(14,2) DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."proposal_line_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."proposal_views" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "proposal_id" "uuid" NOT NULL,
    "viewed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ip" "text",
    "user_agent" "text"
);


ALTER TABLE "public"."proposal_views" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."proposals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "deal_id" "uuid" NOT NULL,
    "proposal_number" "text" NOT NULL,
    "title" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "currency" "text" DEFAULT 'NPR'::"text" NOT NULL,
    "subtotal" numeric(14,2) DEFAULT 0 NOT NULL,
    "discount_type" "text",
    "discount_value" numeric(14,2) DEFAULT 0 NOT NULL,
    "tax_percent" numeric(6,3) DEFAULT 0 NOT NULL,
    "total" numeric(14,2) DEFAULT 0 NOT NULL,
    "notes" "text",
    "valid_until" "date",
    "sent_at" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "public_token" "text",
    "public_enabled" boolean DEFAULT false NOT NULL,
    CONSTRAINT "proposals_discount_type_check" CHECK (("discount_type" = ANY (ARRAY['percent'::"text", 'amount'::"text"]))),
    CONSTRAINT "proposals_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'sent'::"text", 'accepted'::"text", 'rejected'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."proposals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rate_limits" (
    "key" character varying(255) NOT NULL,
    "count" integer DEFAULT 1 NOT NULL,
    "window_start" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL
);


ALTER TABLE "public"."rate_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."schema_migrations" (
    "version" "text" NOT NULL,
    "applied_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "applied_by" "text" DEFAULT CURRENT_USER NOT NULL
);


ALTER TABLE "public"."schema_migrations" OWNER TO "postgres";


COMMENT ON TABLE "public"."schema_migrations" IS 'Ledger of applied migration files (one row per supabase/migrations/NNN_*.sql), self-recorded by each migration. Manual-application ledger; distinct from Supabase CLI internal table.';



CREATE TABLE IF NOT EXISTS "public"."services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "hours" numeric(10,2),
    "price" numeric(14,2),
    "billing_type" "text" DEFAULT 'fixed'::"text" NOT NULL,
    "category" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "services_billing_type_check" CHECK (("billing_type" = ANY (ARRAY['fixed'::"text", 'hourly'::"text", 'retainer'::"text"])))
);


ALTER TABLE "public"."services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."skills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "category" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."skills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "project_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'todo'::"text" NOT NULL,
    "estimated_minutes" integer,
    "is_billable" boolean DEFAULT true NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "assignee_id" "uuid",
    "due_date" "date",
    "priority" "text" DEFAULT 'normal'::"text" NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "lead_id" "uuid",
    "assigned_by_id" "uuid",
    "deal_id" "uuid",
    CONSTRAINT "tasks_estimated_minutes_check" CHECK (("estimated_minutes" > 0)),
    CONSTRAINT "tasks_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text", 'urgent'::"text"]))),
    CONSTRAINT "tasks_status_check" CHECK (("status" = ANY (ARRAY['todo'::"text", 'in_progress'::"text", 'done'::"text"])))
);


ALTER TABLE "public"."tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenant_email_settings" (
    "tenant_id" "uuid" NOT NULL,
    "from_name" "text",
    "from_address" "text",
    "reply_to" "text",
    "domain_verified" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid"
);


ALTER TABLE "public"."tenant_email_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenant_entities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" character varying(255) NOT NULL,
    "slug" character varying(100) NOT NULL,
    "description" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "is_active" boolean DEFAULT true,
    "position" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."tenant_entities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenant_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" character varying(20) DEFAULT 'viewer'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "default_hourly_rate" numeric(10,2),
    "position_id" "uuid",
    "branch_id" "uuid",
    CONSTRAINT "tenant_users_role_check" CHECK ((("role")::"text" = ANY (ARRAY[('owner'::character varying)::"text", ('admin'::character varying)::"text", ('viewer'::character varying)::"text", ('counselor'::character varying)::"text"])))
);


ALTER TABLE "public"."tenant_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "slug" character varying(100) NOT NULL,
    "logo_url" "text",
    "primary_color" character varying(7) DEFAULT '#0f172a'::character varying,
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "industry_id" character varying(50),
    "plan" "text" DEFAULT 'starter'::"text" NOT NULL,
    "entitlement_overrides" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "default_phone_country" character(2),
    "timezone" "text" DEFAULT 'Asia/Kathmandu'::"text" NOT NULL,
    "weekend_days" smallint[] DEFAULT '{6}'::smallint[] NOT NULL,
    CONSTRAINT "tenants_plan_check" CHECK (("plan" = ANY (ARRAY['starter'::"text", 'professional'::"text", 'enterprise'::"text"])))
);


ALTER TABLE "public"."tenants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."time_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "task_id" "uuid",
    "project_id" "uuid" NOT NULL,
    "entry_date" "date" NOT NULL,
    "minutes" integer NOT NULL,
    "notes" "text",
    "is_billable" boolean DEFAULT true NOT NULL,
    "rate_snapshot" numeric(10,2),
    "approval_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "rejection_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "time_entries_approval_status_check" CHECK (("approval_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "time_entries_minutes_check" CHECK (("minutes" > 0))
);


ALTER TABLE "public"."time_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."utm_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "form_id" "uuid",
    "destination_url" "text" NOT NULL,
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "tracking_url" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."utm_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."webhook_deliveries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "webhook_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "attempt" integer NOT NULL,
    "status_code" integer,
    "response_body" "text",
    "success" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."webhook_deliveries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."webhook_endpoints" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "url" "text" NOT NULL,
    "secret" "text" NOT NULL,
    "event_types" "text"[] NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."webhook_endpoints" OWNER TO "postgres";


ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."affiliates"
    ADD CONSTRAINT "affiliates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."affiliates"
    ADD CONSTRAINT "affiliates_tenant_id_ref_code_key" UNIQUE ("tenant_id", "ref_code");



ALTER TABLE ONLY "public"."agents"
    ADD CONSTRAINT "agents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agents"
    ADD CONSTRAINT "agents_tenant_id_name_key" UNIQUE ("tenant_id", "name");



ALTER TABLE ONLY "public"."application_stages"
    ADD CONSTRAINT "application_stages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."application_stages"
    ADD CONSTRAINT "application_stages_tenant_id_slug_key" UNIQUE ("tenant_id", "slug");



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance_records"
    ADD CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance_records"
    ADD CONSTRAINT "attendance_records_tenant_id_tenant_user_id_work_date_key" UNIQUE ("tenant_id", "tenant_user_id", "work_date");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."automation_email_log"
    ADD CONSTRAINT "automation_email_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_tenant_id_slug_key" UNIQUE ("tenant_id", "slug");



ALTER TABLE ONLY "public"."campaign_results"
    ADD CONSTRAINT "campaign_results_campaign_id_match_id_key" UNIQUE ("campaign_id", "match_id");



ALTER TABLE ONLY "public"."campaign_results"
    ADD CONSTRAINT "campaign_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_tenant_id_slug_key" UNIQUE ("tenant_id", "slug");



ALTER TABLE ONLY "public"."class_enrollments"
    ADD CONSTRAINT "class_enrollments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."classes"
    ADD CONSTRAINT "classes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."classes"
    ADD CONSTRAINT "classes_tenant_id_name_key" UNIQUE ("tenant_id", "name");



ALTER TABLE ONLY "public"."connected_email_accounts"
    ADD CONSTRAINT "connected_email_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."consent_templates"
    ADD CONSTRAINT "consent_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."consent_templates"
    ADD CONSTRAINT "consent_templates_tenant_id_key" UNIQUE ("tenant_id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_channel_contact_unique" UNIQUE ("channel_id", "external_contact_id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."countries"
    ADD CONSTRAINT "countries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."countries"
    ADD CONSTRAINT "countries_tenant_id_name_key" UNIQUE ("tenant_id", "name");



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_tenant_id_name_key" UNIQUE ("tenant_id", "name");



ALTER TABLE ONLY "public"."dashboards"
    ADD CONSTRAINT "dashboards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deal_contacts"
    ADD CONSTRAINT "deal_contacts_pkey" PRIMARY KEY ("deal_id", "contact_id");



ALTER TABLE ONLY "public"."deal_pipelines"
    ADD CONSTRAINT "deal_pipelines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deal_pipelines"
    ADD CONSTRAINT "deal_pipelines_tenant_id_slug_key" UNIQUE ("tenant_id", "slug");



ALTER TABLE ONLY "public"."deal_stages"
    ADD CONSTRAINT "deal_stages_pipeline_slug_key" UNIQUE ("pipeline_id", "slug");



ALTER TABLE ONLY "public"."deal_stages"
    ADD CONSTRAINT "deal_stages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deals"
    ADD CONSTRAINT "deals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_tenant_id_name_key" UNIQUE ("tenant_id", "name");



ALTER TABLE ONLY "public"."email_forward_rules"
    ADD CONSTRAINT "email_forward_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_sync_state"
    ADD CONSTRAINT "email_sync_state_pkey" PRIMARY KEY ("connected_email_account_id");



ALTER TABLE ONLY "public"."email_threads"
    ADD CONSTRAINT "email_threads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."emails"
    ADD CONSTRAINT "emails_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employee_profiles"
    ADD CONSTRAINT "employee_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employee_profiles"
    ADD CONSTRAINT "employee_profiles_tenant_user_id_key" UNIQUE ("tenant_user_id");



ALTER TABLE ONLY "public"."employee_skills"
    ADD CONSTRAINT "employee_skills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employee_skills"
    ADD CONSTRAINT "employee_skills_tenant_user_id_skill_id_key" UNIQUE ("tenant_user_id", "skill_id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_configs"
    ADD CONSTRAINT "form_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."holidays"
    ADD CONSTRAINT "holidays_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inbox_channels"
    ADD CONSTRAINT "inbox_channels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inbox_channels"
    ADD CONSTRAINT "inbox_channels_provider_account_unique" UNIQUE ("provider", "external_account_id");



ALTER TABLE ONLY "public"."industries"
    ADD CONSTRAINT "industries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integration_idempotency"
    ADD CONSTRAINT "integration_idempotency_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integration_keys"
    ADD CONSTRAINT "integration_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invite_tokens"
    ADD CONSTRAINT "invite_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invite_tokens"
    ADD CONSTRAINT "invite_tokens_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."knowledge_base_items"
    ADD CONSTRAINT "knowledge_base_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."knowledge_bases"
    ADD CONSTRAINT "knowledge_bases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_activities"
    ADD CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_assignment_history"
    ADD CONSTRAINT "lead_assignment_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_branches"
    ADD CONSTRAINT "lead_branches_lead_id_branch_id_key" UNIQUE ("lead_id", "branch_id");



ALTER TABLE ONLY "public"."lead_branches"
    ADD CONSTRAINT "lead_branches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_checklists"
    ADD CONSTRAINT "lead_checklists_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_collaborators"
    ADD CONSTRAINT "lead_collaborators_lead_id_user_id_key" UNIQUE ("lead_id", "user_id");



ALTER TABLE ONLY "public"."lead_collaborators"
    ADD CONSTRAINT "lead_collaborators_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_consents"
    ADD CONSTRAINT "lead_consents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_duplicate_suggestions"
    ADD CONSTRAINT "lead_duplicate_suggestions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_duplicate_suggestions"
    ADD CONSTRAINT "lead_duplicate_suggestions_tenant_id_lead_id_suggested_lead_key" UNIQUE ("tenant_id", "lead_id", "suggested_lead_id");



ALTER TABLE ONLY "public"."lead_import_sources"
    ADD CONSTRAINT "lead_import_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_import_sources"
    ADD CONSTRAINT "lead_import_sources_tenant_id_staging_list_id_source_label_key" UNIQUE ("tenant_id", "staging_list_id", "source_label");



ALTER TABLE ONLY "public"."lead_insights"
    ADD CONSTRAINT "lead_insights_lead_id_key" UNIQUE ("lead_id");



ALTER TABLE ONLY "public"."lead_insights"
    ADD CONSTRAINT "lead_insights_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_lists"
    ADD CONSTRAINT "lead_lists_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_lists"
    ADD CONSTRAINT "lead_lists_tenant_id_slug_key" UNIQUE ("tenant_id", "slug");



ALTER TABLE ONLY "public"."lead_merges"
    ADD CONSTRAINT "lead_merges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_move_log"
    ADD CONSTRAINT "lead_move_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_notes"
    ADD CONSTRAINT "lead_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_submissions"
    ADD CONSTRAINT "lead_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_types"
    ADD CONSTRAINT "lead_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_types"
    ADD CONSTRAINT "lead_types_tenant_id_slug_key" UNIQUE ("tenant_id", "slug");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leave_adjustments"
    ADD CONSTRAINT "leave_adjustments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leave_requests"
    ADD CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leave_types"
    ADD CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leave_types"
    ADD CONSTRAINT "leave_types_tenant_id_name_key" UNIQUE ("tenant_id", "name");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."org_layers"
    ADD CONSTRAINT "org_layers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."partner_colleges"
    ADD CONSTRAINT "partner_colleges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."partner_colleges"
    ADD CONSTRAINT "partner_colleges_tenant_id_name_key" UNIQUE ("tenant_id", "name");



ALTER TABLE ONLY "public"."pipeline_stages"
    ADD CONSTRAINT "pipeline_stages_pipeline_id_slug_key" UNIQUE ("pipeline_id", "slug");



ALTER TABLE ONLY "public"."pipeline_stages"
    ADD CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pipelines"
    ADD CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pipelines"
    ADD CONSTRAINT "pipelines_tenant_id_slug_key" UNIQUE ("tenant_id", "slug");



ALTER TABLE ONLY "public"."positions"
    ADD CONSTRAINT "positions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."positions"
    ADD CONSTRAINT "positions_tenant_id_slug_key" UNIQUE ("tenant_id", "slug");



ALTER TABLE ONLY "public"."project_allocations"
    ADD CONSTRAINT "project_allocations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_contacts"
    ADD CONSTRAINT "project_contacts_pkey" PRIMARY KEY ("project_id", "contact_id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."proposal_line_items"
    ADD CONSTRAINT "proposal_line_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."proposal_views"
    ADD CONSTRAINT "proposal_views_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."proposals"
    ADD CONSTRAINT "proposals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rate_limits"
    ADD CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."schema_migrations"
    ADD CONSTRAINT "schema_migrations_pkey" PRIMARY KEY ("version");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."skills"
    ADD CONSTRAINT "skills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."skills"
    ADD CONSTRAINT "skills_tenant_id_name_key" UNIQUE ("tenant_id", "name");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_email_settings"
    ADD CONSTRAINT "tenant_email_settings_pkey" PRIMARY KEY ("tenant_id");



ALTER TABLE ONLY "public"."tenant_entities"
    ADD CONSTRAINT "tenant_entities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_entities"
    ADD CONSTRAINT "tenant_entities_tenant_id_slug_key" UNIQUE ("tenant_id", "slug");



ALTER TABLE ONLY "public"."tenant_users"
    ADD CONSTRAINT "tenant_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_users"
    ADD CONSTRAINT "tenant_users_tenant_id_user_id_key" UNIQUE ("tenant_id", "user_id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."time_entries"
    ADD CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_configs"
    ADD CONSTRAINT "uq_form_configs_tenant_slug" UNIQUE ("tenant_id", "slug");



ALTER TABLE ONLY "public"."integration_idempotency"
    ADD CONSTRAINT "uq_integration_idempotency" UNIQUE ("tenant_id", "idempotency_key");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "uq_leads_tenant_idempotency" UNIQUE ("tenant_id", "idempotency_key");



ALTER TABLE ONLY "public"."utm_links"
    ADD CONSTRAINT "utm_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."webhook_deliveries"
    ADD CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."webhook_endpoints"
    ADD CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id");



CREATE INDEX "affiliates_tenant_ref_code_idx" ON "public"."affiliates" USING "btree" ("tenant_id", "ref_code");



CREATE UNIQUE INDEX "deal_contacts_one_primary" ON "public"."deal_contacts" USING "btree" ("deal_id") WHERE ("role" = 'primary'::"text");



CREATE INDEX "idx_accounts_tenant_active" ON "public"."accounts" USING "btree" ("tenant_id") WHERE ("is_active" = true);



CREATE INDEX "idx_accounts_tenant_owner" ON "public"."accounts" USING "btree" ("tenant_id", "owner_id") WHERE ("owner_id" IS NOT NULL);



CREATE INDEX "idx_agents_tenant" ON "public"."agents" USING "btree" ("tenant_id");



CREATE INDEX "idx_application_stages_tenant" ON "public"."application_stages" USING "btree" ("tenant_id", "position");



CREATE INDEX "idx_applications_tenant_lead" ON "public"."applications" USING "btree" ("tenant_id", "lead_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_applications_tenant_live" ON "public"."applications" USING "btree" ("tenant_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_applications_tenant_stage" ON "public"."applications" USING "btree" ("tenant_id", "stage_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_attendance_records_tenant_date" ON "public"."attendance_records" USING "btree" ("tenant_id", "work_date");



CREATE INDEX "idx_attendance_records_tenant_user_date" ON "public"."attendance_records" USING "btree" ("tenant_id", "tenant_user_id", "work_date");



CREATE INDEX "idx_audit_logs_action" ON "public"."audit_logs" USING "btree" ("action");



CREATE INDEX "idx_audit_logs_created_at" ON "public"."audit_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_logs_entity" ON "public"."audit_logs" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_audit_logs_tenant_id" ON "public"."audit_logs" USING "btree" ("tenant_id");



CREATE INDEX "idx_automation_email_log_lead" ON "public"."automation_email_log" USING "btree" ("lead_id");



CREATE INDEX "idx_automation_email_log_tenant" ON "public"."automation_email_log" USING "btree" ("tenant_id");



CREATE INDEX "idx_campaign_results_campaign" ON "public"."campaign_results" USING "btree" ("campaign_id");



CREATE INDEX "idx_campaign_results_tenant" ON "public"."campaign_results" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "idx_campaigns_public_token" ON "public"."campaigns" USING "btree" ("public_token") WHERE ("public_token" IS NOT NULL);



CREATE INDEX "idx_campaigns_tenant" ON "public"."campaigns" USING "btree" ("tenant_id");



CREATE INDEX "idx_campaigns_tenant_status" ON "public"."campaigns" USING "btree" ("tenant_id", "status");



CREATE INDEX "idx_class_enroll_tenant_class" ON "public"."class_enrollments" USING "btree" ("tenant_id", "class_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_class_enroll_tenant_lead" ON "public"."class_enrollments" USING "btree" ("tenant_id", "lead_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_classes_tenant" ON "public"."classes" USING "btree" ("tenant_id");



CREATE INDEX "idx_connected_email_accounts_tenant" ON "public"."connected_email_accounts" USING "btree" ("tenant_id");



CREATE INDEX "idx_connected_email_accounts_user" ON "public"."connected_email_accounts" USING "btree" ("user_id");



CREATE UNIQUE INDEX "idx_connected_email_accounts_user_email" ON "public"."connected_email_accounts" USING "btree" ("user_id", "email");



CREATE INDEX "idx_contacts_tenant_account" ON "public"."contacts" USING "btree" ("tenant_id", "account_id");



CREATE INDEX "idx_contacts_tenant_email" ON "public"."contacts" USING "btree" ("tenant_id", "email") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_conversations_lead" ON "public"."conversations" USING "btree" ("lead_id") WHERE ("lead_id" IS NOT NULL);



CREATE INDEX "idx_conversations_tenant_assignee" ON "public"."conversations" USING "btree" ("tenant_id", "assigned_to_user_id") WHERE ("assigned_to_user_id" IS NOT NULL);



CREATE INDEX "idx_conversations_tenant_last_msg" ON "public"."conversations" USING "btree" ("tenant_id", "last_message_at" DESC);



CREATE INDEX "idx_conversations_tenant_status" ON "public"."conversations" USING "btree" ("tenant_id", "status", "last_message_at" DESC);



CREATE INDEX "idx_countries_tenant" ON "public"."countries" USING "btree" ("tenant_id");



CREATE INDEX "idx_courses_tenant" ON "public"."courses" USING "btree" ("tenant_id");



CREATE INDEX "idx_dashboards_tenant" ON "public"."dashboards" USING "btree" ("tenant_id");



CREATE INDEX "idx_deal_contacts_contact" ON "public"."deal_contacts" USING "btree" ("contact_id");



CREATE INDEX "idx_deal_pipelines_tenant" ON "public"."deal_pipelines" USING "btree" ("tenant_id");



CREATE INDEX "idx_deal_pipelines_tenant_default" ON "public"."deal_pipelines" USING "btree" ("tenant_id", "is_default") WHERE ("is_default" = true);



CREATE INDEX "idx_deal_stages_pipeline" ON "public"."deal_stages" USING "btree" ("pipeline_id");



CREATE INDEX "idx_deal_stages_tenant" ON "public"."deal_stages" USING "btree" ("tenant_id", "position");



CREATE INDEX "idx_deals_tenant_account" ON "public"."deals" USING "btree" ("tenant_id", "account_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_deals_tenant_live" ON "public"."deals" USING "btree" ("tenant_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_deals_tenant_owner" ON "public"."deals" USING "btree" ("tenant_id", "owner_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_deals_tenant_pipeline" ON "public"."deals" USING "btree" ("tenant_id", "pipeline_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_deals_tenant_stage" ON "public"."deals" USING "btree" ("tenant_id", "stage_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_departments_tenant" ON "public"."departments" USING "btree" ("tenant_id");



CREATE INDEX "idx_email_forward_rules_lookup" ON "public"."email_forward_rules" USING "btree" ("tenant_id", "stage_id") WHERE ("is_active" = true);



CREATE UNIQUE INDEX "idx_email_threads_account_gmail_thread" ON "public"."email_threads" USING "btree" ("connected_email_account_id", "gmail_thread_id");



CREATE INDEX "idx_email_threads_contact" ON "public"."email_threads" USING "btree" ("contact_id") WHERE ("contact_id" IS NOT NULL);



CREATE INDEX "idx_email_threads_lead" ON "public"."email_threads" USING "btree" ("lead_id") WHERE ("lead_id" IS NOT NULL);



CREATE INDEX "idx_email_threads_tenant" ON "public"."email_threads" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "idx_emails_gmail_message" ON "public"."emails" USING "btree" ("connected_email_account_id", "gmail_message_id");



CREATE INDEX "idx_emails_rfc_message_id" ON "public"."emails" USING "btree" ("rfc_message_id");



CREATE INDEX "idx_emails_tenant" ON "public"."emails" USING "btree" ("tenant_id");



CREATE INDEX "idx_emails_thread" ON "public"."emails" USING "btree" ("thread_id", COALESCE("sent_at", "received_at"));



CREATE INDEX "idx_emails_unread_inbound" ON "public"."emails" USING "btree" ("thread_id") WHERE (("direction" = 'inbound'::"text") AND ("read_at" IS NULL));



CREATE INDEX "idx_employee_profiles_department" ON "public"."employee_profiles" USING "btree" ("department_id");



CREATE INDEX "idx_employee_profiles_manager" ON "public"."employee_profiles" USING "btree" ("manager_tenant_user_id");



CREATE INDEX "idx_employee_profiles_tenant" ON "public"."employee_profiles" USING "btree" ("tenant_id");



CREATE INDEX "idx_employee_skills_skill" ON "public"."employee_skills" USING "btree" ("skill_id");



CREATE INDEX "idx_employee_skills_tenant" ON "public"."employee_skills" USING "btree" ("tenant_id");



CREATE INDEX "idx_employee_skills_user" ON "public"."employee_skills" USING "btree" ("tenant_user_id");



CREATE INDEX "idx_events_created_at" ON "public"."events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_events_entity" ON "public"."events" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_events_pending" ON "public"."events" USING "btree" ("status") WHERE (("status")::"text" = 'pending'::"text");



CREATE INDEX "idx_events_tenant_id" ON "public"."events" USING "btree" ("tenant_id");



CREATE INDEX "idx_events_type" ON "public"."events" USING "btree" ("type");



CREATE INDEX "idx_form_configs_tenant_id" ON "public"."form_configs" USING "btree" ("tenant_id");



CREATE INDEX "idx_form_configs_tenant_slug" ON "public"."form_configs" USING "btree" ("tenant_id", "slug");



CREATE INDEX "idx_holidays_tenant_date" ON "public"."holidays" USING "btree" ("tenant_id", "holiday_date");



CREATE INDEX "idx_import_sources_list" ON "public"."lead_import_sources" USING "btree" ("staging_list_id");



CREATE INDEX "idx_inbox_channels_tenant" ON "public"."inbox_channels" USING "btree" ("tenant_id");



CREATE INDEX "idx_integration_idempotency_tenant_key" ON "public"."integration_idempotency" USING "btree" ("tenant_id", "idempotency_key");



CREATE INDEX "idx_integration_keys_form_id" ON "public"."integration_keys" USING "btree" ("form_id");



CREATE INDEX "idx_integration_keys_hashed_key" ON "public"."integration_keys" USING "btree" ("hashed_key");



CREATE INDEX "idx_integration_keys_last_used" ON "public"."integration_keys" USING "btree" ("last_used_at") WHERE ("last_used_at" IS NOT NULL);



CREATE INDEX "idx_integration_keys_permissions" ON "public"."integration_keys" USING "gin" ("permissions");



CREATE INDEX "idx_integration_keys_revoked" ON "public"."integration_keys" USING "btree" ("revoked_at");



CREATE INDEX "idx_integration_keys_tenant_id" ON "public"."integration_keys" USING "btree" ("tenant_id");



CREATE INDEX "idx_integration_keys_tenant_revoked" ON "public"."integration_keys" USING "btree" ("tenant_id", "revoked_at");



CREATE INDEX "idx_invite_tokens_email" ON "public"."invite_tokens" USING "btree" ("email", "tenant_id");



CREATE INDEX "idx_invite_tokens_tenant" ON "public"."invite_tokens" USING "btree" ("tenant_id");



CREATE INDEX "idx_invite_tokens_token" ON "public"."invite_tokens" USING "btree" ("token");



CREATE INDEX "idx_kb_items_kb" ON "public"."knowledge_base_items" USING "btree" ("knowledge_base_id", "created_at" DESC);



CREATE INDEX "idx_kb_items_tenant_created" ON "public"."knowledge_base_items" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_knowledge_bases_tenant_created" ON "public"."knowledge_bases" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_lah_lead" ON "public"."lead_assignment_history" USING "btree" ("lead_id");



CREATE INDEX "idx_lah_tenant_from_user" ON "public"."lead_assignment_history" USING "btree" ("tenant_id", "from_user_id");



CREATE INDEX "idx_lead_activities_created_at" ON "public"."lead_activities" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_lead_activities_lead_id" ON "public"."lead_activities" USING "btree" ("lead_id");



CREATE INDEX "idx_lead_activities_scheduled_at" ON "public"."lead_activities" USING "btree" ("scheduled_at") WHERE ("scheduled_at" IS NOT NULL);



CREATE INDEX "idx_lead_activities_tenant_id" ON "public"."lead_activities" USING "btree" ("tenant_id");



CREATE INDEX "idx_lead_activities_type" ON "public"."lead_activities" USING "btree" ("activity_type");



CREATE INDEX "idx_lead_activities_user_id" ON "public"."lead_activities" USING "btree" ("user_id");



CREATE INDEX "idx_lead_branches_assignee" ON "public"."lead_branches" USING "btree" ("assigned_to") WHERE ("assigned_to" IS NOT NULL);



CREATE INDEX "idx_lead_branches_branch" ON "public"."lead_branches" USING "btree" ("tenant_id", "branch_id");



CREATE INDEX "idx_lead_branches_lead" ON "public"."lead_branches" USING "btree" ("lead_id");



CREATE INDEX "idx_lead_checklists_lead" ON "public"."lead_checklists" USING "btree" ("lead_id");



CREATE INDEX "idx_lead_checklists_remind_due" ON "public"."lead_checklists" USING "btree" ("remind_at") WHERE (("remind_at" IS NOT NULL) AND ("reminded_at" IS NULL) AND ("is_completed" = false));



CREATE INDEX "idx_lead_checklists_tenant" ON "public"."lead_checklists" USING "btree" ("tenant_id");



CREATE INDEX "idx_lead_collaborators_lead" ON "public"."lead_collaborators" USING "btree" ("lead_id");



CREATE INDEX "idx_lead_collaborators_user" ON "public"."lead_collaborators" USING "btree" ("tenant_id", "user_id");



CREATE INDEX "idx_lead_consents_tenant_lead" ON "public"."lead_consents" USING "btree" ("tenant_id", "lead_id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "idx_lead_consents_token" ON "public"."lead_consents" USING "btree" ("token") WHERE ("token" IS NOT NULL);



CREATE INDEX "idx_lead_dup_suggestions_open" ON "public"."lead_duplicate_suggestions" USING "btree" ("tenant_id", "status") WHERE ("status" = 'open'::"text");



CREATE INDEX "idx_lead_insights_expires" ON "public"."lead_insights" USING "btree" ("expires_at");



CREATE INDEX "idx_lead_insights_lead" ON "public"."lead_insights" USING "btree" ("lead_id");



CREATE INDEX "idx_lead_insights_priority" ON "public"."lead_insights" USING "btree" ("tenant_id", "priority_tier");



CREATE INDEX "idx_lead_insights_score" ON "public"."lead_insights" USING "btree" ("tenant_id", "score" DESC);



CREATE INDEX "idx_lead_insights_tenant" ON "public"."lead_insights" USING "btree" ("tenant_id");



CREATE INDEX "idx_lead_lists_pipeline_id" ON "public"."lead_lists" USING "btree" ("pipeline_id");



CREATE INDEX "idx_lead_lists_tenant" ON "public"."lead_lists" USING "btree" ("tenant_id");



CREATE INDEX "idx_lead_merges_absorbed" ON "public"."lead_merges" USING "btree" ("absorbed_id");



CREATE INDEX "idx_lead_merges_tenant" ON "public"."lead_merges" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_lead_move_log_lead_active" ON "public"."lead_move_log" USING "btree" ("lead_id", "created_at" DESC) WHERE ("reverted_at" IS NULL);



CREATE INDEX "idx_lead_move_log_tenant" ON "public"."lead_move_log" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_lead_notes_lead_id" ON "public"."lead_notes" USING "btree" ("lead_id");



CREATE INDEX "idx_lead_submissions_lead" ON "public"."lead_submissions" USING "btree" ("lead_id", "created_at" DESC);



CREATE INDEX "idx_lead_submissions_tenant_created" ON "public"."lead_submissions" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_lead_submissions_tenant_email" ON "public"."lead_submissions" USING "btree" ("tenant_id", "normalized_email") WHERE ("normalized_email" IS NOT NULL);



CREATE INDEX "idx_lead_types_tenant_sort" ON "public"."lead_types" USING "btree" ("tenant_id", "sort_order");



CREATE INDEX "idx_leads_account_id" ON "public"."leads" USING "btree" ("account_id") WHERE ("account_id" IS NOT NULL);



CREATE INDEX "idx_leads_ai_priority" ON "public"."leads" USING "btree" ("tenant_id", "ai_priority") WHERE (("deleted_at" IS NULL) AND ("ai_priority" IS NOT NULL));



CREATE INDEX "idx_leads_ai_score" ON "public"."leads" USING "btree" ("tenant_id", "ai_score" DESC NULLS LAST) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_leads_assigned_to" ON "public"."leads" USING "btree" ("assigned_to") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_leads_converted" ON "public"."leads" USING "btree" ("tenant_id") WHERE ("converted_at" IS NOT NULL);



CREATE INDEX "idx_leads_created_at" ON "public"."leads" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_leads_custom_fields_gin" ON "public"."leads" USING "gin" ("custom_fields");



CREATE UNIQUE INDEX "idx_leads_display_id" ON "public"."leads" USING "btree" ("display_id") WHERE ("display_id" IS NOT NULL);



CREATE INDEX "idx_leads_email" ON "public"."leads" USING "btree" ("email");



CREATE INDEX "idx_leads_entity_id" ON "public"."leads" USING "btree" ("entity_id");



CREATE INDEX "idx_leads_form_config_id" ON "public"."leads" USING "btree" ("form_config_id");



CREATE INDEX "idx_leads_last_activity_at" ON "public"."leads" USING "btree" ("tenant_id", "last_activity_at" DESC) WHERE (("deleted_at" IS NULL) AND ("converted_at" IS NULL));



CREATE INDEX "idx_leads_lead_type" ON "public"."leads" USING "btree" ("lead_type") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_leads_not_deleted" ON "public"."leads" USING "btree" ("tenant_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_leads_owner" ON "public"."leads" USING "btree" ("tenant_id", "owner_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_leads_pipeline_id" ON "public"."leads" USING "btree" ("pipeline_id");



CREATE INDEX "idx_leads_prospect_industry" ON "public"."leads" USING "btree" ("tenant_id", "prospect_industry") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_leads_ref_code" ON "public"."leads" USING "btree" ("ref_code") WHERE ("ref_code" IS NOT NULL);



CREATE INDEX "idx_leads_session_id" ON "public"."leads" USING "btree" ("session_id");



CREATE INDEX "idx_leads_stage_id" ON "public"."leads" USING "btree" ("stage_id");



CREATE INDEX "idx_leads_status" ON "public"."leads" USING "btree" ("status");



CREATE INDEX "idx_leads_tags" ON "public"."leads" USING "gin" ("tags");



CREATE INDEX "idx_leads_tenant_branch" ON "public"."leads" USING "btree" ("tenant_id", "branch_id");



CREATE INDEX "idx_leads_tenant_created_active" ON "public"."leads" USING "btree" ("tenant_id", "created_at" DESC, "id" DESC) WHERE (("deleted_at" IS NULL) AND ("converted_at" IS NULL));



CREATE INDEX "idx_leads_tenant_id" ON "public"."leads" USING "btree" ("tenant_id");



CREATE INDEX "idx_leads_tenant_intake_active" ON "public"."leads" USING "btree" ("tenant_id", "intake_source") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_leads_tenant_list" ON "public"."leads" USING "btree" ("tenant_id", "list_id");



CREATE INDEX "idx_leads_tenant_list_created_active" ON "public"."leads" USING "btree" ("tenant_id", "list_id", "created_at" DESC) WHERE (("deleted_at" IS NULL) AND ("converted_at" IS NULL));



CREATE INDEX "idx_leads_tenant_normalized_phone" ON "public"."leads" USING "btree" ("tenant_id", "normalized_phone") WHERE ("normalized_phone" IS NOT NULL);



CREATE INDEX "idx_leads_tenant_pipeline_created_active" ON "public"."leads" USING "btree" ("tenant_id", "pipeline_id", "created_at" DESC) WHERE (("deleted_at" IS NULL) AND ("converted_at" IS NULL));



CREATE INDEX "idx_leads_tenant_status" ON "public"."leads" USING "btree" ("tenant_id", "status");



CREATE INDEX "idx_leave_adjustments_tenant_user_type_year" ON "public"."leave_adjustments" USING "btree" ("tenant_id", "tenant_user_id", "leave_type_id", "year");



CREATE INDEX "idx_leave_requests_tenant_approver" ON "public"."leave_requests" USING "btree" ("tenant_id", "approver_tenant_user_id");



CREATE INDEX "idx_leave_requests_tenant_pending" ON "public"."leave_requests" USING "btree" ("tenant_id") WHERE ("approval_status" = 'pending'::"text");



CREATE INDEX "idx_leave_requests_tenant_user" ON "public"."leave_requests" USING "btree" ("tenant_id", "tenant_user_id");



CREATE INDEX "idx_leave_types_tenant" ON "public"."leave_types" USING "btree" ("tenant_id");



CREATE INDEX "idx_messages_conversation_ts" ON "public"."messages" USING "btree" ("conversation_id", COALESCE("provider_timestamp", "created_at"));



CREATE INDEX "idx_messages_draft" ON "public"."messages" USING "btree" ("conversation_id") WHERE ("status" = 'draft'::"text");



CREATE UNIQUE INDEX "idx_messages_provider_dedup" ON "public"."messages" USING "btree" ("channel_id", "provider_message_id") WHERE ("provider_message_id" IS NOT NULL);



CREATE INDEX "idx_messages_tenant" ON "public"."messages" USING "btree" ("tenant_id");



CREATE INDEX "idx_notifications_tenant" ON "public"."notifications" USING "btree" ("tenant_id");



CREATE INDEX "idx_notifications_user_created" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_notifications_user_unread" ON "public"."notifications" USING "btree" ("user_id", "tenant_id") WHERE ("read_at" IS NULL);



CREATE INDEX "idx_org_layers_tenant" ON "public"."org_layers" USING "btree" ("tenant_id", "sort_order");



CREATE INDEX "idx_partner_colleges_tenant" ON "public"."partner_colleges" USING "btree" ("tenant_id");



CREATE INDEX "idx_pipeline_stages_pipeline_id" ON "public"."pipeline_stages" USING "btree" ("pipeline_id");



CREATE INDEX "idx_pipelines_is_default" ON "public"."pipelines" USING "btree" ("tenant_id", "is_default") WHERE ("is_default" = true);



CREATE INDEX "idx_pipelines_list_id" ON "public"."pipelines" USING "btree" ("list_id");



CREATE INDEX "idx_pipelines_tenant_id" ON "public"."pipelines" USING "btree" ("tenant_id");



CREATE INDEX "idx_positions_layer" ON "public"."positions" USING "btree" ("layer_id");



CREATE INDEX "idx_positions_tenant" ON "public"."positions" USING "btree" ("tenant_id");



CREATE INDEX "idx_project_allocations_tenant_project" ON "public"."project_allocations" USING "btree" ("tenant_id", "project_id");



CREATE INDEX "idx_project_allocations_tenant_user" ON "public"."project_allocations" USING "btree" ("tenant_id", "tenant_user_id");



CREATE INDEX "idx_project_contacts_contact" ON "public"."project_contacts" USING "btree" ("contact_id");



CREATE INDEX "idx_projects_deal_id" ON "public"."projects" USING "btree" ("deal_id");



CREATE INDEX "idx_projects_tenant_account" ON "public"."projects" USING "btree" ("tenant_id", "account_id");



CREATE INDEX "idx_projects_tenant_active" ON "public"."projects" USING "btree" ("tenant_id") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_projects_tenant_owner" ON "public"."projects" USING "btree" ("tenant_id", "owner_id") WHERE ("owner_id" IS NOT NULL);



CREATE INDEX "idx_proposal_line_items_proposal" ON "public"."proposal_line_items" USING "btree" ("tenant_id", "proposal_id");



CREATE INDEX "idx_proposal_views_proposal" ON "public"."proposal_views" USING "btree" ("tenant_id", "proposal_id", "viewed_at" DESC);



CREATE INDEX "idx_proposals_tenant_deal" ON "public"."proposals" USING "btree" ("tenant_id", "deal_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_proposals_tenant_live" ON "public"."proposals" USING "btree" ("tenant_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_services_tenant_active" ON "public"."services" USING "btree" ("tenant_id") WHERE ("is_active" = true);



CREATE INDEX "idx_skills_tenant" ON "public"."skills" USING "btree" ("tenant_id");



CREATE INDEX "idx_tasks_assignee_due" ON "public"."tasks" USING "btree" ("tenant_id", "assignee_id", "due_date") WHERE ("assignee_id" IS NOT NULL);



CREATE INDEX "idx_tasks_deal" ON "public"."tasks" USING "btree" ("deal_id") WHERE ("deal_id" IS NOT NULL);



CREATE INDEX "idx_tasks_lead" ON "public"."tasks" USING "btree" ("lead_id") WHERE ("lead_id" IS NOT NULL);



CREATE INDEX "idx_tasks_tags" ON "public"."tasks" USING "gin" ("tags");



CREATE INDEX "idx_tasks_tenant_assignee" ON "public"."tasks" USING "btree" ("tenant_id", "assignee_id") WHERE ("assignee_id" IS NOT NULL);



CREATE INDEX "idx_tasks_tenant_due" ON "public"."tasks" USING "btree" ("tenant_id", "due_date") WHERE ("due_date" IS NOT NULL);



CREATE INDEX "idx_tasks_tenant_priority" ON "public"."tasks" USING "btree" ("tenant_id", "priority");



CREATE INDEX "idx_tasks_tenant_project_position" ON "public"."tasks" USING "btree" ("tenant_id", "project_id", "position");



CREATE INDEX "idx_tenant_entities_active" ON "public"."tenant_entities" USING "btree" ("tenant_id", "is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_tenant_entities_tenant_id" ON "public"."tenant_entities" USING "btree" ("tenant_id");



CREATE INDEX "idx_tenant_users_tenant_branch" ON "public"."tenant_users" USING "btree" ("tenant_id", "branch_id");



CREATE INDEX "idx_tenant_users_tenant_id" ON "public"."tenant_users" USING "btree" ("tenant_id");



CREATE INDEX "idx_tenant_users_user_id" ON "public"."tenant_users" USING "btree" ("user_id");



CREATE INDEX "idx_tenants_industry_id" ON "public"."tenants" USING "btree" ("industry_id");



CREATE INDEX "idx_tenants_slug" ON "public"."tenants" USING "btree" ("slug");



CREATE INDEX "idx_time_entries_tenant_pending" ON "public"."time_entries" USING "btree" ("tenant_id") WHERE ("approval_status" = 'pending'::"text");



CREATE INDEX "idx_time_entries_tenant_project_date" ON "public"."time_entries" USING "btree" ("tenant_id", "project_id", "entry_date" DESC);



CREATE INDEX "idx_time_entries_tenant_user_date" ON "public"."time_entries" USING "btree" ("tenant_id", "user_id", "entry_date" DESC);



CREATE INDEX "idx_utm_links_tenant_created" ON "public"."utm_links" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_webhook_deliveries_webhook_id" ON "public"."webhook_deliveries" USING "btree" ("webhook_id");



CREATE INDEX "idx_webhook_endpoints_tenant_id" ON "public"."webhook_endpoints" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "project_contacts_one_primary" ON "public"."project_contacts" USING "btree" ("project_id") WHERE ("role" = 'primary'::"text");



CREATE UNIQUE INDEX "uniq_branches_default_per_tenant" ON "public"."branches" USING "btree" ("tenant_id") WHERE ("is_default" = true);



CREATE UNIQUE INDEX "uniq_class_enrollment_active" ON "public"."class_enrollments" USING "btree" ("tenant_id", "lead_id", "class_id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "uniq_lead_branches_origin" ON "public"."lead_branches" USING "btree" ("lead_id") WHERE "is_origin";



CREATE UNIQUE INDEX "uq_holidays_tenant_branch_date" ON "public"."holidays" USING "btree" ("tenant_id", "branch_id", "holiday_date") WHERE ("branch_id" IS NOT NULL);



CREATE UNIQUE INDEX "uq_holidays_tenant_default_date" ON "public"."holidays" USING "btree" ("tenant_id", "holiday_date") WHERE ("branch_id" IS NULL);



CREATE UNIQUE INDEX "uq_lead_types_one_default_per_tenant" ON "public"."lead_types" USING "btree" ("tenant_id") WHERE ("is_default" = true);



CREATE UNIQUE INDEX "uq_leads_tenant_display_id" ON "public"."leads" USING "btree" ("tenant_id", "display_id") WHERE ("display_id" IS NOT NULL);



CREATE UNIQUE INDEX "uq_projects_deal_id" ON "public"."projects" USING "btree" ("deal_id") WHERE ("deal_id" IS NOT NULL);



CREATE UNIQUE INDEX "uq_proposals_public_token" ON "public"."proposals" USING "btree" ("public_token") WHERE ("public_token" IS NOT NULL);



CREATE UNIQUE INDEX "uq_proposals_tenant_number" ON "public"."proposals" USING "btree" ("tenant_id", "proposal_number");



CREATE OR REPLACE TRIGGER "set_connected_email_accounts_updated_at" BEFORE UPDATE ON "public"."connected_email_accounts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_conversations_updated_at" BEFORE UPDATE ON "public"."conversations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_email_forward_rules_updated_at" BEFORE UPDATE ON "public"."email_forward_rules" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_email_sync_state_updated_at" BEFORE UPDATE ON "public"."email_sync_state" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_email_threads_updated_at" BEFORE UPDATE ON "public"."email_threads" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_inbox_channels_updated_at" BEFORE UPDATE ON "public"."inbox_channels" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_accounts_updated_at" BEFORE UPDATE ON "public"."accounts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_agents_updated_at" BEFORE UPDATE ON "public"."agents" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_application_stages_updated_at" BEFORE UPDATE ON "public"."application_stages" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_applications_updated_at" BEFORE UPDATE ON "public"."applications" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_attendance_records_updated_at" BEFORE UPDATE ON "public"."attendance_records" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_campaigns_updated_at" BEFORE UPDATE ON "public"."campaigns" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_class_enrollments_updated_at" BEFORE UPDATE ON "public"."class_enrollments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_classes_updated_at" BEFORE UPDATE ON "public"."classes" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_consent_templates_updated_at" BEFORE UPDATE ON "public"."consent_templates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_contacts_updated_at" BEFORE UPDATE ON "public"."contacts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_countries_updated_at" BEFORE UPDATE ON "public"."countries" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_courses_updated_at" BEFORE UPDATE ON "public"."courses" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_deal_pipelines_updated_at" BEFORE UPDATE ON "public"."deal_pipelines" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_deal_stages_updated_at" BEFORE UPDATE ON "public"."deal_stages" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_deals_updated_at" BEFORE UPDATE ON "public"."deals" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_employee_profiles_updated_at" BEFORE UPDATE ON "public"."employee_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_ensure_single_default_deal_pipeline" BEFORE INSERT OR UPDATE OF "is_default" ON "public"."deal_pipelines" FOR EACH ROW WHEN (("new"."is_default" = true)) EXECUTE FUNCTION "public"."ensure_single_default_deal_pipeline"();



CREATE OR REPLACE TRIGGER "trigger_ensure_single_default_pipeline" BEFORE INSERT OR UPDATE OF "is_default" ON "public"."pipelines" FOR EACH ROW WHEN (("new"."is_default" = true)) EXECUTE FUNCTION "public"."ensure_single_default_pipeline"();



CREATE OR REPLACE TRIGGER "trigger_form_configs_updated_at" BEFORE UPDATE ON "public"."form_configs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_import_sources_updated_at" BEFORE UPDATE ON "public"."lead_import_sources" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_lead_consents_updated_at" BEFORE UPDATE ON "public"."lead_consents" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_lead_lists_updated_at" BEFORE UPDATE ON "public"."lead_lists" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_leads_updated_at" BEFORE UPDATE ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_leave_requests_updated_at" BEFORE UPDATE ON "public"."leave_requests" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_partner_colleges_updated_at" BEFORE UPDATE ON "public"."partner_colleges" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_pipeline_stages_updated_at" BEFORE UPDATE ON "public"."pipeline_stages" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_pipelines_updated_at" BEFORE UPDATE ON "public"."pipelines" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_projects_updated_at" BEFORE UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_proposal_line_items_updated_at" BEFORE UPDATE ON "public"."proposal_line_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_proposals_set_number" BEFORE INSERT ON "public"."proposals" FOR EACH ROW EXECUTE FUNCTION "public"."set_proposal_number"();



CREATE OR REPLACE TRIGGER "trigger_proposals_updated_at" BEFORE UPDATE ON "public"."proposals" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_services_updated_at" BEFORE UPDATE ON "public"."services" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_tasks_updated_at" BEFORE UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_tenant_entities_updated_at" BEFORE UPDATE ON "public"."tenant_entities" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_tenants_updated_at" BEFORE UPDATE ON "public"."tenants" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_time_entries_updated_at" BEFORE UPDATE ON "public"."time_entries" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "update_lead_activities_updated_at" BEFORE UPDATE ON "public"."lead_activities" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "update_lead_checklists_updated_at" BEFORE UPDATE ON "public"."lead_checklists" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "update_lead_insights_updated_at" BEFORE UPDATE ON "public"."lead_insights" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_primary_contact_id_fkey" FOREIGN KEY ("primary_contact_id") REFERENCES "public"."contacts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."affiliates"
    ADD CONSTRAINT "affiliates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agents"
    ADD CONSTRAINT "agents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."application_stages"
    ADD CONSTRAINT "application_stages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "public"."application_stages"("id");



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attendance_records"
    ADD CONSTRAINT "attendance_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attendance_records"
    ADD CONSTRAINT "attendance_records_tenant_user_id_fkey" FOREIGN KEY ("tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attendance_records"
    ADD CONSTRAINT "attendance_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."automation_email_log"
    ADD CONSTRAINT "automation_email_log_form_config_id_fkey" FOREIGN KEY ("form_config_id") REFERENCES "public"."form_configs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."automation_email_log"
    ADD CONSTRAINT "automation_email_log_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."automation_email_log"
    ADD CONSTRAINT "automation_email_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_manager_user_id_fkey" FOREIGN KEY ("manager_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_results"
    ADD CONSTRAINT "campaign_results_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_results"
    ADD CONSTRAINT "campaign_results_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_form_config_id_fkey" FOREIGN KEY ("form_config_id") REFERENCES "public"."form_configs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."class_enrollments"
    ADD CONSTRAINT "class_enrollments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."class_enrollments"
    ADD CONSTRAINT "class_enrollments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."class_enrollments"
    ADD CONSTRAINT "class_enrollments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."classes"
    ADD CONSTRAINT "classes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."connected_email_accounts"
    ADD CONSTRAINT "connected_email_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."connected_email_accounts"
    ADD CONSTRAINT "connected_email_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."consent_templates"
    ADD CONSTRAINT "consent_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."inbox_channels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."countries"
    ADD CONSTRAINT "countries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dashboards"
    ADD CONSTRAINT "dashboards_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deal_contacts"
    ADD CONSTRAINT "deal_contacts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deal_contacts"
    ADD CONSTRAINT "deal_contacts_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deal_pipelines"
    ADD CONSTRAINT "deal_pipelines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deal_stages"
    ADD CONSTRAINT "deal_stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "public"."deal_pipelines"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deal_stages"
    ADD CONSTRAINT "deal_stages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deals"
    ADD CONSTRAINT "deals_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."deals"
    ADD CONSTRAINT "deals_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."deals"
    ADD CONSTRAINT "deals_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."deals"
    ADD CONSTRAINT "deals_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "public"."deal_pipelines"("id");



ALTER TABLE ONLY "public"."deals"
    ADD CONSTRAINT "deals_primary_contact_id_fkey" FOREIGN KEY ("primary_contact_id") REFERENCES "public"."contacts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."deals"
    ADD CONSTRAINT "deals_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "public"."deal_stages"("id");



ALTER TABLE ONLY "public"."deals"
    ADD CONSTRAINT "deals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_lead_tenant_user_id_fkey" FOREIGN KEY ("lead_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_forward_rules"
    ADD CONSTRAINT "email_forward_rules_email_account_id_fkey" FOREIGN KEY ("email_account_id") REFERENCES "public"."connected_email_accounts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."email_forward_rules"
    ADD CONSTRAINT "email_forward_rules_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_forward_rules"
    ADD CONSTRAINT "email_forward_rules_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_forward_rules"
    ADD CONSTRAINT "email_forward_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_sync_state"
    ADD CONSTRAINT "email_sync_state_connected_email_account_id_fkey" FOREIGN KEY ("connected_email_account_id") REFERENCES "public"."connected_email_accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_threads"
    ADD CONSTRAINT "email_threads_connected_email_account_id_fkey" FOREIGN KEY ("connected_email_account_id") REFERENCES "public"."connected_email_accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_threads"
    ADD CONSTRAINT "email_threads_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."email_threads"
    ADD CONSTRAINT "email_threads_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."email_threads"
    ADD CONSTRAINT "email_threads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."emails"
    ADD CONSTRAINT "emails_connected_email_account_id_fkey" FOREIGN KEY ("connected_email_account_id") REFERENCES "public"."connected_email_accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."emails"
    ADD CONSTRAINT "emails_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."emails"
    ADD CONSTRAINT "emails_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."emails"
    ADD CONSTRAINT "emails_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."email_threads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_profiles"
    ADD CONSTRAINT "employee_profiles_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_profiles"
    ADD CONSTRAINT "employee_profiles_manager_tenant_user_id_fkey" FOREIGN KEY ("manager_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_profiles"
    ADD CONSTRAINT "employee_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_profiles"
    ADD CONSTRAINT "employee_profiles_tenant_user_id_fkey" FOREIGN KEY ("tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_skills"
    ADD CONSTRAINT "employee_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_skills"
    ADD CONSTRAINT "employee_skills_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_skills"
    ADD CONSTRAINT "employee_skills_tenant_user_id_fkey" FOREIGN KEY ("tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."form_configs"
    ADD CONSTRAINT "form_configs_target_pipeline_id_fkey" FOREIGN KEY ("target_pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."form_configs"
    ADD CONSTRAINT "form_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."holidays"
    ADD CONSTRAINT "holidays_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."holidays"
    ADD CONSTRAINT "holidays_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inbox_channels"
    ADD CONSTRAINT "inbox_channels_connected_by_user_id_fkey" FOREIGN KEY ("connected_by_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inbox_channels"
    ADD CONSTRAINT "inbox_channels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."integration_idempotency"
    ADD CONSTRAINT "integration_idempotency_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."integration_keys"
    ADD CONSTRAINT "integration_keys_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."form_configs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."integration_keys"
    ADD CONSTRAINT "integration_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invite_tokens"
    ADD CONSTRAINT "invite_tokens_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invite_tokens"
    ADD CONSTRAINT "invite_tokens_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invite_tokens"
    ADD CONSTRAINT "invite_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."knowledge_base_items"
    ADD CONSTRAINT "knowledge_base_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."knowledge_base_items"
    ADD CONSTRAINT "knowledge_base_items_knowledge_base_id_fkey" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."knowledge_base_items"
    ADD CONSTRAINT "knowledge_base_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."knowledge_bases"
    ADD CONSTRAINT "knowledge_bases_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."knowledge_bases"
    ADD CONSTRAINT "knowledge_bases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_activities"
    ADD CONSTRAINT "lead_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_activities"
    ADD CONSTRAINT "lead_activities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_activities"
    ADD CONSTRAINT "lead_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."lead_assignment_history"
    ADD CONSTRAINT "lead_assignment_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_assignment_history"
    ADD CONSTRAINT "lead_assignment_history_from_position_id_fkey" FOREIGN KEY ("from_position_id") REFERENCES "public"."positions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_assignment_history"
    ADD CONSTRAINT "lead_assignment_history_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_assignment_history"
    ADD CONSTRAINT "lead_assignment_history_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_assignment_history"
    ADD CONSTRAINT "lead_assignment_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_assignment_history"
    ADD CONSTRAINT "lead_assignment_history_to_position_id_fkey" FOREIGN KEY ("to_position_id") REFERENCES "public"."positions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_assignment_history"
    ADD CONSTRAINT "lead_assignment_history_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_branches"
    ADD CONSTRAINT "lead_branches_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_branches"
    ADD CONSTRAINT "lead_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_branches"
    ADD CONSTRAINT "lead_branches_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_branches"
    ADD CONSTRAINT "lead_branches_shared_by_fkey" FOREIGN KEY ("shared_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_branches"
    ADD CONSTRAINT "lead_branches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_checklists"
    ADD CONSTRAINT "lead_checklists_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_checklists"
    ADD CONSTRAINT "lead_checklists_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_checklists"
    ADD CONSTRAINT "lead_checklists_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_collaborators"
    ADD CONSTRAINT "lead_collaborators_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_collaborators"
    ADD CONSTRAINT "lead_collaborators_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_collaborators"
    ADD CONSTRAINT "lead_collaborators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_consents"
    ADD CONSTRAINT "lead_consents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_consents"
    ADD CONSTRAINT "lead_consents_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_consents"
    ADD CONSTRAINT "lead_consents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_duplicate_suggestions"
    ADD CONSTRAINT "lead_duplicate_suggestions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_duplicate_suggestions"
    ADD CONSTRAINT "lead_duplicate_suggestions_suggested_lead_id_fkey" FOREIGN KEY ("suggested_lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_duplicate_suggestions"
    ADD CONSTRAINT "lead_duplicate_suggestions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_import_sources"
    ADD CONSTRAINT "lead_import_sources_staging_list_id_fkey" FOREIGN KEY ("staging_list_id") REFERENCES "public"."lead_lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_import_sources"
    ADD CONSTRAINT "lead_import_sources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_insights"
    ADD CONSTRAINT "lead_insights_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_insights"
    ADD CONSTRAINT "lead_insights_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_lists"
    ADD CONSTRAINT "lead_lists_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_lists"
    ADD CONSTRAINT "lead_lists_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_merges"
    ADD CONSTRAINT "lead_merges_absorbed_id_fkey" FOREIGN KEY ("absorbed_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_merges"
    ADD CONSTRAINT "lead_merges_canonical_id_fkey" FOREIGN KEY ("canonical_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_merges"
    ADD CONSTRAINT "lead_merges_synthesized_submission_id_fkey" FOREIGN KEY ("synthesized_submission_id") REFERENCES "public"."lead_submissions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_merges"
    ADD CONSTRAINT "lead_merges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_move_log"
    ADD CONSTRAINT "lead_move_log_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_move_log"
    ADD CONSTRAINT "lead_move_log_collaborator_added_user_id_fkey" FOREIGN KEY ("collaborator_added_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_move_log"
    ADD CONSTRAINT "lead_move_log_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_move_log"
    ADD CONSTRAINT "lead_move_log_new_assigned_to_fkey" FOREIGN KEY ("new_assigned_to") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_move_log"
    ADD CONSTRAINT "lead_move_log_new_list_id_fkey" FOREIGN KEY ("new_list_id") REFERENCES "public"."lead_lists"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_move_log"
    ADD CONSTRAINT "lead_move_log_prev_assigned_to_fkey" FOREIGN KEY ("prev_assigned_to") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_move_log"
    ADD CONSTRAINT "lead_move_log_prev_list_id_fkey" FOREIGN KEY ("prev_list_id") REFERENCES "public"."lead_lists"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_move_log"
    ADD CONSTRAINT "lead_move_log_prev_pipeline_id_fkey" FOREIGN KEY ("prev_pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_move_log"
    ADD CONSTRAINT "lead_move_log_prev_stage_id_fkey" FOREIGN KEY ("prev_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_move_log"
    ADD CONSTRAINT "lead_move_log_reverted_by_fkey" FOREIGN KEY ("reverted_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_move_log"
    ADD CONSTRAINT "lead_move_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_notes"
    ADD CONSTRAINT "lead_notes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_notes"
    ADD CONSTRAINT "lead_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."lead_submissions"
    ADD CONSTRAINT "lead_submissions_form_config_id_fkey" FOREIGN KEY ("form_config_id") REFERENCES "public"."form_configs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_submissions"
    ADD CONSTRAINT "lead_submissions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_submissions"
    ADD CONSTRAINT "lead_submissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_types"
    ADD CONSTRAINT "lead_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_archived_by_fkey" FOREIGN KEY ("archived_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_archived_from_list_id_fkey" FOREIGN KEY ("archived_from_list_id") REFERENCES "public"."lead_lists"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_converted_contact_id_fkey" FOREIGN KEY ("converted_contact_id") REFERENCES "public"."contacts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "public"."tenant_entities"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_form_config_id_fkey" FOREIGN KEY ("form_config_id") REFERENCES "public"."form_configs"("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "public"."lead_lists"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_merged_into_fkey" FOREIGN KEY ("merged_into") REFERENCES "public"."leads"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leave_adjustments"
    ADD CONSTRAINT "leave_adjustments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."leave_adjustments"
    ADD CONSTRAINT "leave_adjustments_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id");



ALTER TABLE ONLY "public"."leave_adjustments"
    ADD CONSTRAINT "leave_adjustments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leave_adjustments"
    ADD CONSTRAINT "leave_adjustments_tenant_user_id_fkey" FOREIGN KEY ("tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leave_requests"
    ADD CONSTRAINT "leave_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leave_requests"
    ADD CONSTRAINT "leave_requests_approver_tenant_user_id_fkey" FOREIGN KEY ("approver_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leave_requests"
    ADD CONSTRAINT "leave_requests_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id");



ALTER TABLE ONLY "public"."leave_requests"
    ADD CONSTRAINT "leave_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leave_requests"
    ADD CONSTRAINT "leave_requests_tenant_user_id_fkey" FOREIGN KEY ("tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leave_requests"
    ADD CONSTRAINT "leave_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."leave_types"
    ADD CONSTRAINT "leave_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."inbox_channels"("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_layers"
    ADD CONSTRAINT "org_layers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."partner_colleges"
    ADD CONSTRAINT "partner_colleges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_stages"
    ADD CONSTRAINT "pipeline_stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_stages"
    ADD CONSTRAINT "pipeline_stages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipelines"
    ADD CONSTRAINT "pipelines_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "public"."lead_lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipelines"
    ADD CONSTRAINT "pipelines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."positions"
    ADD CONSTRAINT "positions_layer_id_fkey" FOREIGN KEY ("layer_id") REFERENCES "public"."org_layers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."positions"
    ADD CONSTRAINT "positions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_allocations"
    ADD CONSTRAINT "project_allocations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_allocations"
    ADD CONSTRAINT "project_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_allocations"
    ADD CONSTRAINT "project_allocations_tenant_user_id_fkey" FOREIGN KEY ("tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_contacts"
    ADD CONSTRAINT "project_contacts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_contacts"
    ADD CONSTRAINT "project_contacts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."proposal_line_items"
    ADD CONSTRAINT "proposal_line_items_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."proposal_line_items"
    ADD CONSTRAINT "proposal_line_items_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."proposal_line_items"
    ADD CONSTRAINT "proposal_line_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."proposal_views"
    ADD CONSTRAINT "proposal_views_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."proposal_views"
    ADD CONSTRAINT "proposal_views_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."proposals"
    ADD CONSTRAINT "proposals_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."proposals"
    ADD CONSTRAINT "proposals_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."proposals"
    ADD CONSTRAINT "proposals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."skills"
    ADD CONSTRAINT "skills_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tenant_email_settings"
    ADD CONSTRAINT "tenant_email_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tenant_email_settings"
    ADD CONSTRAINT "tenant_email_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tenant_entities"
    ADD CONSTRAINT "tenant_entities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tenant_users"
    ADD CONSTRAINT "tenant_users_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tenant_users"
    ADD CONSTRAINT "tenant_users_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tenant_users"
    ADD CONSTRAINT "tenant_users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tenant_users"
    ADD CONSTRAINT "tenant_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_industry_id_fkey" FOREIGN KEY ("industry_id") REFERENCES "public"."industries"("id");



ALTER TABLE ONLY "public"."time_entries"
    ADD CONSTRAINT "time_entries_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."time_entries"
    ADD CONSTRAINT "time_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."time_entries"
    ADD CONSTRAINT "time_entries_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."time_entries"
    ADD CONSTRAINT "time_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."time_entries"
    ADD CONSTRAINT "time_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."utm_links"
    ADD CONSTRAINT "utm_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."utm_links"
    ADD CONSTRAINT "utm_links_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."form_configs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."utm_links"
    ADD CONSTRAINT "utm_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."webhook_deliveries"
    ADD CONSTRAINT "webhook_deliveries_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."webhook_endpoints"
    ADD CONSTRAINT "webhook_endpoints_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can delete entities" ON "public"."tenant_entities" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Admins can delete forms" ON "public"."form_configs" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Admins can delete leads" ON "public"."leads" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Admins can delete pipeline stages" ON "public"."pipeline_stages" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Admins can delete pipelines" ON "public"."pipelines" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Admins can delete tenant users" ON "public"."tenant_users" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Admins can insert entities" ON "public"."tenant_entities" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Admins can insert pipeline stages" ON "public"."pipeline_stages" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Admins can insert pipelines" ON "public"."pipelines" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Admins can insert tenant users" ON "public"."tenant_users" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Admins can manage forms" ON "public"."form_configs" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Admins can update entities" ON "public"."tenant_entities" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Admins can update forms" ON "public"."form_configs" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Admins can update leads" ON "public"."leads" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Admins can update pipeline stages" ON "public"."pipeline_stages" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Admins can update pipelines" ON "public"."pipelines" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Admins can update tenant users" ON "public"."tenant_users" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Admins can update tenants" ON "public"."tenants" FOR UPDATE USING ("public"."is_tenant_admin"("id"));



CREATE POLICY "Anon can insert leads" ON "public"."leads" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "Anon can read own session leads" ON "public"."leads" FOR SELECT TO "anon" USING (true);



CREATE POLICY "Anon can update own session" ON "public"."leads" FOR UPDATE TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Anyone can view industries" ON "public"."industries" FOR SELECT USING (true);



CREATE POLICY "No direct access" ON "public"."integration_idempotency" USING (false);



CREATE POLICY "No direct access" ON "public"."integration_keys" USING (false);



CREATE POLICY "No direct access" ON "public"."webhook_deliveries" USING (false);



CREATE POLICY "No direct access" ON "public"."webhook_endpoints" USING (false);



CREATE POLICY "Public can read active entities" ON "public"."tenant_entities" FOR SELECT TO "anon" USING (("is_active" = true));



CREATE POLICY "Public can read active forms" ON "public"."form_configs" FOR SELECT TO "anon" USING (("is_active" = true));



CREATE POLICY "Public can read pipeline stages" ON "public"."pipeline_stages" FOR SELECT TO "anon" USING (true);



CREATE POLICY "Public can read tenants" ON "public"."tenants" FOR SELECT TO "anon" USING (true);



CREATE POLICY "Service can insert notifications" ON "public"."notifications" FOR INSERT WITH CHECK (true);



CREATE POLICY "Service role full access to connected accounts" ON "public"."connected_email_accounts" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access to conversations" ON "public"."conversations" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access to email rules" ON "public"."email_forward_rules" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access to email settings" ON "public"."tenant_email_settings" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access to email threads" ON "public"."email_threads" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access to emails" ON "public"."emails" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access to inbox channels" ON "public"."inbox_channels" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access to messages" ON "public"."messages" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access to sync state" ON "public"."email_sync_state" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Tenant admins can delete email rules" ON "public"."email_forward_rules" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Tenant admins can insert email rules" ON "public"."email_forward_rules" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Tenant admins can mutate email settings" ON "public"."tenant_email_settings" USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Tenant admins can mutate email threads" ON "public"."email_threads" USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Tenant admins can mutate emails" ON "public"."emails" USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Tenant admins can mutate inbox channels" ON "public"."inbox_channels" USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Tenant admins can update dup suggestions" ON "public"."lead_duplicate_suggestions" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Tenant admins can update email rules" ON "public"."email_forward_rules" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Tenant admins can view all tenant connected accounts" ON "public"."connected_email_accounts" FOR SELECT USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Tenant admins can view events" ON "public"."events" FOR SELECT USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "Tenant admins can view invites" ON "public"."invite_tokens" FOR SELECT USING (("tenant_id" IN ( SELECT "tenant_users"."tenant_id"
   FROM "public"."tenant_users"
  WHERE (("tenant_users"."user_id" = "auth"."uid"()) AND (("tenant_users"."role")::"text" = ANY (ARRAY[('owner'::character varying)::"text", ('admin'::character varying)::"text"]))))));



CREATE POLICY "Tenant isolation for lead_insights" ON "public"."lead_insights" USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "Tenant members can manage conversations" ON "public"."conversations" USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids"))) WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "Tenant members can manage messages" ON "public"."messages" USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids"))) WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "Tenant members can view audit logs" ON "public"."audit_logs" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "Tenant members can view dup suggestions" ON "public"."lead_duplicate_suggestions" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "Tenant members can view email rules" ON "public"."email_forward_rules" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "Tenant members can view email settings" ON "public"."tenant_email_settings" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "Tenant members can view email threads" ON "public"."email_threads" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "Tenant members can view emails" ON "public"."emails" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "Tenant members can view inbox channels" ON "public"."inbox_channels" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "Tenant members can view lead checklists" ON "public"."lead_checklists" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "Tenant members can view lead merges" ON "public"."lead_merges" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "Tenant members can view lead submissions" ON "public"."lead_submissions" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "Tenant members can view pipeline stages" ON "public"."pipeline_stages" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "Tenant members can view pipelines" ON "public"."pipelines" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "Tenant members can view their entities" ON "public"."tenant_entities" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "Users can add notes" ON "public"."lead_notes" FOR INSERT WITH CHECK (("lead_id" IN ( SELECT "leads"."id"
   FROM "public"."leads"
  WHERE ("leads"."tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")))));



CREATE POLICY "Users can delete own connected accounts" ON "public"."connected_email_accounts" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can delete own notes" ON "public"."lead_notes" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can delete own notifications" ON "public"."notifications" FOR DELETE USING ((("user_id" = "auth"."uid"()) AND ("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids"))));



CREATE POLICY "Users can insert own connected accounts" ON "public"."connected_email_accounts" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update own connected accounts" ON "public"."connected_email_accounts" FOR UPDATE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update own notifications" ON "public"."notifications" FOR UPDATE USING ((("user_id" = "auth"."uid"()) AND ("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")))) WITH CHECK ((("user_id" = "auth"."uid"()) AND ("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids"))));



CREATE POLICY "Users can view own connected accounts" ON "public"."connected_email_accounts" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view own notifications" ON "public"."notifications" FOR SELECT USING ((("user_id" = "auth"."uid"()) AND ("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids"))));



CREATE POLICY "Users can view own sync state" ON "public"."email_sync_state" FOR SELECT USING (("connected_email_account_id" IN ( SELECT "connected_email_accounts"."id"
   FROM "public"."connected_email_accounts"
  WHERE ("connected_email_accounts"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view tenant lead notes" ON "public"."lead_notes" FOR SELECT USING (("lead_id" IN ( SELECT "leads"."id"
   FROM "public"."leads"
  WHERE ("leads"."tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")))));



CREATE POLICY "Users can view tenant leads" ON "public"."leads" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "Users can view their memberships" ON "public"."tenant_users" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view their tenant forms" ON "public"."form_configs" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "Users can view their tenants" ON "public"."tenants" FOR SELECT USING (("id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "accounts_delete" ON "public"."accounts" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "accounts_insert" ON "public"."accounts" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "accounts_select" ON "public"."accounts" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "accounts_update" ON "public"."accounts" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."affiliates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "affiliates_delete" ON "public"."affiliates" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "affiliates_insert" ON "public"."affiliates" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "affiliates_select" ON "public"."affiliates" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "affiliates_update" ON "public"."affiliates" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."agents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agents_delete" ON "public"."agents" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "agents_insert" ON "public"."agents" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "agents_select" ON "public"."agents" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "agents_update" ON "public"."agents" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."application_stages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "application_stages_delete" ON "public"."application_stages" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "application_stages_insert" ON "public"."application_stages" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "application_stages_select" ON "public"."application_stages" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "application_stages_update" ON "public"."application_stages" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."applications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "applications_delete" ON "public"."applications" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "applications_insert" ON "public"."applications" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "applications_select" ON "public"."applications" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "applications_update" ON "public"."applications" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."attendance_records" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attendance_records_delete" ON "public"."attendance_records" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "attendance_records_insert" ON "public"."attendance_records" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "attendance_records_select" ON "public"."attendance_records" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "attendance_records_update" ON "public"."attendance_records" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."automation_email_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."branches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "branches_delete" ON "public"."branches" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "branches_insert" ON "public"."branches" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "branches_select" ON "public"."branches" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "branches_update" ON "public"."branches" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."campaign_results" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "campaign_results_delete" ON "public"."campaign_results" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "campaign_results_insert" ON "public"."campaign_results" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "campaign_results_select" ON "public"."campaign_results" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "campaign_results_update" ON "public"."campaign_results" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."campaigns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "campaigns_delete" ON "public"."campaigns" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "campaigns_insert" ON "public"."campaigns" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "campaigns_select" ON "public"."campaigns" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "campaigns_update" ON "public"."campaigns" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."class_enrollments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "class_enrollments_delete" ON "public"."class_enrollments" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "class_enrollments_insert" ON "public"."class_enrollments" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "class_enrollments_select" ON "public"."class_enrollments" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "class_enrollments_update" ON "public"."class_enrollments" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."classes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "classes_delete" ON "public"."classes" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "classes_insert" ON "public"."classes" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "classes_select" ON "public"."classes" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "classes_update" ON "public"."classes" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."connected_email_accounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."consent_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "consent_templates_delete" ON "public"."consent_templates" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "consent_templates_insert" ON "public"."consent_templates" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "consent_templates_select" ON "public"."consent_templates" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "consent_templates_update" ON "public"."consent_templates" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contacts_delete" ON "public"."contacts" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "contacts_insert" ON "public"."contacts" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "contacts_select" ON "public"."contacts" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "contacts_update" ON "public"."contacts" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."countries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "countries_delete" ON "public"."countries" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "countries_insert" ON "public"."countries" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "countries_select" ON "public"."countries" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "countries_update" ON "public"."countries" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."courses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "courses_delete" ON "public"."courses" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "courses_insert" ON "public"."courses" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "courses_select" ON "public"."courses" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "courses_update" ON "public"."courses" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."dashboards" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dashboards_delete" ON "public"."dashboards" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "dashboards_insert" ON "public"."dashboards" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "dashboards_select" ON "public"."dashboards" FOR SELECT USING ((("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")) AND ("public"."is_tenant_admin"("tenant_id") OR (EXISTS ( SELECT 1
   FROM "public"."tenant_users" "tu"
  WHERE (("tu"."user_id" = "auth"."uid"()) AND ("tu"."tenant_id" = "dashboards"."tenant_id") AND ("tu"."position_id" = ANY ("dashboards"."granted_position_ids"))))))));



CREATE POLICY "dashboards_update" ON "public"."dashboards" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."deal_contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deal_contacts_delete" ON "public"."deal_contacts" FOR DELETE USING (((EXISTS ( SELECT 1
   FROM "public"."contacts" "c"
  WHERE (("c"."id" = "deal_contacts"."contact_id") AND "public"."is_tenant_admin"("c"."tenant_id")))) AND (EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "deal_contacts"."deal_id") AND "public"."is_tenant_admin"("d"."tenant_id"))))));



CREATE POLICY "deal_contacts_insert" ON "public"."deal_contacts" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."contacts" "c"
  WHERE (("c"."id" = "deal_contacts"."contact_id") AND "public"."is_tenant_admin"("c"."tenant_id")))) AND (EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "deal_contacts"."deal_id") AND "public"."is_tenant_admin"("d"."tenant_id"))))));



CREATE POLICY "deal_contacts_select" ON "public"."deal_contacts" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."contacts" "c"
  WHERE (("c"."id" = "deal_contacts"."contact_id") AND ("c"."tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids"))))) AND (EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "deal_contacts"."deal_id") AND ("d"."tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")))))));



CREATE POLICY "deal_contacts_update" ON "public"."deal_contacts" FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM "public"."contacts" "c"
  WHERE (("c"."id" = "deal_contacts"."contact_id") AND "public"."is_tenant_admin"("c"."tenant_id")))) AND (EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "deal_contacts"."deal_id") AND "public"."is_tenant_admin"("d"."tenant_id")))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."contacts" "c"
  WHERE (("c"."id" = "deal_contacts"."contact_id") AND "public"."is_tenant_admin"("c"."tenant_id")))) AND (EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "deal_contacts"."deal_id") AND "public"."is_tenant_admin"("d"."tenant_id"))))));



ALTER TABLE "public"."deal_pipelines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deal_pipelines_delete" ON "public"."deal_pipelines" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "deal_pipelines_insert" ON "public"."deal_pipelines" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "deal_pipelines_select" ON "public"."deal_pipelines" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "deal_pipelines_update" ON "public"."deal_pipelines" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."deal_stages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deal_stages_delete" ON "public"."deal_stages" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "deal_stages_insert" ON "public"."deal_stages" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "deal_stages_select" ON "public"."deal_stages" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "deal_stages_update" ON "public"."deal_stages" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."deals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deals_delete" ON "public"."deals" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "deals_insert" ON "public"."deals" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "deals_select" ON "public"."deals" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "deals_update" ON "public"."deals" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."departments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "departments_delete" ON "public"."departments" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "departments_insert" ON "public"."departments" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "departments_select" ON "public"."departments" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "departments_update" ON "public"."departments" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."email_forward_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_sync_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_threads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."emails" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "employee_profiles_delete" ON "public"."employee_profiles" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "employee_profiles_insert" ON "public"."employee_profiles" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "employee_profiles_select" ON "public"."employee_profiles" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "employee_profiles_update" ON "public"."employee_profiles" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."employee_skills" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "employee_skills_delete" ON "public"."employee_skills" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "employee_skills_insert" ON "public"."employee_skills" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "employee_skills_select" ON "public"."employee_skills" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "employee_skills_update" ON "public"."employee_skills" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."form_configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."holidays" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "holidays_delete" ON "public"."holidays" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "holidays_insert" ON "public"."holidays" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "holidays_select" ON "public"."holidays" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "holidays_update" ON "public"."holidays" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "import_sources_delete" ON "public"."lead_import_sources" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "import_sources_insert" ON "public"."lead_import_sources" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "import_sources_select" ON "public"."lead_import_sources" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "import_sources_update" ON "public"."lead_import_sources" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."inbox_channels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."industries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."integration_idempotency" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."integration_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invite_tokens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "kb_delete" ON "public"."knowledge_bases" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "kb_insert" ON "public"."knowledge_bases" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "kb_items_delete" ON "public"."knowledge_base_items" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "kb_items_insert" ON "public"."knowledge_base_items" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "kb_items_select" ON "public"."knowledge_base_items" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "kb_items_update" ON "public"."knowledge_base_items" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "kb_select" ON "public"."knowledge_bases" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "kb_update" ON "public"."knowledge_bases" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."knowledge_base_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."knowledge_bases" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lah_insert" ON "public"."lead_assignment_history" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "lah_select" ON "public"."lead_assignment_history" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."lead_activities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_activities_delete" ON "public"."lead_activities" FOR DELETE USING (("public"."is_tenant_admin"("tenant_id") OR ("user_id" = "auth"."uid"())));



CREATE POLICY "lead_activities_insert" ON "public"."lead_activities" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "lead_activities_select" ON "public"."lead_activities" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "lead_activities_update" ON "public"."lead_activities" FOR UPDATE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."lead_assignment_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lead_branches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_branches_delete" ON "public"."lead_branches" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "lead_branches_insert" ON "public"."lead_branches" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "lead_branches_select" ON "public"."lead_branches" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "lead_branches_update" ON "public"."lead_branches" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."lead_checklists" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lead_collaborators" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_collaborators_delete" ON "public"."lead_collaborators" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "lead_collaborators_insert" ON "public"."lead_collaborators" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "lead_collaborators_select" ON "public"."lead_collaborators" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."lead_consents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_consents_delete" ON "public"."lead_consents" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "lead_consents_insert" ON "public"."lead_consents" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "lead_consents_select" ON "public"."lead_consents" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "lead_consents_update" ON "public"."lead_consents" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."lead_duplicate_suggestions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lead_import_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lead_insights" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lead_lists" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_lists_delete" ON "public"."lead_lists" FOR DELETE USING (("public"."is_tenant_admin"("tenant_id") AND ("is_system" = false)));



CREATE POLICY "lead_lists_insert" ON "public"."lead_lists" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "lead_lists_select" ON "public"."lead_lists" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "lead_lists_update" ON "public"."lead_lists" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."lead_merges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lead_move_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_move_log_insert" ON "public"."lead_move_log" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "lead_move_log_select" ON "public"."lead_move_log" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "lead_move_log_update" ON "public"."lead_move_log" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."lead_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lead_submissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lead_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_types_delete" ON "public"."lead_types" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "lead_types_insert" ON "public"."lead_types" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "lead_types_select" ON "public"."lead_types" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "lead_types_update" ON "public"."lead_types" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leave_adjustments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "leave_adjustments_delete" ON "public"."leave_adjustments" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "leave_adjustments_insert" ON "public"."leave_adjustments" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "leave_adjustments_select" ON "public"."leave_adjustments" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "leave_adjustments_update" ON "public"."leave_adjustments" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."leave_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "leave_requests_insert" ON "public"."leave_requests" FOR INSERT WITH CHECK ((("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")) AND ("user_id" = "auth"."uid"()) AND ("approval_status" = 'pending'::"text")));



CREATE POLICY "leave_requests_select" ON "public"."leave_requests" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "leave_requests_update" ON "public"."leave_requests" FOR UPDATE USING (((("user_id" = "auth"."uid"()) AND ("approval_status" = 'pending'::"text")) OR "public"."is_tenant_admin"("tenant_id"))) WITH CHECK (((("user_id" = "auth"."uid"()) AND ("approval_status" = 'pending'::"text")) OR "public"."is_tenant_admin"("tenant_id")));



ALTER TABLE "public"."leave_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "leave_types_delete" ON "public"."leave_types" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "leave_types_insert" ON "public"."leave_types" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "leave_types_select" ON "public"."leave_types" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "leave_types_update" ON "public"."leave_types" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "members read" ON "public"."automation_email_log" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."org_layers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "org_layers_delete" ON "public"."org_layers" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "org_layers_insert" ON "public"."org_layers" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "org_layers_select" ON "public"."org_layers" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "org_layers_update" ON "public"."org_layers" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."partner_colleges" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "partner_colleges_delete" ON "public"."partner_colleges" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "partner_colleges_insert" ON "public"."partner_colleges" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "partner_colleges_select" ON "public"."partner_colleges" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "partner_colleges_update" ON "public"."partner_colleges" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."pipeline_stages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pipelines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."positions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "positions_delete" ON "public"."positions" FOR DELETE USING (("public"."is_tenant_admin"("tenant_id") AND ("is_system" = false)));



CREATE POLICY "positions_insert" ON "public"."positions" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "positions_select" ON "public"."positions" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "positions_update" ON "public"."positions" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."project_allocations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "project_allocations_delete" ON "public"."project_allocations" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "project_allocations_insert" ON "public"."project_allocations" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "project_allocations_select" ON "public"."project_allocations" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "project_allocations_update" ON "public"."project_allocations" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."project_contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "project_contacts_delete" ON "public"."project_contacts" FOR DELETE USING (((EXISTS ( SELECT 1
   FROM "public"."contacts" "c"
  WHERE (("c"."id" = "project_contacts"."contact_id") AND "public"."is_tenant_admin"("c"."tenant_id")))) AND (EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "project_contacts"."project_id") AND "public"."is_tenant_admin"("p"."tenant_id"))))));



CREATE POLICY "project_contacts_insert" ON "public"."project_contacts" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."contacts" "c"
  WHERE (("c"."id" = "project_contacts"."contact_id") AND "public"."is_tenant_admin"("c"."tenant_id")))) AND (EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "project_contacts"."project_id") AND "public"."is_tenant_admin"("p"."tenant_id"))))));



CREATE POLICY "project_contacts_select" ON "public"."project_contacts" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."contacts" "c"
  WHERE (("c"."id" = "project_contacts"."contact_id") AND ("c"."tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids"))))) AND (EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "project_contacts"."project_id") AND ("p"."tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")))))));



ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "projects_delete" ON "public"."projects" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "projects_insert" ON "public"."projects" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "projects_select" ON "public"."projects" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "projects_update" ON "public"."projects" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."proposal_line_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "proposal_line_items_delete" ON "public"."proposal_line_items" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "proposal_line_items_insert" ON "public"."proposal_line_items" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "proposal_line_items_select" ON "public"."proposal_line_items" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "proposal_line_items_update" ON "public"."proposal_line_items" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."proposal_views" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "proposal_views_select" ON "public"."proposal_views" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."proposals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "proposals_delete" ON "public"."proposals" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "proposals_insert" ON "public"."proposals" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "proposals_select" ON "public"."proposals" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "proposals_update" ON "public"."proposals" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."rate_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."schema_migrations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service all" ON "public"."automation_email_log" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "services_delete" ON "public"."services" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "services_insert" ON "public"."services" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "services_select" ON "public"."services" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "services_update" ON "public"."services" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."skills" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "skills_delete" ON "public"."skills" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "skills_insert" ON "public"."skills" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "skills_select" ON "public"."skills" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "skills_update" ON "public"."skills" FOR UPDATE USING ("public"."is_tenant_admin"("tenant_id")) WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tasks_delete" ON "public"."tasks" FOR DELETE USING ((("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")) AND (("assignee_id" = "auth"."uid"()) OR ("assigned_by_id" = "auth"."uid"()) OR "public"."is_tenant_admin"("tenant_id"))));



CREATE POLICY "tasks_insert" ON "public"."tasks" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "tasks_select" ON "public"."tasks" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "tasks_update" ON "public"."tasks" FOR UPDATE USING ((("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")) AND (("assignee_id" = "auth"."uid"()) OR ("assigned_by_id" = "auth"."uid"()) OR "public"."is_tenant_admin"("tenant_id"))));



ALTER TABLE "public"."tenant_email_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tenant_entities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tenant_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tenants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."time_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "time_entries_delete" ON "public"."time_entries" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "time_entries_insert" ON "public"."time_entries" FOR INSERT WITH CHECK ((("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")) AND ("user_id" = "auth"."uid"())));



CREATE POLICY "time_entries_select" ON "public"."time_entries" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "time_entries_update" ON "public"."time_entries" FOR UPDATE USING (((("user_id" = "auth"."uid"()) AND ("approval_status" = 'pending'::"text")) OR "public"."is_tenant_admin"("tenant_id")));



ALTER TABLE "public"."utm_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "utm_links_delete" ON "public"."utm_links" FOR DELETE USING ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "utm_links_insert" ON "public"."utm_links" FOR INSERT WITH CHECK ("public"."is_tenant_admin"("tenant_id"));



CREATE POLICY "utm_links_select" ON "public"."utm_links" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."webhook_deliveries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."webhook_endpoints" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."messages";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."assign_education_display_ids"("p_tenant" "uuid", "p_prefix" "text", "p_lead_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."assign_education_display_ids"("p_tenant" "uuid", "p_prefix" "text", "p_lead_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_education_display_ids"("p_tenant" "uuid", "p_prefix" "text", "p_lead_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."create_notification"("p_tenant_id" "uuid", "p_user_id" "uuid", "p_type" "text", "p_title" "text", "p_message" "text", "p_link" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_notification"("p_tenant_id" "uuid", "p_user_id" "uuid", "p_type" "text", "p_title" "text", "p_message" "text", "p_link" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_notification"("p_tenant_id" "uuid", "p_user_id" "uuid", "p_type" "text", "p_title" "text", "p_message" "text", "p_link" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_single_default_deal_pipeline"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_single_default_deal_pipeline"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_single_default_deal_pipeline"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_single_default_pipeline"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_single_default_pipeline"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_single_default_pipeline"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_scoped_leads"("p_tenant_id" "uuid", "p_scope_mode" "text", "p_user_id" "uuid", "p_branch_id" "uuid", "p_branch_member_ids" "uuid"[], "p_pipeline_ids" "uuid"[], "p_list_id" "uuid", "p_exclude_list_ids" "uuid"[], "p_status" "text", "p_search" "text", "p_include_converted" boolean, "p_only_deleted" boolean, "p_require_stage" boolean, "p_order_by" "text", "p_assigned_to" "uuid", "p_page" integer, "p_page_size" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_scoped_leads"("p_tenant_id" "uuid", "p_scope_mode" "text", "p_user_id" "uuid", "p_branch_id" "uuid", "p_branch_member_ids" "uuid"[], "p_pipeline_ids" "uuid"[], "p_list_id" "uuid", "p_exclude_list_ids" "uuid"[], "p_status" "text", "p_search" "text", "p_include_converted" boolean, "p_only_deleted" boolean, "p_require_stage" boolean, "p_order_by" "text", "p_assigned_to" "uuid", "p_page" integer, "p_page_size" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_tenant_ids"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_tenant_ids"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_tenant_ids"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_tenant_role"("p_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_tenant_role"("p_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_tenant_role"("p_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_tenant_admin"("p_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_tenant_admin"("p_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_tenant_admin"("p_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."next_education_display_id"("p_tenant" "uuid", "p_prefix" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."next_education_display_id"("p_tenant" "uuid", "p_prefix" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."next_education_display_id"("p_tenant" "uuid", "p_prefix" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconcile_import_sources"("p_tenant" "uuid", "p_staging_list" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_import_sources"("p_tenant" "uuid", "p_staging_list" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_proposal_number"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_proposal_number"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_proposal_number"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "service_role";


















GRANT ALL ON TABLE "public"."accounts" TO "anon";
GRANT ALL ON TABLE "public"."accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."accounts" TO "service_role";



GRANT ALL ON TABLE "public"."affiliates" TO "anon";
GRANT ALL ON TABLE "public"."affiliates" TO "authenticated";
GRANT ALL ON TABLE "public"."affiliates" TO "service_role";



GRANT ALL ON TABLE "public"."agents" TO "anon";
GRANT ALL ON TABLE "public"."agents" TO "authenticated";
GRANT ALL ON TABLE "public"."agents" TO "service_role";



GRANT ALL ON TABLE "public"."application_stages" TO "anon";
GRANT ALL ON TABLE "public"."application_stages" TO "authenticated";
GRANT ALL ON TABLE "public"."application_stages" TO "service_role";



GRANT ALL ON TABLE "public"."applications" TO "anon";
GRANT ALL ON TABLE "public"."applications" TO "authenticated";
GRANT ALL ON TABLE "public"."applications" TO "service_role";



GRANT ALL ON TABLE "public"."applications_backup_appuploads" TO "anon";
GRANT ALL ON TABLE "public"."applications_backup_appuploads" TO "authenticated";
GRANT ALL ON TABLE "public"."applications_backup_appuploads" TO "service_role";



GRANT ALL ON TABLE "public"."attendance_records" TO "anon";
GRANT ALL ON TABLE "public"."attendance_records" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance_records" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."automation_email_log" TO "anon";
GRANT ALL ON TABLE "public"."automation_email_log" TO "authenticated";
GRANT ALL ON TABLE "public"."automation_email_log" TO "service_role";



GRANT ALL ON TABLE "public"."branches" TO "anon";
GRANT ALL ON TABLE "public"."branches" TO "authenticated";
GRANT ALL ON TABLE "public"."branches" TO "service_role";



GRANT ALL ON TABLE "public"."campaign_results" TO "anon";
GRANT ALL ON TABLE "public"."campaign_results" TO "authenticated";
GRANT ALL ON TABLE "public"."campaign_results" TO "service_role";



GRANT ALL ON TABLE "public"."campaigns" TO "anon";
GRANT ALL ON TABLE "public"."campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."class_enrollments" TO "anon";
GRANT ALL ON TABLE "public"."class_enrollments" TO "authenticated";
GRANT ALL ON TABLE "public"."class_enrollments" TO "service_role";



GRANT ALL ON TABLE "public"."classes" TO "anon";
GRANT ALL ON TABLE "public"."classes" TO "authenticated";
GRANT ALL ON TABLE "public"."classes" TO "service_role";



GRANT ALL ON TABLE "public"."connected_email_accounts" TO "anon";
GRANT ALL ON TABLE "public"."connected_email_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."connected_email_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."consent_templates" TO "anon";
GRANT ALL ON TABLE "public"."consent_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."consent_templates" TO "service_role";



GRANT ALL ON TABLE "public"."contacts" TO "anon";
GRANT ALL ON TABLE "public"."contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."contacts" TO "service_role";



GRANT ALL ON TABLE "public"."conversations" TO "anon";
GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";



GRANT ALL ON TABLE "public"."countries" TO "anon";
GRANT ALL ON TABLE "public"."countries" TO "authenticated";
GRANT ALL ON TABLE "public"."countries" TO "service_role";



GRANT ALL ON TABLE "public"."courses" TO "anon";
GRANT ALL ON TABLE "public"."courses" TO "authenticated";
GRANT ALL ON TABLE "public"."courses" TO "service_role";



GRANT ALL ON TABLE "public"."dashboards" TO "anon";
GRANT ALL ON TABLE "public"."dashboards" TO "authenticated";
GRANT ALL ON TABLE "public"."dashboards" TO "service_role";



GRANT ALL ON TABLE "public"."deal_contacts" TO "anon";
GRANT ALL ON TABLE "public"."deal_contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."deal_contacts" TO "service_role";



GRANT ALL ON TABLE "public"."deal_pipelines" TO "anon";
GRANT ALL ON TABLE "public"."deal_pipelines" TO "authenticated";
GRANT ALL ON TABLE "public"."deal_pipelines" TO "service_role";



GRANT ALL ON TABLE "public"."deal_stages" TO "anon";
GRANT ALL ON TABLE "public"."deal_stages" TO "authenticated";
GRANT ALL ON TABLE "public"."deal_stages" TO "service_role";



GRANT ALL ON TABLE "public"."deals" TO "anon";
GRANT ALL ON TABLE "public"."deals" TO "authenticated";
GRANT ALL ON TABLE "public"."deals" TO "service_role";



GRANT ALL ON TABLE "public"."departments" TO "anon";
GRANT ALL ON TABLE "public"."departments" TO "authenticated";
GRANT ALL ON TABLE "public"."departments" TO "service_role";



GRANT ALL ON TABLE "public"."email_forward_rules" TO "anon";
GRANT ALL ON TABLE "public"."email_forward_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."email_forward_rules" TO "service_role";



GRANT ALL ON TABLE "public"."email_sync_state" TO "anon";
GRANT ALL ON TABLE "public"."email_sync_state" TO "authenticated";
GRANT ALL ON TABLE "public"."email_sync_state" TO "service_role";



GRANT ALL ON TABLE "public"."email_threads" TO "anon";
GRANT ALL ON TABLE "public"."email_threads" TO "authenticated";
GRANT ALL ON TABLE "public"."email_threads" TO "service_role";



GRANT ALL ON TABLE "public"."emails" TO "anon";
GRANT ALL ON TABLE "public"."emails" TO "authenticated";
GRANT ALL ON TABLE "public"."emails" TO "service_role";



GRANT ALL ON TABLE "public"."employee_profiles" TO "anon";
GRANT ALL ON TABLE "public"."employee_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."employee_skills" TO "anon";
GRANT ALL ON TABLE "public"."employee_skills" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_skills" TO "service_role";



GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON TABLE "public"."form_configs" TO "anon";
GRANT ALL ON TABLE "public"."form_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."form_configs" TO "service_role";



GRANT ALL ON TABLE "public"."holidays" TO "anon";
GRANT ALL ON TABLE "public"."holidays" TO "authenticated";
GRANT ALL ON TABLE "public"."holidays" TO "service_role";



GRANT ALL ON TABLE "public"."inbox_channels" TO "anon";
GRANT ALL ON TABLE "public"."inbox_channels" TO "authenticated";
GRANT ALL ON TABLE "public"."inbox_channels" TO "service_role";



GRANT ALL ON TABLE "public"."industries" TO "anon";
GRANT ALL ON TABLE "public"."industries" TO "authenticated";
GRANT ALL ON TABLE "public"."industries" TO "service_role";



GRANT ALL ON TABLE "public"."integration_idempotency" TO "anon";
GRANT ALL ON TABLE "public"."integration_idempotency" TO "authenticated";
GRANT ALL ON TABLE "public"."integration_idempotency" TO "service_role";



GRANT ALL ON TABLE "public"."integration_keys" TO "anon";
GRANT ALL ON TABLE "public"."integration_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."integration_keys" TO "service_role";



GRANT ALL ON TABLE "public"."invite_tokens" TO "anon";
GRANT ALL ON TABLE "public"."invite_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."invite_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."knowledge_base_items" TO "anon";
GRANT ALL ON TABLE "public"."knowledge_base_items" TO "authenticated";
GRANT ALL ON TABLE "public"."knowledge_base_items" TO "service_role";



GRANT ALL ON TABLE "public"."knowledge_bases" TO "anon";
GRANT ALL ON TABLE "public"."knowledge_bases" TO "authenticated";
GRANT ALL ON TABLE "public"."knowledge_bases" TO "service_role";



GRANT ALL ON TABLE "public"."lead_activities" TO "anon";
GRANT ALL ON TABLE "public"."lead_activities" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_activities" TO "service_role";



GRANT ALL ON TABLE "public"."lead_assignment_history" TO "anon";
GRANT ALL ON TABLE "public"."lead_assignment_history" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_assignment_history" TO "service_role";



GRANT ALL ON TABLE "public"."lead_branches" TO "anon";
GRANT ALL ON TABLE "public"."lead_branches" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_branches" TO "service_role";



GRANT ALL ON TABLE "public"."lead_checklists" TO "anon";
GRANT ALL ON TABLE "public"."lead_checklists" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_checklists" TO "service_role";



GRANT ALL ON TABLE "public"."lead_collaborators" TO "anon";
GRANT ALL ON TABLE "public"."lead_collaborators" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_collaborators" TO "service_role";



GRANT ALL ON TABLE "public"."lead_consents" TO "anon";
GRANT ALL ON TABLE "public"."lead_consents" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_consents" TO "service_role";



GRANT ALL ON TABLE "public"."lead_duplicate_suggestions" TO "anon";
GRANT ALL ON TABLE "public"."lead_duplicate_suggestions" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_duplicate_suggestions" TO "service_role";



GRANT ALL ON TABLE "public"."lead_import_sources" TO "anon";
GRANT ALL ON TABLE "public"."lead_import_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_import_sources" TO "service_role";



GRANT ALL ON TABLE "public"."lead_insights" TO "anon";
GRANT ALL ON TABLE "public"."lead_insights" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_insights" TO "service_role";



GRANT ALL ON TABLE "public"."lead_lists" TO "anon";
GRANT ALL ON TABLE "public"."lead_lists" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_lists" TO "service_role";



GRANT ALL ON TABLE "public"."lead_merges" TO "anon";
GRANT ALL ON TABLE "public"."lead_merges" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_merges" TO "service_role";



GRANT ALL ON TABLE "public"."lead_move_log" TO "anon";
GRANT ALL ON TABLE "public"."lead_move_log" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_move_log" TO "service_role";



GRANT ALL ON TABLE "public"."lead_notes" TO "anon";
GRANT ALL ON TABLE "public"."lead_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_notes" TO "service_role";



GRANT ALL ON TABLE "public"."lead_submissions" TO "anon";
GRANT ALL ON TABLE "public"."lead_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_submissions" TO "service_role";



GRANT ALL ON TABLE "public"."lead_types" TO "anon";
GRANT ALL ON TABLE "public"."lead_types" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_types" TO "service_role";



GRANT ALL ON TABLE "public"."leads" TO "anon";
GRANT ALL ON TABLE "public"."leads" TO "authenticated";
GRANT ALL ON TABLE "public"."leads" TO "service_role";



GRANT ALL ON TABLE "public"."leads_listsnapshot_appuploads" TO "anon";
GRANT ALL ON TABLE "public"."leads_listsnapshot_appuploads" TO "authenticated";
GRANT ALL ON TABLE "public"."leads_listsnapshot_appuploads" TO "service_role";



GRANT ALL ON TABLE "public"."leave_adjustments" TO "anon";
GRANT ALL ON TABLE "public"."leave_adjustments" TO "authenticated";
GRANT ALL ON TABLE "public"."leave_adjustments" TO "service_role";



GRANT ALL ON TABLE "public"."leave_requests" TO "anon";
GRANT ALL ON TABLE "public"."leave_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."leave_requests" TO "service_role";



GRANT ALL ON TABLE "public"."leave_types" TO "anon";
GRANT ALL ON TABLE "public"."leave_types" TO "authenticated";
GRANT ALL ON TABLE "public"."leave_types" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."org_layers" TO "anon";
GRANT ALL ON TABLE "public"."org_layers" TO "authenticated";
GRANT ALL ON TABLE "public"."org_layers" TO "service_role";



GRANT ALL ON TABLE "public"."partner_colleges" TO "anon";
GRANT ALL ON TABLE "public"."partner_colleges" TO "authenticated";
GRANT ALL ON TABLE "public"."partner_colleges" TO "service_role";



GRANT ALL ON TABLE "public"."pipeline_stages" TO "anon";
GRANT ALL ON TABLE "public"."pipeline_stages" TO "authenticated";
GRANT ALL ON TABLE "public"."pipeline_stages" TO "service_role";



GRANT ALL ON TABLE "public"."pipelines" TO "anon";
GRANT ALL ON TABLE "public"."pipelines" TO "authenticated";
GRANT ALL ON TABLE "public"."pipelines" TO "service_role";



GRANT ALL ON TABLE "public"."positions" TO "anon";
GRANT ALL ON TABLE "public"."positions" TO "authenticated";
GRANT ALL ON TABLE "public"."positions" TO "service_role";



GRANT ALL ON TABLE "public"."project_allocations" TO "anon";
GRANT ALL ON TABLE "public"."project_allocations" TO "authenticated";
GRANT ALL ON TABLE "public"."project_allocations" TO "service_role";



GRANT ALL ON TABLE "public"."project_contacts" TO "anon";
GRANT ALL ON TABLE "public"."project_contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."project_contacts" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON TABLE "public"."proposal_line_items" TO "anon";
GRANT ALL ON TABLE "public"."proposal_line_items" TO "authenticated";
GRANT ALL ON TABLE "public"."proposal_line_items" TO "service_role";



GRANT ALL ON TABLE "public"."proposal_views" TO "anon";
GRANT ALL ON TABLE "public"."proposal_views" TO "authenticated";
GRANT ALL ON TABLE "public"."proposal_views" TO "service_role";



GRANT ALL ON TABLE "public"."proposals" TO "anon";
GRANT ALL ON TABLE "public"."proposals" TO "authenticated";
GRANT ALL ON TABLE "public"."proposals" TO "service_role";



GRANT ALL ON TABLE "public"."rate_limits" TO "anon";
GRANT ALL ON TABLE "public"."rate_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."rate_limits" TO "service_role";



GRANT ALL ON TABLE "public"."schema_migrations" TO "service_role";



GRANT ALL ON TABLE "public"."services" TO "anon";
GRANT ALL ON TABLE "public"."services" TO "authenticated";
GRANT ALL ON TABLE "public"."services" TO "service_role";



GRANT ALL ON TABLE "public"."skills" TO "anon";
GRANT ALL ON TABLE "public"."skills" TO "authenticated";
GRANT ALL ON TABLE "public"."skills" TO "service_role";



GRANT ALL ON TABLE "public"."tasks" TO "anon";
GRANT ALL ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";



GRANT ALL ON TABLE "public"."tenant_email_settings" TO "anon";
GRANT ALL ON TABLE "public"."tenant_email_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_email_settings" TO "service_role";



GRANT ALL ON TABLE "public"."tenant_entities" TO "anon";
GRANT ALL ON TABLE "public"."tenant_entities" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_entities" TO "service_role";



GRANT ALL ON TABLE "public"."tenant_users" TO "anon";
GRANT ALL ON TABLE "public"."tenant_users" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_users" TO "service_role";



GRANT ALL ON TABLE "public"."tenants" TO "anon";
GRANT ALL ON TABLE "public"."tenants" TO "authenticated";
GRANT ALL ON TABLE "public"."tenants" TO "service_role";



GRANT ALL ON TABLE "public"."time_entries" TO "anon";
GRANT ALL ON TABLE "public"."time_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."time_entries" TO "service_role";



GRANT ALL ON TABLE "public"."utm_links" TO "anon";
GRANT ALL ON TABLE "public"."utm_links" TO "authenticated";
GRANT ALL ON TABLE "public"."utm_links" TO "service_role";



GRANT ALL ON TABLE "public"."webhook_deliveries" TO "anon";
GRANT ALL ON TABLE "public"."webhook_deliveries" TO "authenticated";
GRANT ALL ON TABLE "public"."webhook_deliveries" TO "service_role";



GRANT ALL ON TABLE "public"."webhook_endpoints" TO "anon";
GRANT ALL ON TABLE "public"."webhook_endpoints" TO "authenticated";
GRANT ALL ON TABLE "public"."webhook_endpoints" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































