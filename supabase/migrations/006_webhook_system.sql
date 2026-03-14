-- Migration: 006_webhook_system
-- Purpose: Webhook infrastructure for pushing CRM events to external systems (Orca)
-- Date: 2026-02-22

-- Webhook endpoints (tenant-scoped)
create table if not exists webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  url text not null,
  secret text not null,
  event_types text[] not null,
  is_active boolean default true,
  created_at timestamptz default now()
);

create index if not exists idx_webhook_endpoints_tenant_id
on webhook_endpoints(tenant_id);

-- Webhook delivery log (tracks every attempt)
create table if not exists webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references webhook_endpoints(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  attempt integer not null,
  status_code integer,
  response_body text,
  success boolean default false,
  created_at timestamptz default now()
);

create index if not exists idx_webhook_deliveries_webhook_id
on webhook_deliveries(webhook_id);

-- RLS: block all direct access, only service role can manage
alter table webhook_endpoints enable row level security;
alter table webhook_deliveries enable row level security;

create policy "No direct access"
on webhook_endpoints for all using (false);

create policy "No direct access"
on webhook_deliveries for all using (false);
