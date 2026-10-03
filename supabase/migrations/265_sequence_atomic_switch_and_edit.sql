-- Migration 265: two race-free operations for Outreach sequences (review findings on PR #604).
--
-- 1) switch_lead_enrollment(...) — "Switch" in a bulk enroll used to END the lead's current enrollment and THEN start
--    the new one as two separate calls. If the second failed (another process enrolled the lead in between), the lead
--    was left in NEITHER sequence. Now both happen in one transaction: either the old one ends and the new one starts,
--    or nothing changes. The partial unique index uq_enrollment_active_lead (mig 176) still decides conflicts.
--
-- 2) apply_sequence_steps(...) — editing a running sequence read "how far have leads got" and then wrote the new steps
--    as separate calls. A lead advancing in between could get its next email built from a step that was about to
--    change. Now the lock check and the edit happen in one transaction that holds a lock on the sequence, and a
--    version stamp makes a half-built draft detectable:
--      email_sequences.steps_version        bumped by every step edit
--      sequence_step_drafts.steps_version   the version the draft was built from (NULL = old callers, not checked)
--      BEFORE INSERT trigger                waits for a running edit (FOR SHARE), then refuses a draft built from an
--                                           older version (error message STEPS_CHANGED) — the engine re-reads the step and retries.
--                                           (Not SQLSTATE 40001: the REST layer treats serialization failures specially and the
--                                           request hung; a plain P0001 with a fixed message behaves.)
--
-- Additive only: two nullable/defaulted columns, two functions, one trigger. Existing rows and callers are unchanged.
--   Expected before/after row counts: 0 rows touched (ADD COLUMN with a constant default is metadata-only).
--   Rollback: DROP TRIGGER IF EXISTS trg_sequence_step_drafts_version ON public.sequence_step_drafts;
--             DROP FUNCTION IF EXISTS public.sequence_step_drafts_check_version();
--             DROP FUNCTION IF EXISTS public.apply_sequence_steps(uuid, uuid, jsonb);
--             DROP FUNCTION IF EXISTS public.switch_lead_enrollment(uuid, uuid, uuid, uuid, uuid, uuid);
--             ALTER TABLE public.sequence_step_drafts DROP COLUMN IF EXISTS steps_version;
--             ALTER TABLE public.email_sequences DROP COLUMN IF EXISTS steps_version;
--   Applied: stage <PENDING> / prod HELD.

BEGIN;

ALTER TABLE public.email_sequences ADD COLUMN IF NOT EXISTS steps_version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.sequence_step_drafts ADD COLUMN IF NOT EXISTS steps_version BIGINT;

