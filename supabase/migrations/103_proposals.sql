-- 103_proposals.sql — it_agency Proposals (Phase 1: line-item quote)
BEGIN;

-- ---- proposals ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS proposals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deal_id         UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  proposal_number TEXT NOT NULL,                 -- e.g. PROP-0001 (trigger-assigned)
  title           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','sent','accepted','rejected','expired')),
  currency        TEXT NOT NULL DEFAULT 'NPR',   -- snapshot from deal.currency at create
  subtotal        NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_type   TEXT CHECK (discount_type IN ('percent','amount')),
  discount_value  NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_percent     NUMERIC(6,3)  NOT NULL DEFAULT 0,
  total           NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes           TEXT,                          -- freeform scope/terms (SOW narrative seed)
  valid_until     DATE,
  sent_at         TIMESTAMPTZ,
  accepted_at     TIMESTAMPTZ,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_proposals_tenant_deal ON proposals(tenant_id, deal_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_proposals_tenant_live ON proposals(tenant_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_proposals_tenant_number ON proposals(tenant_id, proposal_number);

ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proposals_select" ON proposals FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "proposals_insert" ON proposals FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "proposals_update" ON proposals FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "proposals_delete" ON proposals FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE TRIGGER trigger_proposals_updated_at BEFORE UPDATE ON proposals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- auto-assign PROP-#### per tenant (advisory-lock serialized; pattern from mig 084)
CREATE OR REPLACE FUNCTION set_proposal_number() RETURNS trigger LANGUAGE plpgsql AS $$
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
END;$$;

CREATE TRIGGER trigger_proposals_set_number BEFORE INSERT ON proposals
  FOR EACH ROW EXECUTE FUNCTION set_proposal_number();

-- ---- proposal_line_items ------------------------------------------------
CREATE TABLE IF NOT EXISTS proposal_line_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proposal_id   UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  service_id    UUID REFERENCES services(id) ON DELETE SET NULL,  -- provenance only, nullable (ad-hoc)
  name          TEXT NOT NULL,          -- snapshot
  description   TEXT,                   -- snapshot
  billing_type  TEXT,                   -- snapshot (display label)
  quantity      NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price    NUMERIC(14,2) NOT NULL DEFAULT 0,  -- snapshot, editable
  hours         NUMERIC(10,2),          -- snapshot
  line_total    NUMERIC(14,2) NOT NULL DEFAULT 0,  -- quantity * unit_price
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proposal_line_items_proposal ON proposal_line_items(tenant_id, proposal_id);

ALTER TABLE proposal_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proposal_line_items_select" ON proposal_line_items FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "proposal_line_items_insert" ON proposal_line_items FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "proposal_line_items_update" ON proposal_line_items FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "proposal_line_items_delete" ON proposal_line_items FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE TRIGGER trigger_proposal_line_items_updated_at BEFORE UPDATE ON proposal_line_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;
