-- Lazy display_id assignment when leads leave staging.
-- Additive: new function only.
-- Rollback: DROP FUNCTION assign_education_display_ids(uuid,text,uuid[]);
BEGIN;

CREATE OR REPLACE FUNCTION public.assign_education_display_ids(
  p_tenant   uuid,
  p_prefix   text,
  p_lead_ids uuid[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
$$;

COMMIT;
