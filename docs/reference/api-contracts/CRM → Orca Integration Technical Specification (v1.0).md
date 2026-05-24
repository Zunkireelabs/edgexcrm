# CRM → Orca Integration Technical Specification (v1.0)

## 1. Objective

Prepare the CRM as an externally integratable, event-driven, AI-safe system so that:
- Orca can connect via API key
- Orca can subscribe to CRM events
- Orca agents can safely read/write CRM data
- No AI logic is embedded inside CRM
- Multi-tenant isolation remains intact

CRM remains a deterministic system of record.

---

## 2. Integration Principles

1. CRM must expose versioned integration APIs
2. CRM must authenticate integrations via API keys (not user sessions)
3. CRM must emit standardized signed webhooks
4. CRM must define tool schemas for LLM compatibility
5. CRM must remain AI-agnostic
6. All integration activity must be auditable
7. RLS must never be bypassed

---

## 3. Architecture Overview

```text
Website
   ↓
CRM Core API
   ↓
Event Dispatcher
   ↓ (Webhook)
Orca Event Receiver
   ↓
Agent Runtime
   ↓ (Tool Call)
CRM Integration API
   ↓
CRM DB
```

## 4. Integration API Layer

Create dedicated namespace:
`/api/v1/integrations/crm/*`

This API layer:
- Uses API key authentication
- Returns structured JSON only
- Never uses cookie sessions
- Is stable and versioned

### Required Read Endpoints
- `GET /api/v1/integrations/crm/leads`
- `GET /api/v1/integrations/crm/leads/:id`
- `GET /api/v1/integrations/crm/stages`
- `GET /api/v1/integrations/crm/pipeline`
- `GET /api/v1/integrations/crm/leads/:id/checklists`

---

### Required Write Endpoints
- `PATCH /api/v1/integrations/crm/leads/:id`
- `POST /api/v1/integrations/crm/leads/:id/assign`
- `POST /api/v1/integrations/crm/leads/:id/move-stage`

These must:
- Validate stage transitions
- Validate assignment scope
- Enforce rate limits
- Be idempotent where applicable

---

## 5. Integration Key Model

Create table:
```sql
CREATE TABLE integration_keys (
  id uuid primary key,
  tenant_id uuid not null,
  name varchar not null,
  hashed_key text not null,
  permissions jsonb not null,
  created_at timestamptz default now(),
  revoked_at timestamptz null
);
```

Rules:
- Keys are tenant-scoped
- Keys never expose raw value (store hashed)
- Keys can be revoked
- Permissions define allowed operations

Authentication Flow:
1. `Authorization: Bearer <key>`
2. Lookup hashed_key
3. Extract tenant_id
4. Inject tenant_id into request context
5. Apply RLS

---

## 6. Webhook System

Create table:
```sql
CREATE TABLE webhook_endpoints (
  id uuid primary key,
  tenant_id uuid not null,
  url text not null,
  secret text not null,
  event_types text[],
  is_active boolean default true,
  created_at timestamptz default now()
);
```

Supported events:
- `lead.created`
- `lead.updated`
- `lead.assigned`
- `stage.changed`
- `checklist.completed`

Payload format:
```json
{
  "event": "lead.created",
  "tenant_id": "...",
  "timestamp": "...",
  "data": {
    "lead_id": "...",
    "stage_id": "...",
    "assigned_to": "...",
    "summary": {}
  }
}
```

Webhook must be signed using HMAC-SHA256 with secret.

Header:
`X-Signature: sha256=<hash>`

---

## 7. Tool Manifest Endpoint

Create:
`GET /api/v1/integrations/crm/tools`

Returns JSON array:
```json
[
  {
    "name": "get_leads",
    "description": "Fetch leads for tenant",
    "parameters": { "...JSON schema..." }
  }
]
```

This enables tool-calling models in Orca.

---

## 8. Safety Constraints

- No hard delete via integration
- No bulk destructive actions
- Stage transitions validated
- Assignment validated
- Strict input validation
- Rate limits applied
- All integration actions logged in `audit_logs`

---

## 9. Observability

All integration requests must log:
- `request_id`
- `integration_key_id`
- `tenant_id`
- `tool_name`
- `latency`
- `status_code`

---

## 10. Out of Scope

- No embeddings
- No vector DB
- No RAG
- No LLM SDK in CRM
- No AI inference inside CRM

CRM remains deterministic.
