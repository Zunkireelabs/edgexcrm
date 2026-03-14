-- Migration: 005_integration_keys
-- Purpose: Integration key infrastructure for external API authentication (Orca)
-- Date: 2026-02-22

-- Integration keys table
create table if not exists integration_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name varchar(255) not null,
  hashed_key text not null,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  revoked_at timestamptz null
);

-- Indexes
create index if not exists idx_integration_keys_tenant_id
on integration_keys(tenant_id);

create index if not exists idx_integration_keys_revoked
on integration_keys(revoked_at);

create index if not exists idx_integration_keys_hashed_key
on integration_keys(hashed_key);

-- RLS: block all direct access, only service role can manage
alter table integration_keys enable row level security;

create policy "No direct access"
on integration_keys
for all
using (false);
