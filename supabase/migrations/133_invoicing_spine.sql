-- Migration 133: it_agency Delivery — milestone-triggered invoicing spine
--
-- Adds `invoices` + `invoice_line_items` (generated from accepted milestones)
-- plus a double-billing guard column on `project_milestones`. Spine only:
-- no tax entry, no PDF/export, no client share links, no free-text lines,
-- no payments in v1 (see Tier 2b brief §8 for deferred scope).
--
-- Expected before/after row counts: invoices 0 -> 0, invoice_line_items 0 -> 0
-- (new tables, no seed); project_milestones 0 rows touched (+1 nullable column).
--
-- Rollback:
--   DROP TABLE IF EXISTS invoice_line_items;
--   DROP TABLE IF EXISTS invoices;
--   DROP FUNCTION IF EXISTS set_invoice_number();
--   ALTER TABLE project_milestones DROP COLUMN IF EXISTS invoiced_at;
--
-- Applied: local 2026-07-09 / stage HELD / prod HELD.

BEGIN;

-- ============================================================
-- 2a. invoices
-- ============================================================
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,   -- denormalized from project.account_id (projects.account_id is NOT NULL) so the account Billing tab can list without a join through projects
  invoice_number TEXT NOT NULL,                                          -- INV-#### trigger-assigned per tenant
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','paid','void')),
  currency TEXT NOT NULL DEFAULT 'NPR',
  subtotal   NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,                           -- always 0 in v1; column present so tax slots in later with no rename
  total      NUMERIC(14,2) NOT NULL DEFAULT 0,                           -- = subtotal + tax_amount
  issue_date DATE,                                                       -- set when marked sent (defaults to today)
  due_date   DATE,
  notes TEXT,
  sent_at   TIMESTAMPTZ,
  paid_at   TIMESTAMPTZ,
  voided_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_project_id ON invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_invoices_account_id ON invoices(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_tenant_number ON invoices(tenant_id, invoice_number);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoices_select" ON invoices;
CREATE POLICY "invoices_select" ON invoices
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "invoices_insert" ON invoices;
CREATE POLICY "invoices_insert" ON invoices
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "invoices_update" ON invoices;
CREATE POLICY "invoices_update" ON invoices
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "invoices_delete" ON invoices;
CREATE POLICY "invoices_delete" ON invoices
  FOR DELETE USING (is_tenant_admin(tenant_id));

DROP TRIGGER IF EXISTS trigger_invoices_updated_at ON invoices;
CREATE TRIGGER trigger_invoices_updated_at BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- auto-assign INV-#### per tenant (mirrors set_proposal_number(), mig 103)
CREATE OR REPLACE FUNCTION set_invoice_number() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_base bigint;
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id::text || ':INV'));
    SELECT coalesce(max((regexp_replace(invoice_number,'[^0-9]','','g'))::bigint),0)
      INTO v_base FROM invoices
      WHERE tenant_id = NEW.tenant_id AND invoice_number ~ '^INV-[0-9]+$';
    NEW.invoice_number := 'INV-' || lpad((v_base+1)::text, greatest(4, length((v_base+1)::text)), '0');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trigger_invoices_set_number ON invoices;
CREATE TRIGGER trigger_invoices_set_number BEFORE INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_invoice_number();

-- ============================================================
-- 2b. invoice_line_items
-- ============================================================
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  milestone_id UUID REFERENCES project_milestones(id) ON DELETE SET NULL,  -- provenance; nullable so a released/deleted milestone doesn't orphan the line
  description TEXT NOT NULL,
  quantity   NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL DEFAULT 0,   -- = quantity * unit_price (computed in app, mirrors proposal_line_items)
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice_id ON invoice_line_items(invoice_id);

ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice_line_items_select" ON invoice_line_items;
CREATE POLICY "invoice_line_items_select" ON invoice_line_items
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "invoice_line_items_insert" ON invoice_line_items;
CREATE POLICY "invoice_line_items_insert" ON invoice_line_items
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "invoice_line_items_update" ON invoice_line_items;
CREATE POLICY "invoice_line_items_update" ON invoice_line_items
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "invoice_line_items_delete" ON invoice_line_items;
CREATE POLICY "invoice_line_items_delete" ON invoice_line_items
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- ============================================================
-- 2c. double-billing guard on milestones
-- ============================================================
ALTER TABLE project_milestones ADD COLUMN IF NOT EXISTS invoiced_at TIMESTAMPTZ;
-- "Available to bill" = status = 'accepted' AND invoiced_at IS NULL AND amount IS NOT NULL.

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('133_invoicing_spine.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