-- ── 1) atomic switch ───────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.switch_lead_enrollment(
  p_tenant_id UUID,
  p_lead_id UUID,
  p_old_enrollment_id UUID,
  p_sequence_id UUID,
  p_assigned_to UUID,
  p_enrolled_by UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_old UUID;
  v_new UUID;
BEGIN
  -- the target sequence must belong to the tenant (the caller is the service role, so nothing else checks this)
  PERFORM 1 FROM public.email_sequences WHERE id = p_sequence_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sequence not found' USING ERRCODE = 'P0002';
  END IF;

  -- end the lead's current enrollment (if it is still running) and skip its pending drafts
  SELECT id INTO v_old FROM public.sequence_enrollments
   WHERE id = p_old_enrollment_id AND tenant_id = p_tenant_id AND lead_id = p_lead_id AND status IN ('active', 'paused')
   FOR UPDATE;
  IF FOUND THEN
    UPDATE public.sequence_enrollments SET status = 'unenrolled' WHERE id = v_old;
    UPDATE public.sequence_step_drafts SET status = 'skipped' WHERE enrollment_id = v_old AND status = 'pending';
  END IF;

  -- start the new one. A unique violation (someone else enrolled the lead meanwhile) aborts the WHOLE transaction,
  -- so the old enrollment above is NOT ended.
  INSERT INTO public.sequence_enrollments (tenant_id, sequence_id, lead_id, assigned_to, status, current_step_order, enrolled_by)
  VALUES (p_tenant_id, p_sequence_id, p_lead_id, p_assigned_to, 'active', 0, p_enrolled_by)
  RETURNING id INTO v_new;

  RETURN v_new;
END;
$$;

-- ── 2) atomic step edit ────────────────────────────────────────────────────────────────────────────────────────
-- p_steps: [{ step_order, delay_days, send_time, subject_template, body_template, draft_source, ai_instructions }, ...]
-- Raises SQLSTATE 'P0001' with message 'STEPS_LOCKED' and HINT = the number of locked steps when the edit changes the
-- order / wait / send time / drafting of a step leads have already reached.
CREATE OR REPLACE FUNCTION public.apply_sequence_steps(
  p_tenant_id UUID,
  p_sequence_id UUID,
  p_steps JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_count INT;
  v_max_current INT;
  v_locked INT := 0;
  v_conflict INT;
  v_version BIGINT;
BEGIN
  -- the lock that serialises this edit with new drafts (see the trigger below)
  PERFORM 1 FROM public.email_sequences WHERE id = p_sequence_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sequence not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*) INTO v_existing_count FROM public.email_sequence_steps WHERE sequence_id = p_sequence_id;
  SELECT max(current_step_order) INTO v_max_current FROM public.sequence_enrollments
   WHERE sequence_id = p_sequence_id AND status IN ('active', 'paused');
  IF v_max_current IS NOT NULL THEN
    v_locked := LEAST(v_max_current + 1, v_existing_count);
  END IF;

  -- every step leads have reached must come back with the same order, wait, send time and drafting
  IF v_locked > 0 THEN
    SELECT st.step_order INTO v_conflict
      FROM public.email_sequence_steps st
      LEFT JOIN jsonb_to_recordset(p_steps) AS n(step_order INT, delay_days INT, send_time TEXT, draft_source TEXT)
        ON n.step_order = st.step_order
     WHERE st.sequence_id = p_sequence_id
       AND st.step_order <= v_locked
       AND (n.step_order IS NULL
            OR COALESCE(n.delay_days, 0) <> st.delay_days
            OR COALESCE(n.draft_source, 'template') <> st.draft_source
            OR COALESCE(NULLIF(n.send_time, ''), '') <> COALESCE(st.send_time, ''))
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'STEPS_LOCKED' USING ERRCODE = 'P0001', HINT = v_locked::TEXT;
    END IF;
  END IF;

  -- add the new steps, update the ones that stay, remove the ones that went (never an empty table in between)
  INSERT INTO public.email_sequence_steps
    (tenant_id, sequence_id, step_order, delay_days, send_time, subject_template, body_template, draft_source, ai_instructions)
  SELECT p_tenant_id, p_sequence_id, n.step_order, COALESCE(n.delay_days, 0), NULLIF(n.send_time, ''),
         COALESCE(n.subject_template, ''), COALESCE(n.body_template, ''), COALESCE(n.draft_source, 'template'), n.ai_instructions
    FROM jsonb_to_recordset(p_steps) AS n(step_order INT, delay_days INT, send_time TEXT, subject_template TEXT,
                                           body_template TEXT, draft_source TEXT, ai_instructions TEXT)
   WHERE NOT EXISTS (SELECT 1 FROM public.email_sequence_steps s WHERE s.sequence_id = p_sequence_id AND s.step_order = n.step_order);

  UPDATE public.email_sequence_steps s
     SET delay_days = COALESCE(n.delay_days, 0),
         send_time = NULLIF(n.send_time, ''),
         subject_template = COALESCE(n.subject_template, ''),
         body_template = COALESCE(n.body_template, ''),
         draft_source = COALESCE(n.draft_source, 'template'),
         ai_instructions = n.ai_instructions
    FROM jsonb_to_recordset(p_steps) AS n(step_order INT, delay_days INT, send_time TEXT, subject_template TEXT,
                                           body_template TEXT, draft_source TEXT, ai_instructions TEXT)
   WHERE s.sequence_id = p_sequence_id AND s.step_order = n.step_order;

  DELETE FROM public.email_sequence_steps s
   WHERE s.sequence_id = p_sequence_id
     AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(p_steps) AS n(step_order INT) WHERE n.step_order = s.step_order);

  UPDATE public.email_sequences SET steps_version = steps_version + 1 WHERE id = p_sequence_id
  RETURNING steps_version INTO v_version;

  RETURN jsonb_build_object('locked_up_to', v_locked, 'steps_version', v_version);
END;
$$;

-- ── draft version check ────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sequence_step_drafts_check_version() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_seq UUID;
  v_version BIGINT;
BEGIN
  IF NEW.steps_version IS NULL THEN
    RETURN NEW; -- a caller that does not stamp its drafts is not checked
  END IF;

  SELECT sequence_id INTO v_seq FROM public.email_sequence_steps WHERE id = NEW.step_id;
  IF v_seq IS NULL THEN
    RETURN NEW; -- the step is gone: the foreign key reports it
  END IF;

  -- waits here while apply_sequence_steps holds the sequence row, then reads the committed version
  SELECT steps_version INTO v_version FROM public.email_sequences WHERE id = v_seq FOR SHARE;
  IF v_version IS DISTINCT FROM NEW.steps_version THEN
    RAISE EXCEPTION 'STEPS_CHANGED' USING ERRCODE = 'P0001', HINT = 'sequence steps changed while the draft was being built';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sequence_step_drafts_version ON public.sequence_step_drafts;
CREATE TRIGGER trg_sequence_step_drafts_version
  BEFORE INSERT ON public.sequence_step_drafts
  FOR EACH ROW EXECUTE FUNCTION public.sequence_step_drafts_check_version();

-- the two RPCs are for the service role only (they take the tenant as an argument)
REVOKE ALL ON FUNCTION public.switch_lead_enrollment(UUID, UUID, UUID, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_sequence_steps(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.switch_lead_enrollment(UUID, UUID, UUID, UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_sequence_steps(UUID, UUID, JSONB) TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('265_sequence_atomic_switch_and_edit.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
