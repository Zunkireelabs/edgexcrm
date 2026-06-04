-- Migration 025: Email send foundation
-- Adds user_id + display_name to connected_email_accounts, shifts RLS to user-scoped,
-- creates email_threads, emails, email_sync_state tables.

-- ── Alter connected_email_accounts ──────────────────────────────────────────

ALTER TABLE connected_email_accounts
  ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN display_name TEXT;

-- Backfill: assign existing rows to each tenant's owner.
-- (Existing rows were created by the email-forward feature, where the
-- tenant admin connected the company-wide account. Owner is the right default.)
UPDATE connected_email_accounts cea
SET user_id = (
  SELECT tu.user_id
  FROM tenant_users tu
  WHERE tu.tenant_id = cea.tenant_id
    AND tu.role = 'owner'
  ORDER BY tu.created_at ASC
  LIMIT 1
)
WHERE cea.user_id IS NULL;

-- Any rows still NULL (no owner exists — should not happen, but defensive):
DELETE FROM connected_email_accounts WHERE user_id IS NULL;

ALTER TABLE connected_email_accounts
  ALTER COLUMN user_id SET NOT NULL;

-- Uniqueness: one (user, email) per user. Drop any preexisting unique on
-- (tenant_id, email) if present. (Mig 018 didn't create one, but check.)
CREATE UNIQUE INDEX idx_connected_email_accounts_user_email
  ON connected_email_accounts (user_id, email);

CREATE INDEX idx_connected_email_accounts_user
  ON connected_email_accounts (user_id);

-- ── Update RLS policies on connected_email_accounts ─────────────────────────

-- Drop the tenant-admin policies (they assume tenant-shared accounts).
DROP POLICY IF EXISTS "Tenant members can view connected accounts" ON connected_email_accounts;
DROP POLICY IF EXISTS "Tenant admins can insert connected accounts" ON connected_email_accounts;
DROP POLICY IF EXISTS "Tenant admins can update connected accounts" ON connected_email_accounts;
DROP POLICY IF EXISTS "Tenant admins can delete connected accounts" ON connected_email_accounts;

-- New user-scoped policies: each user manages own inboxes.
CREATE POLICY "Users can view own connected accounts"
  ON connected_email_accounts FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own connected accounts"
  ON connected_email_accounts FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own connected accounts"
  ON connected_email_accounts FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own connected accounts"
  ON connected_email_accounts FOR DELETE
  USING (user_id = auth.uid());

-- Tenant admins can view all inboxes in their tenant (read-only oversight).
CREATE POLICY "Tenant admins can view all tenant connected accounts"
  ON connected_email_accounts FOR SELECT
  USING (is_tenant_admin(tenant_id));

-- Service role policy is preserved from mig 018; do not re-create.

-- ── New email_threads table ──────────────────────────────────────────────────

CREATE TABLE email_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connected_email_account_id UUID NOT NULL REFERENCES connected_email_accounts(id) ON DELETE CASCADE,
  gmail_thread_id TEXT NOT NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  subject TEXT,
  last_message_at TIMESTAMPTZ,
  message_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_email_threads_account_gmail_thread
  ON email_threads (connected_email_account_id, gmail_thread_id);
CREATE INDEX idx_email_threads_tenant ON email_threads (tenant_id);
CREATE INDEX idx_email_threads_lead ON email_threads (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX idx_email_threads_contact ON email_threads (contact_id) WHERE contact_id IS NOT NULL;

CREATE TRIGGER set_email_threads_updated_at
  BEFORE UPDATE ON email_threads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE email_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view email threads"
  ON email_threads FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Tenant admins can mutate email threads"
  ON email_threads FOR ALL
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "Service role full access to email threads"
  ON email_threads FOR ALL
  USING (auth.role() = 'service_role');

-- ── New emails table ─────────────────────────────────────────────────────────

CREATE TABLE emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  connected_email_account_id UUID NOT NULL REFERENCES connected_email_accounts(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  from_email TEXT NOT NULL,
  from_name TEXT,
  to_emails TEXT[] NOT NULL DEFAULT '{}',
  cc_emails TEXT[] NOT NULL DEFAULT '{}',
  bcc_emails TEXT[] NOT NULL DEFAULT '{}',
  subject TEXT,
  body_html TEXT,
  body_text TEXT,
  gmail_message_id TEXT NOT NULL,
  rfc_message_id TEXT NOT NULL,
  in_reply_to TEXT,
  rfc_references TEXT[] NOT NULL DEFAULT '{}',
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  sender_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_emails_thread ON emails (thread_id, COALESCE(sent_at, received_at));
CREATE UNIQUE INDEX idx_emails_gmail_message ON emails (connected_email_account_id, gmail_message_id);
CREATE INDEX idx_emails_rfc_message_id ON emails (rfc_message_id);
CREATE INDEX idx_emails_tenant ON emails (tenant_id);

ALTER TABLE emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view emails"
  ON emails FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Tenant admins can mutate emails"
  ON emails FOR ALL
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "Service role full access to emails"
  ON emails FOR ALL
  USING (auth.role() = 'service_role');

-- ── New email_sync_state table ───────────────────────────────────────────────

CREATE TABLE email_sync_state (
  connected_email_account_id UUID PRIMARY KEY REFERENCES connected_email_accounts(id) ON DELETE CASCADE,
  last_history_id TEXT,
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  consecutive_error_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_email_sync_state_updated_at
  BEFORE UPDATE ON email_sync_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE email_sync_state ENABLE ROW LEVEL SECURITY;

-- Owner can read own sync state (debug surface); only service role mutates.
CREATE POLICY "Users can view own sync state"
  ON email_sync_state FOR SELECT
  USING (connected_email_account_id IN (
    SELECT id FROM connected_email_accounts WHERE user_id = auth.uid()
  ));

CREATE POLICY "Service role full access to sync state"
  ON email_sync_state FOR ALL
  USING (auth.role() = 'service_role');
