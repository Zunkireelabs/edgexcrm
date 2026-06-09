create table if not exists automation_email_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  form_config_id uuid references form_configs(id) on delete set null,
  source text not null check (source in ('form_autoresponder','stage_rule')),
  to_email text not null,
  subject text,
  status text not null check (status in ('sent','failed')),
  error text,
  provider_message_id text,
  created_at timestamptz not null default now()
);
create index idx_automation_email_log_tenant on automation_email_log(tenant_id);
create index idx_automation_email_log_lead on automation_email_log(lead_id);

alter table automation_email_log enable row level security;
create policy "members read" on automation_email_log for select
  using (tenant_id in (select get_user_tenant_ids()));
create policy "service all" on automation_email_log for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
