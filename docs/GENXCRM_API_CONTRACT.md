# GenX CRM — Integration API Contract

> **Version**: 1.0
> **Base URL**: `https://lead-crm.zunkireelabs.com`
> **API Prefix**: `/api/v1/integrations/crm`
> **Generated from source**: 2026-02-26
> **Status**: Production

---

## Table of Contents

1. [Overview](#1-overview)
2. [Authentication](#2-authentication)
3. [Leads API — Complete Contract](#3-leads-api--complete-contract)
   - 3.1 [GET /leads](#31-get-leads)
   - 3.2 [GET /leads/:id](#32-get-leadsid)
   - 3.3 [POST /leads](#33-post-leads)
   - 3.4 [PATCH /leads/:id](#34-patch-leadsid)
   - 3.5 [POST /leads/:id/assign](#35-post-leadsidassign)
   - 3.6 [POST /leads/:id/move-stage](#36-post-leadsidmove-stage)
   - 3.7 [GET /leads/:id/checklists](#37-get-leadsidchecklists)
   - 3.8 [GET /stages](#38-get-stages)
   - 3.9 [GET /pipeline](#39-get-pipeline)
   - 3.10 [GET /tools](#310-get-tools)
4. [Lead Object Schema](#4-lead-object-schema)
5. [Idempotency Specification](#5-idempotency-specification)
6. [Error Handling Specification](#6-error-handling-specification)
7. [Webhook Contract](#7-webhook-contract)
8. [Rate Limiting](#8-rate-limiting)
9. [API Stability Policy](#9-api-stability-policy)
10. [Security Confirmation](#10-security-confirmation)

---

## 1. Overview

The GenX CRM Integration API provides external systems (AI agents, third-party services, automation tools) with programmatic access to CRM data. All integration endpoints are scoped to a single tenant, determined by the API key used.

**Key characteristics:**

| Property | Value |
|----------|-------|
| Protocol | HTTPS (TLS 1.2+) |
| Content-Type | `application/json` |
| Authentication | Bearer API key |
| Rate Limit | 120 requests/minute per API key |
| Pagination | Offset-based (`limit` / `offset`) |
| Versioning | URL path (`/api/v1/...`) |
| Soft deletes | Leads with `deleted_at` are excluded from all queries |
| Tenant isolation | API key scoped to exactly one tenant; RLS enforced at database level |

---

## 2. Authentication

### Method

Bearer token authentication using API keys.

### Header Format

```
Authorization: Bearer crm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Key Format

```
crm_live_{base64url(32 random bytes)}
```

- Prefix: `crm_live_`
- Random part: 32 cryptographically random bytes, base64url-encoded
- Total length: ~52 characters

### Example

```http
GET /api/v1/integrations/crm/leads HTTP/1.1
Host: lead-crm.zunkireelabs.com
Authorization: Bearer crm_live_dGhpcyBpcyBhIHNhbXBsZSBrZXkgZm9yIGRvY3M
```

### Hashing at Rest

- Algorithm: **SHA-256**
- The raw API key is **never stored**. Only the SHA-256 hex digest is persisted in `integration_keys.hashed_key`.
- Verification uses **constant-time comparison** (`crypto.timingSafeEqual`) to prevent timing attacks.

### Permission Scopes

| Scope | Grants | HTTP Methods |
|-------|--------|--------------|
| `read` | Read-only access | GET |
| `write` | Read + write access | GET, POST, PATCH |
| `admin` | Full access (read + write) | GET, POST, PATCH |

**Hierarchy**: `admin` ⊃ `write` ⊃ `read`

An API key may have multiple scopes stored as a `TEXT[]` array. The highest scope in the hierarchy determines effective access.

Default permissions for new keys: `["read", "write"]`.

### Revocation Behavior

- Setting `revoked_at` timestamp on the `integration_keys` row revokes the key immediately.
- All subsequent requests with a revoked key receive `401 Unauthorized`.
- The lookup query filters with `.is("revoked_at", null)`, so revoked keys are never matched.

### 401 vs 403 Rules

| Scenario | Status | Error Code |
|----------|--------|------------|
| Missing `Authorization` header | 401 | `UNAUTHORIZED` |
| Invalid header format (not `Bearer ...`) | 401 | `UNAUTHORIZED` |
| Key too short (< 10 chars) | 401 | `UNAUTHORIZED` |
| Key not found in database | 401 | `UNAUTHORIZED` |
| Key revoked | 401 | `UNAUTHORIZED` |
| Hash mismatch | 401 | `UNAUTHORIZED` |
| Internal auth error | 401 | `UNAUTHORIZED` |
| Valid key, insufficient scope | 403 | `FORBIDDEN` |

### Audit Logging

- **Every** authentication attempt (success and failure) is logged to the `audit_logs` table.
- Success logs record: `integration.auth.success`, key ID, IP address, user agent.
- Failure logs record: `integration.auth.failed`, failure reason (`missing_header`, `invalid_key_format`, `key_not_found`, `hash_mismatch`, `internal_error`), IP address, user agent.

### Rate Limit Headers

**Not currently returned in response headers.** The `Retry-After` header is only returned on `429` responses. Standard rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) are **not currently implemented**.

---

## 3. Leads API — Complete Contract

All endpoints below are prefixed with `/api/v1/integrations/crm`.

---

### 3.1 GET /leads

List leads with optional filtering and pagination.

**Permission**: `read`

#### Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `stage_id` | UUID | — | Filter by pipeline stage ID |
| `assigned_to` | UUID | — | Filter by assigned user ID |
| `search` | string | — | Search across `first_name`, `last_name`, `email`, `phone` (case-insensitive `ILIKE`) |
| `limit` | integer | 50 | Results per page (min: 1, max: 100) |
| `offset` | integer | 0 | Number of results to skip (min: 0) |

#### Example Request

```http
GET /api/v1/integrations/crm/leads?limit=10&offset=0&search=john HTTP/1.1
Authorization: Bearer crm_live_xxxxxxxxx
```

#### Example Response (200)

```json
{
  "data": {
    "leads": [
      {
        "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "first_name": "John",
        "last_name": "Doe",
        "email": "john@example.com",
        "phone": "+919876543210",
        "city": "Mumbai",
        "country": "India",
        "status": "new",
        "stage_id": "s1a2b3c4-d5e6-7890-abcd-ef1234567890",
        "stage_slug": "new",
        "stage_name": "New",
        "assigned_to": null,
        "assigned_name": null,
        "custom_fields": {
          "course_interested": "MBA"
        },
        "file_urls": {},
        "intake_source": "integration",
        "intake_medium": null,
        "intake_campaign": null,
        "preferred_contact_method": null,
        "is_final": true,
        "created_at": "2026-02-26T10:30:00.000Z",
        "updated_at": "2026-02-26T10:30:00.000Z"
      }
    ],
    "total": 1,
    "limit": 10,
    "offset": 0
  }
}
```

**Notes:**
- `tenant_id` is **not returned** in the response (it is implicit from the API key).
- Results are ordered by `created_at` descending (newest first).
- Only non-deleted leads are returned (`deleted_at IS NULL`).

---

### 3.2 GET /leads/:id

Get a single lead by ID with checklist summary.

**Permission**: `read`

#### Example Request

```http
GET /api/v1/integrations/crm/leads/a1b2c3d4-e5f6-7890-abcd-ef1234567890 HTTP/1.1
Authorization: Bearer crm_live_xxxxxxxxx
```

#### Example Response (200)

```json
{
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "first_name": "John",
    "last_name": "Doe",
    "email": "john@example.com",
    "phone": "+919876543210",
    "city": "Mumbai",
    "country": "India",
    "status": "contacted",
    "stage_id": "s2a2b3c4-d5e6-7890-abcd-ef1234567890",
    "stage_slug": "contacted",
    "stage_name": "Contacted",
    "assigned_to": "u1a2b3c4-d5e6-7890-abcd-ef1234567890",
    "assigned_name": "admin@zunkireelabs.com",
    "custom_fields": {
      "course_interested": "MBA"
    },
    "file_urls": {
      "marksheet": "https://pirhnklvtjjpuvbvibxf.supabase.co/storage/v1/object/public/lead-documents/rku/abc123/marksheet.pdf"
    },
    "intake_source": "integration",
    "intake_medium": "api",
    "intake_campaign": "spring-2026",
    "preferred_contact_method": "whatsapp",
    "is_final": true,
    "created_at": "2026-02-20T10:30:00.000Z",
    "updated_at": "2026-02-25T14:00:00.000Z",
    "checklist_total": 3,
    "checklist_completed": 1
  }
}
```

**Notes:**
- The single-lead endpoint includes `checklist_total` and `checklist_completed` counts (not present in list endpoint).
- Returns `404` if lead not found or belongs to different tenant.

---

### 3.3 POST /leads

Create a new lead.

**Permission**: `write`

#### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `first_name` | string | Lead's first name |
| `email` | string | Valid email address |

#### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `last_name` | string | `null` | Lead's last name |
| `phone` | string | `null` | Phone number |
| `city` | string | `null` | City |
| `country` | string | `null` | Country |
| `stage_id` | UUID | tenant default stage | Pipeline stage ID (cannot combine with `status`) |
| `status` | string | tenant default stage slug | Pipeline stage slug (cannot combine with `stage_id`) |
| `custom_fields` | object | `{}` | Arbitrary key-value pairs |
| `file_urls` | object | `{}` | File field name to URL mapping |
| `intake_source` | string | `"integration"` | Lead source |
| `intake_medium` | string | `null` | Acquisition medium |
| `intake_campaign` | string | `null` | Campaign name |
| `preferred_contact_method` | string | `null` | Preferred contact method |

#### Idempotency

Supports `Idempotency-Key` header. See [Section 5](#5-idempotency-specification).

#### Stage Resolution Order

1. If `stage_id` is provided → validate it belongs to tenant, use it, derive `status` from slug
2. Else if `status` is provided → find stage by slug in tenant, use it
3. Else → use tenant's default stage (`is_default = true`)
4. If none found → return `422` validation error

#### Auto-set Fields

| Field | Value |
|-------|-------|
| `is_final` | `true` |
| `step` | `1` |
| `intake_source` | `"integration"` (if not provided) |

#### Example Request

```http
POST /api/v1/integrations/crm/leads HTTP/1.1
Authorization: Bearer crm_live_xxxxxxxxx
Content-Type: application/json
Idempotency-Key: 8f3d29ab-1234-5678-abcd-ef1234567890

{
  "first_name": "Jane",
  "last_name": "Smith",
  "email": "jane@example.com",
  "phone": "+919876543210",
  "city": "Delhi",
  "country": "India",
  "status": "new",
  "custom_fields": {
    "course_interested": "BBA",
    "referral_code": "REF2026"
  },
  "intake_source": "partner_api",
  "intake_campaign": "spring-2026"
}
```

#### Example Success Response (201)

```json
{
  "data": {
    "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "first_name": "Jane",
    "last_name": "Smith",
    "email": "jane@example.com",
    "phone": "+919876543210",
    "city": "Delhi",
    "country": "India",
    "status": "new",
    "stage_id": "s1a2b3c4-d5e6-7890-abcd-ef1234567890",
    "stage_slug": "new",
    "stage_name": "New",
    "assigned_to": null,
    "assigned_name": null,
    "custom_fields": {
      "course_interested": "BBA",
      "referral_code": "REF2026"
    },
    "file_urls": {},
    "intake_source": "partner_api",
    "intake_medium": null,
    "intake_campaign": "spring-2026",
    "preferred_contact_method": null,
    "is_final": true,
    "created_at": "2026-02-26T12:00:00.000Z",
    "updated_at": "2026-02-26T12:00:00.000Z"
  }
}
```

#### Example Validation Error (422)

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {
      "first_name": ["first_name is required"],
      "email": ["email is required", "Invalid email address"]
    }
  }
}
```

#### Idempotency Duplicate Response (200)

When the same `Idempotency-Key` is reused, the server returns `200` (not `201`) with the existing lead data.

For `POST /leads`, idempotency is checked via the `leads.idempotency_key` column (unique per tenant). The race condition of concurrent inserts with the same key is handled by catching PostgreSQL unique constraint violation (error code `23505`) and returning the existing lead.

---

### 3.4 PATCH /leads/:id

Update lead fields. Supports partial update (only provided fields are modified).

**Permission**: `write`

#### Updatable Fields

| Field | Type | Notes |
|-------|------|-------|
| `first_name` | string | |
| `last_name` | string | |
| `email` | string | |
| `phone` | string | |
| `city` | string | |
| `country` | string | |
| `status` | string | Pipeline stage slug. **Cannot combine with `stage_id`**. |
| `stage_id` | UUID | Pipeline stage ID. **Cannot combine with `status`**. |
| `assigned_to` | UUID | Must be a tenant member. Set to `null` to unassign. |
| `custom_fields` | object | Replaces entire object (not merged). |
| `file_urls` | object | Replaces entire object (not merged). |
| `intake_source` | string | |
| `intake_medium` | string | |
| `intake_campaign` | string | |
| `preferred_contact_method` | string | |

#### Dual-Mode Stage Handling

- Provide `status` (slug) → auto-resolves to `stage_id`
- Provide `stage_id` → auto-resolves to `status` (slug)
- Providing **both** returns `422` validation error
- Providing **neither** does not change the stage

#### Example Request

```http
PATCH /api/v1/integrations/crm/leads/a1b2c3d4-e5f6-7890-abcd-ef1234567890 HTTP/1.1
Authorization: Bearer crm_live_xxxxxxxxx
Content-Type: application/json

{
  "status": "contacted",
  "assigned_to": "u1a2b3c4-d5e6-7890-abcd-ef1234567890"
}
```

#### Example Response (200)

```json
{
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "first_name": "John",
    "last_name": "Doe",
    "email": "john@example.com",
    "phone": "+919876543210",
    "city": "Mumbai",
    "country": "India",
    "status": "contacted",
    "stage_id": "s2a2b3c4-d5e6-7890-abcd-ef1234567890",
    "stage_slug": "contacted",
    "stage_name": "Contacted",
    "assigned_to": "u1a2b3c4-d5e6-7890-abcd-ef1234567890",
    "assigned_name": "admin@zunkireelabs.com",
    "custom_fields": {},
    "file_urls": {},
    "intake_source": "integration",
    "intake_medium": null,
    "intake_campaign": null,
    "preferred_contact_method": null,
    "is_final": true,
    "created_at": "2026-02-20T10:30:00.000Z",
    "updated_at": "2026-02-26T15:00:00.000Z"
  }
}
```

#### Events Emitted

| Condition | Event Type |
|-----------|-----------|
| Any field updated | `lead.updated` (audit log) |
| `status` changed | `lead.status_changed` |
| `assigned_to` changed | `lead.assigned` |

---

### 3.5 POST /leads/:id/assign

Assign a lead to a team member.

**Permission**: `write`

#### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `user_id` | UUID | Must be a member of the tenant |

#### Idempotency

Supports `Idempotency-Key` header. Cached in `integration_idempotency` table. On duplicate key, returns cached response with `200`.

#### Example Request

```http
POST /api/v1/integrations/crm/leads/a1b2c3d4-e5f6-7890-abcd-ef1234567890/assign HTTP/1.1
Authorization: Bearer crm_live_xxxxxxxxx
Content-Type: application/json
Idempotency-Key: assign-001-a1b2c3d4

{
  "user_id": "u1a2b3c4-d5e6-7890-abcd-ef1234567890"
}
```

#### Example Response (200)

```json
{
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "first_name": "John",
    "last_name": "Doe",
    "email": "john@example.com",
    "phone": "+919876543210",
    "city": "Mumbai",
    "country": "India",
    "status": "new",
    "stage_id": "s1a2b3c4-d5e6-7890-abcd-ef1234567890",
    "stage_slug": "new",
    "stage_name": "New",
    "assigned_to": "u1a2b3c4-d5e6-7890-abcd-ef1234567890",
    "assigned_name": "admin@zunkireelabs.com",
    "custom_fields": {},
    "file_urls": {},
    "intake_source": "integration",
    "intake_medium": null,
    "intake_campaign": null,
    "preferred_contact_method": null,
    "is_final": true,
    "created_at": "2026-02-20T10:30:00.000Z",
    "updated_at": "2026-02-26T15:00:00.000Z"
  }
}
```

#### Events Emitted

- `lead.assigned` — with `old_assigned_to` and `new_assigned_to` in payload.

---

### 3.6 POST /leads/:id/move-stage

Move a lead to a different pipeline stage.

**Permission**: `write`

#### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `stage_id` | UUID | Target pipeline stage (must belong to tenant) |

#### Validation Rules

- Target stage must exist and belong to the same tenant.
- **Current stage must not be terminal** (`is_terminal = true`). Leads in terminal stages (e.g., "Enrolled", "Rejected") cannot be moved. Returns `422`.

#### Idempotency

Supports `Idempotency-Key` header. Cached in `integration_idempotency` table. On duplicate key, returns cached response with `200`.

#### Example Request

```http
POST /api/v1/integrations/crm/leads/a1b2c3d4-e5f6-7890-abcd-ef1234567890/move-stage HTTP/1.1
Authorization: Bearer crm_live_xxxxxxxxx
Content-Type: application/json
Idempotency-Key: move-001-a1b2c3d4

{
  "stage_id": "s2a2b3c4-d5e6-7890-abcd-ef1234567890"
}
```

#### Example Response (200)

```json
{
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "first_name": "John",
    "last_name": "Doe",
    "email": "john@example.com",
    "phone": "+919876543210",
    "city": "Mumbai",
    "country": "India",
    "status": "contacted",
    "stage_id": "s2a2b3c4-d5e6-7890-abcd-ef1234567890",
    "stage_slug": "contacted",
    "stage_name": "Contacted",
    "assigned_to": null,
    "assigned_name": null,
    "custom_fields": {},
    "file_urls": {},
    "intake_source": "integration",
    "intake_medium": null,
    "intake_campaign": null,
    "preferred_contact_method": null,
    "is_final": true,
    "created_at": "2026-02-20T10:30:00.000Z",
    "updated_at": "2026-02-26T15:30:00.000Z"
  }
}
```

#### Events Emitted

- `lead.status_changed` — with `old_status`, `new_status`, `old_stage_id`, `new_stage_id` in payload.

---

### 3.7 GET /leads/:id/checklists

Get checklist items for a lead.

**Permission**: `read`

#### Example Request

```http
GET /api/v1/integrations/crm/leads/a1b2c3d4-e5f6-7890-abcd-ef1234567890/checklists HTTP/1.1
Authorization: Bearer crm_live_xxxxxxxxx
```

#### Example Response (200)

```json
{
  "data": [
    {
      "id": "c1a2b3c4-d5e6-7890-abcd-ef1234567890",
      "title": "Verify documents",
      "is_completed": true,
      "completed_at": "2026-02-25T10:00:00.000Z",
      "completed_by": "u1a2b3c4-d5e6-7890-abcd-ef1234567890",
      "position": 0,
      "created_at": "2026-02-20T10:30:00.000Z"
    },
    {
      "id": "c2a2b3c4-d5e6-7890-abcd-ef1234567890",
      "title": "Schedule counseling call",
      "is_completed": false,
      "completed_at": null,
      "completed_by": null,
      "position": 1,
      "created_at": "2026-02-20T10:30:00.000Z"
    }
  ]
}
```

**Notes:**
- Checklists are ordered by `position` ascending.
- Verifies lead exists and belongs to tenant before returning checklists.

---

### 3.8 GET /stages

List all pipeline stages for the tenant.

**Permission**: `read`

#### Example Request

```http
GET /api/v1/integrations/crm/stages HTTP/1.1
Authorization: Bearer crm_live_xxxxxxxxx
```

#### Example Response (200)

```json
{
  "data": [
    {
      "id": "s1a2b3c4-d5e6-7890-abcd-ef1234567890",
      "slug": "new",
      "name": "New",
      "position": 0,
      "color": "#3b82f6",
      "is_default": true,
      "is_terminal": false
    },
    {
      "id": "s2a2b3c4-d5e6-7890-abcd-ef1234567890",
      "slug": "partial",
      "name": "Partial",
      "position": 1,
      "color": "#f97316",
      "is_default": false,
      "is_terminal": false
    },
    {
      "id": "s3a2b3c4-d5e6-7890-abcd-ef1234567890",
      "slug": "contacted",
      "name": "Contacted",
      "position": 2,
      "color": "#a855f7",
      "is_default": false,
      "is_terminal": false
    },
    {
      "id": "s4a2b3c4-d5e6-7890-abcd-ef1234567890",
      "slug": "enrolled",
      "name": "Enrolled",
      "position": 3,
      "color": "#22c55e",
      "is_default": false,
      "is_terminal": true
    },
    {
      "id": "s5a2b3c4-d5e6-7890-abcd-ef1234567890",
      "slug": "rejected",
      "name": "Rejected",
      "position": 4,
      "color": "#ef4444",
      "is_default": false,
      "is_terminal": true
    }
  ]
}
```

**Notes:**
- Stages are ordered by `position` ascending.
- `tenant_id` is **not returned** (implicit from API key).

---

### 3.9 GET /pipeline

Get full pipeline view with stages and their grouped leads.

**Permission**: `read`

#### Example Request

```http
GET /api/v1/integrations/crm/pipeline HTTP/1.1
Authorization: Bearer crm_live_xxxxxxxxx
```

#### Example Response (200)

```json
{
  "data": [
    {
      "stage": {
        "id": "s1a2b3c4-d5e6-7890-abcd-ef1234567890",
        "slug": "new",
        "name": "New",
        "position": 0,
        "color": "#3b82f6",
        "is_default": true,
        "is_terminal": false
      },
      "leads": [
        {
          "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
          "first_name": "John",
          "last_name": "Doe",
          "email": "john@example.com",
          "phone": "+919876543210",
          "city": "Mumbai",
          "country": "India",
          "status": "new",
          "stage_id": "s1a2b3c4-d5e6-7890-abcd-ef1234567890",
          "stage_slug": "new",
          "stage_name": "New",
          "assigned_to": null,
          "assigned_name": null,
          "custom_fields": {},
          "file_urls": {},
          "intake_source": "integration",
          "intake_medium": null,
          "intake_campaign": null,
          "preferred_contact_method": null,
          "is_final": true,
          "created_at": "2026-02-26T10:30:00.000Z",
          "updated_at": "2026-02-26T10:30:00.000Z"
        }
      ]
    },
    {
      "stage": {
        "id": "s2a2b3c4-d5e6-7890-abcd-ef1234567890",
        "slug": "partial",
        "name": "Partial",
        "position": 1,
        "color": "#f97316",
        "is_default": false,
        "is_terminal": false
      },
      "leads": []
    }
  ]
}
```

**Notes:**
- All stages are returned even if they have no leads (empty `leads` array).
- Leads within each stage are ordered by `created_at` descending.
- Only non-deleted leads with a non-null `stage_id` are included.

---

### 3.10 GET /tools

AI agent tool manifest describing all available integration endpoints.

**Permission**: `read`

#### Example Request

```http
GET /api/v1/integrations/crm/tools HTTP/1.1
Authorization: Bearer crm_live_xxxxxxxxx
```

#### Example Response (200)

```json
{
  "data": {
    "name": "Zunkiree CRM",
    "version": "1.0",
    "tools": [
      {
        "name": "list_leads",
        "description": "List CRM leads with optional filtering",
        "method": "GET",
        "endpoint": "/api/v1/integrations/crm/leads",
        "parameters": {
          "stage_id": "uuid (optional)",
          "assigned_to": "uuid (optional)",
          "search": "string (optional)",
          "limit": "number (optional, default 50, max 100)",
          "offset": "number (optional, default 0)"
        }
      },
      {
        "name": "get_lead",
        "description": "Get a single lead by ID with checklist summary",
        "method": "GET",
        "endpoint": "/api/v1/integrations/crm/leads/:id",
        "parameters": {
          "id": "uuid (required, path parameter)"
        }
      },
      {
        "name": "create_lead",
        "description": "Create a new lead",
        "method": "POST",
        "endpoint": "/api/v1/integrations/crm/leads",
        "parameters": {
          "first_name": "string (required)",
          "email": "string (required)",
          "last_name": "string (optional)",
          "phone": "string (optional)",
          "city": "string (optional)",
          "country": "string (optional)",
          "stage_id": "uuid (optional, defaults to tenant default stage)",
          "status": "string (optional, pipeline stage slug)",
          "custom_fields": "object (optional)",
          "intake_source": "string (optional)",
          "intake_medium": "string (optional)",
          "intake_campaign": "string (optional)",
          "preferred_contact_method": "string (optional)"
        }
      },
      {
        "name": "update_lead",
        "description": "Update lead fields. Supports dual-mode: provide status (slug) OR stage_id, not both.",
        "method": "PATCH",
        "endpoint": "/api/v1/integrations/crm/leads/:id",
        "parameters": {
          "first_name": "string (optional)",
          "last_name": "string (optional)",
          "email": "string (optional)",
          "phone": "string (optional)",
          "city": "string (optional)",
          "country": "string (optional)",
          "stage_id": "uuid (optional, cannot combine with status)",
          "status": "string (optional, pipeline stage slug, cannot combine with stage_id)",
          "assigned_to": "uuid (optional, must be tenant member)",
          "custom_fields": "object (optional)",
          "file_urls": "object (optional)",
          "intake_source": "string (optional)",
          "intake_medium": "string (optional)",
          "intake_campaign": "string (optional)",
          "preferred_contact_method": "string (optional)"
        }
      },
      {
        "name": "assign_lead",
        "description": "Assign a lead to a team member",
        "method": "POST",
        "endpoint": "/api/v1/integrations/crm/leads/:id/assign",
        "parameters": {
          "user_id": "uuid (required, must be tenant member)"
        }
      },
      {
        "name": "move_stage",
        "description": "Move a lead to another pipeline stage. Cannot move from terminal stages.",
        "method": "POST",
        "endpoint": "/api/v1/integrations/crm/leads/:id/move-stage",
        "parameters": {
          "stage_id": "uuid (required, must belong to tenant)"
        }
      },
      {
        "name": "get_lead_checklists",
        "description": "Get checklist items for a lead",
        "method": "GET",
        "endpoint": "/api/v1/integrations/crm/leads/:id/checklists",
        "parameters": {
          "id": "uuid (required, path parameter)"
        }
      },
      {
        "name": "list_stages",
        "description": "List all pipeline stages ordered by position",
        "method": "GET",
        "endpoint": "/api/v1/integrations/crm/stages",
        "parameters": {}
      },
      {
        "name": "get_pipeline",
        "description": "Get grouped pipeline view with stages and their leads",
        "method": "GET",
        "endpoint": "/api/v1/integrations/crm/pipeline",
        "parameters": {}
      }
    ]
  }
}
```

**Notes:**
- The manifest `version` field is `"1.0"`. There is no separate `schema_version` field in the current implementation.
- This endpoint is intended for AI agents and automation platforms to discover available operations.

---

## 4. Lead Object Schema

### Normalized Lead (Integration API response format)

```json
{
  "id": "uuid",
  "first_name": "string | null",
  "last_name": "string | null",
  "email": "string | null",
  "phone": "string | null",
  "city": "string | null",
  "country": "string | null",
  "status": "string",
  "stage_id": "uuid | null",
  "stage_slug": "string | null",
  "stage_name": "string | null",
  "assigned_to": "uuid | null",
  "assigned_name": "string | null",
  "custom_fields": { "key": "value" },
  "file_urls": { "key": "url" },
  "intake_source": "string | null",
  "intake_medium": "string | null",
  "intake_campaign": "string | null",
  "preferred_contact_method": "string | null",
  "is_final": "boolean",
  "created_at": "ISO 8601 timestamp",
  "updated_at": "ISO 8601 timestamp"
}
```

### Single Lead Detail (GET /leads/:id only)

Extends the normalized lead with:

```json
{
  "checklist_total": "integer",
  "checklist_completed": "integer"
}
```

### JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "NormalizedLead",
  "type": "object",
  "required": [
    "id", "first_name", "last_name", "email", "phone", "city", "country",
    "status", "stage_id", "stage_slug", "stage_name", "assigned_to",
    "assigned_name", "custom_fields", "file_urls", "intake_source",
    "intake_medium", "intake_campaign", "preferred_contact_method",
    "is_final", "created_at", "updated_at"
  ],
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "first_name": { "type": ["string", "null"] },
    "last_name": { "type": ["string", "null"] },
    "email": { "type": ["string", "null"], "format": "email" },
    "phone": { "type": ["string", "null"] },
    "city": { "type": ["string", "null"] },
    "country": { "type": ["string", "null"] },
    "status": { "type": "string" },
    "stage_id": { "type": ["string", "null"], "format": "uuid" },
    "stage_slug": { "type": ["string", "null"] },
    "stage_name": { "type": ["string", "null"] },
    "assigned_to": { "type": ["string", "null"], "format": "uuid" },
    "assigned_name": { "type": ["string", "null"] },
    "custom_fields": { "type": "object", "additionalProperties": true },
    "file_urls": { "type": "object", "additionalProperties": { "type": "string" } },
    "intake_source": { "type": ["string", "null"] },
    "intake_medium": { "type": ["string", "null"] },
    "intake_campaign": { "type": ["string", "null"] },
    "preferred_contact_method": { "type": ["string", "null"] },
    "is_final": { "type": "boolean" },
    "created_at": { "type": "string", "format": "date-time" },
    "updated_at": { "type": "string", "format": "date-time" }
  },
  "additionalProperties": false
}
```

### Email Uniqueness

- **Email is NOT unique** in the `leads` table. There is no unique constraint on `email`.
- Duplicate emails **can** exist across different leads (even within the same tenant).
- The only uniqueness constraint on leads is `UNIQUE(tenant_id, idempotency_key)`.
- Idempotency does **not** rely on email uniqueness. It relies solely on the `idempotency_key` column (for form submissions) or the `Idempotency-Key` header → `integration_idempotency` table (for integration API calls).

---

## 5. Idempotency Specification

### Header

```
Idempotency-Key: <string>
```

Case-insensitive header name (HTTP standard). The value is an arbitrary string (typically a UUID).

### Supported Endpoints

| Endpoint | Idempotency Mechanism |
|----------|----------------------|
| `POST /leads` (integration) | `Idempotency-Key` header → checks `leads.idempotency_key` column (unique per tenant) |
| `POST /leads/:id/assign` | `Idempotency-Key` header → `integration_idempotency` table |
| `POST /leads/:id/move-stage` | `Idempotency-Key` header → `integration_idempotency` table |
| `POST /leads` (form submission) | `idempotency_key` body field → `leads.idempotency_key` column |

### Storage Mechanism

**For `POST /leads` (integration):**
- The `idempotency_key` is stored directly on the `leads` row.
- Database constraint: `UNIQUE(tenant_id, idempotency_key)`.
- On check: queries `leads` table for matching `tenant_id` + `idempotency_key`.
- On duplicate insert (race condition, PostgreSQL error `23505`): catches the error and returns the existing lead.

**For `POST /assign` and `POST /move-stage`:**
- Stored in the `integration_idempotency` table.
- Database constraint: `UNIQUE(tenant_id, idempotency_key)`.
- On check: queries for matching `tenant_id` + `idempotency_key`, returns cached `response` JSONB.
- On success: stores the full response JSON using upsert.

### Response Behavior on Duplicate Key

- If the key has been seen before, the **cached response** is returned with status `200`.
- For `POST /leads`: returns the existing lead (200 instead of 201).
- For `assign` / `move-stage`: returns the cached response JSON from `integration_idempotency.response`.

### TTL Policy

**No TTL. Stored permanently.** There is no cleanup job or expiry mechanism for idempotency records. Records persist indefinitely in both the `leads.idempotency_key` column and the `integration_idempotency` table.

### Example

```http
POST /api/v1/integrations/crm/leads HTTP/1.1
Authorization: Bearer crm_live_xxxxxxxxx
Content-Type: application/json
Idempotency-Key: 8f3d29ab-1c4d-4e5f-9a8b-7c6d5e4f3a2b

{
  "first_name": "Jane",
  "email": "jane@example.com"
}
```

First request → `201 Created` with lead data.
Second request (same key) → `200 OK` with same lead data.

---

## 6. Error Handling Specification

### Error Response Structure

All errors follow this format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {
      "field_name": ["error message 1", "error message 2"]
    }
  }
}
```

The `details` field is only present on `422 VALIDATION_ERROR` responses.

### Error Examples

#### 400 — Bad Request (Invalid JSON body)

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {
      "body": ["Invalid JSON body"]
    }
  }
}
```

*Note: Malformed JSON bodies return 422 with field-level details in the current implementation.*

#### 401 — Unauthorized

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required"
  }
}
```

#### 403 — Forbidden

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Insufficient permissions"
  }
}
```

#### 404 — Not Found

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Lead not found"
  }
}
```

The entity name is dynamic (e.g., "Lead not found", "Resource not found").

#### 409 — Conflict

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "A pending invite already exists for this email"
  }
}
```

#### 422 — Validation Error

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {
      "first_name": ["first_name is required"],
      "email": ["email is required", "Invalid email address"],
      "stage_id": ["Invalid stage_id for this tenant"]
    }
  }
}
```

#### 429 — Rate Limited

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests"
  }
}
```

Response includes `Retry-After` header (seconds until window resets).

#### 503 — Service Unavailable

```json
{
  "error": {
    "code": "SERVICE_UNAVAILABLE",
    "message": "Failed to fetch leads"
  }
}
```

The message is contextual (e.g., "Failed to create lead", "Rate limiter unavailable").

---

## 7. Webhook Contract

### Event Types

| Event | Trigger |
|-------|---------|
| `lead.created` | New lead created (via form or integration) |
| `lead.updated` | Lead fields updated |
| `lead.status_changed` | Lead moved to different pipeline stage |
| `lead.assigned` | Lead assigned to a team member |
| `lead.deleted` | Lead soft-deleted |
| `checklist.created` | Checklist item added |
| `checklist.updated` | Checklist item modified |
| `checklist.deleted` | Checklist item removed |
| `invite.created` | Team invite sent |
| `invite.accepted` | Team invite accepted |

### Payload Structure

```json
{
  "event": "lead.created",
  "tenant_id": "t1a2b3c4-d5e6-7890-abcd-ef1234567890",
  "timestamp": "2026-02-26T12:00:00.000Z",
  "data": {
    "lead": {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "first_name": "Jane",
      "last_name": "Smith",
      "email": "jane@example.com",
      "phone": "+919876543210",
      "city": "Delhi",
      "country": "India",
      "status": "new",
      "stage_id": "s1a2b3c4-d5e6-7890-abcd-ef1234567890",
      "stage_slug": "new",
      "stage_name": "New",
      "assigned_to": null,
      "assigned_name": null,
      "custom_fields": {},
      "file_urls": {},
      "intake_source": "integration",
      "intake_medium": null,
      "intake_campaign": null,
      "preferred_contact_method": null,
      "is_final": true,
      "created_at": "2026-02-26T12:00:00.000Z",
      "updated_at": "2026-02-26T12:00:00.000Z"
    },
    "entity_type": "lead",
    "entity_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  }
}
```

**Notes:**
- For lead events, `data.lead` contains the full normalized lead snapshot at the time of the event.
- For non-lead events, `data.lead` is absent; only `entity_type`, `entity_id`, and any extra payload fields are present.
- Additional payload fields (e.g., `old_status`, `new_status` for `lead.status_changed`) are merged into the `data` object.

### HMAC Signing

| Property | Value |
|----------|-------|
| Algorithm | HMAC-SHA256 |
| Header name | `X-Signature` |
| Header format | `sha256={hex_digest}` |
| Signed content | Raw JSON string of the entire webhook payload |
| Secret | Per-endpoint secret stored in `webhook_endpoints.secret` |

**Signing logic (pseudocode):**
```
signature = HMAC-SHA256(endpoint_secret, raw_json_body_string)
X-Signature: sha256={hex(signature)}
```

**Exact implementation:**
```typescript
import { createHmac } from "crypto";
const signature = createHmac("sha256", secret).update(payloadString).digest("hex");
// Header: X-Signature: sha256={signature}
```

**Timestamp is NOT separately included in the signature.** The `timestamp` field is part of the JSON payload, which is signed as a whole, but there is no separate timestamp-based signing scheme (e.g., no `X-Timestamp` header or `timestamp + body` concatenation).

### Delivery Headers

```http
Content-Type: application/json
X-Signature: sha256=abcdef1234567890...
X-Webhook-Event: lead.created
User-Agent: LeadGenCRM-Webhook/1.0
```

### Retry Policy

| Property | Value |
|----------|-------|
| Max attempts | 3 |
| Retry delays | 0ms (immediate), 2,000ms, 5,000ms |
| Timeout per attempt | 10,000ms (10 seconds) |
| Success criteria | HTTP 2xx response |
| Failure handling | All 3 attempts exhausted → logged as error, no further retries |

### Delivery Logging

Every delivery attempt is logged to `webhook_deliveries` table:

| Column | Description |
|--------|-------------|
| `webhook_id` | FK to `webhook_endpoints` |
| `event_type` | Event type string |
| `payload` | Full JSON payload |
| `attempt` | Attempt number (1, 2, or 3) |
| `status_code` | HTTP response status (0 for network errors) |
| `response_body` | Response body (truncated to 2,000 chars) |
| `success` | Boolean |
| `created_at` | Timestamp |

### Non-Blocking Dispatch

Webhook delivery is **fire-and-forget**. The `dispatchWebhookEvent` function is called without `await` in the event emission flow (`emitEvent`). Webhook failures never block CRM API responses.

---

## 8. Rate Limiting

### Integration API Rate Limit

| Property | Value |
|----------|-------|
| Limit | 120 requests per minute |
| Window | 60 seconds (sliding window) |
| Scope | Per API key (`integration:{integrationKeyId}`) |
| Burst | No explicit burst allowance. Requests are counted sequentially within the sliding window. |
| Daily cap | **Not implemented.** Only per-minute rate limiting exists. |

### 429 Response

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests"
  }
}
```

With header:
```
Retry-After: 45
```

The `Retry-After` value is the number of seconds until the current rate limit window expires.

### Rate Limit Headers

**Not currently returned on successful responses.** The following standard headers are **not implemented**:
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

Only the `Retry-After` header is returned on `429` responses.

### Storage

Rate limit state is stored in the `rate_limits` PostgreSQL table (not in-memory). Expired entries are cleaned up probabilistically (1% chance on each request).

---

## 9. API Stability Policy

### Current Version

`v1` — all integration endpoints are under `/api/v1/integrations/crm/`.

### Versioning Strategy

URL path versioning. Future versions would be `/api/v2/integrations/crm/`.

### Breaking Change Policy

**Not formally documented.** The API is currently at v1 with no deprecation mechanism in place. The tool manifest includes a `version: "1.0"` field that would be incremented on manifest changes.

### Deprecation Approach

**Not currently implemented.** No `Sunset` or `Deprecation` headers are returned. No formal deprecation policy is documented. Breaking changes would require a new version path.

### Tool Manifest Version

The tool manifest at `GET /tools` includes:
- `name`: `"Zunkiree CRM"`
- `version`: `"1.0"`

There is no separate `schema_version` field. The `version` field serves as the manifest version indicator.

---

## 10. Security Confirmation

| Control | Status | Details |
|---------|--------|---------|
| TLS 1.2+ enforced | **Yes** | Traefik reverse proxy with Let's Encrypt SSL certificates |
| API keys hashed at rest | **Yes** | SHA-256 hex digest stored in `integration_keys.hashed_key`; raw key never persisted |
| Constant-time comparison | **Yes** | `crypto.timingSafeEqual()` used for hash verification |
| Scoped permissions | **Yes** | `read`, `write`, `admin` scopes with hierarchy enforcement |
| Audit logging per key | **Yes** | All auth attempts (success + failure) logged to `audit_logs`; all mutations logged with key context |
| RLS tenant isolation | **Yes** | PostgreSQL Row Level Security on all tenant data tables; `SECURITY DEFINER` helper functions prevent infinite recursion |
| Key revocation | **Yes** | `revoked_at` timestamp on `integration_keys`; revoked keys immediately rejected |
| IP tracking | **Yes** | Client IP extracted from `x-forwarded-for` / `x-real-ip` headers and logged in audit entries |
| Webhook payload signing | **Yes** | HMAC-SHA256 with per-endpoint secrets |
| Rate limiting | **Yes** | 120 req/min per API key, sliding window, database-backed |
| Soft deletes | **Yes** | Leads are never hard-deleted; `deleted_at` timestamp used; all queries filter for non-deleted records |
