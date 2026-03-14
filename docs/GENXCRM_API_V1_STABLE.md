# GenXCRM API v1 — Official Stable Contract

> **Version**: 1.0.0-stable
> **Effective Date**: 2026-03-01
> **Status**: FROZEN — Production SaaS Platform Contract
> **Base URL**: `https://lead-crm.zunkireelabs.com`
> **API Prefix**: `/api/v1/integrations/crm`
> **Maintainer**: Zunkiree Labs

---

## Table of Contents

1. [Overview](#1-overview)
2. [Authentication](#2-authentication)
3. [Required Headers](#3-required-headers)
4. [Rate Limiting](#4-rate-limiting)
5. [Idempotency](#5-idempotency)
6. [Error Model](#6-error-model)
7. [Endpoint Reference](#7-endpoint-reference)
   - 7.1 [GET /leads](#71-get-leads)
   - 7.2 [GET /leads/:id](#72-get-leadsid)
   - 7.3 [POST /leads](#73-post-leads)
   - 7.4 [PATCH /leads/:id](#74-patch-leadsid)
   - 7.5 [POST /leads/:id/assign](#75-post-leadsidassign)
   - 7.6 [POST /leads/:id/move-stage](#76-post-leadsidmove-stage)
   - 7.7 [GET /leads/:id/checklists](#77-get-leadsidchecklists)
   - 7.8 [GET /stages](#78-get-stages)
   - 7.9 [GET /pipeline](#79-get-pipeline)
   - 7.10 [GET /tools](#710-get-tools)
8. [Webhook Guarantees](#8-webhook-guarantees)
9. [Stability Guarantees](#9-stability-guarantees)

---

## 1. Overview

The GenXCRM Integration API provides external systems (AI agents, orchestrators like Orca, third-party services, automation tools) with programmatic access to CRM data. All integration endpoints are scoped to a single tenant, determined by the API key used.

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
| Error format | Deterministic JSON on all error codes (4xx, 5xx) |

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

### Hashing at Rest

| Property | Value |
|----------|-------|
| Algorithm | SHA-256 |
| Storage | Only hex digest stored in `integration_keys.hashed_key` |
| Verification | Constant-time comparison (`crypto.timingSafeEqual`) |

The raw API key is **never stored**. Only shown once at generation time.

### Permission Scopes

| Scope | Grants | HTTP Methods |
|-------|--------|--------------|
| `read` | Read-only access | GET |
| `write` | Read + write access | GET, POST, PATCH |
| `admin` | Full access (read + write) | GET, POST, PATCH |

**Hierarchy**: `admin` ⊃ `write` ⊃ `read`

### Authentication Failures

| Scenario | Status | Code |
|----------|--------|------|
| Missing `Authorization` header | 401 | `UNAUTHORIZED` |
| Invalid key format | 401 | `UNAUTHORIZED` |
| Key not found or revoked | 401 | `UNAUTHORIZED` |
| Insufficient scope | 403 | `FORBIDDEN` |

---

## 3. Required Headers

### Request Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes | `Bearer crm_live_...` |
| `Content-Type` | Yes (POST/PATCH) | `application/json` |
| `Idempotency-Key` | Recommended (POST) | UUID or unique string for deduplication |

### Response Headers (All Successful Responses)

| Header | Description | Example |
|--------|-------------|---------|
| `X-RateLimit-Limit` | Max requests per window | `120` |
| `X-RateLimit-Remaining` | Remaining requests in window | `117` |
| `X-RateLimit-Reset` | Unix timestamp when window resets | `1709312460` |

### Response Headers (429 Only)

| Header | Description | Example |
|--------|-------------|---------|
| `Retry-After` | Seconds to wait before retrying | `42` |

---

## 4. Rate Limiting

| Property | Value |
|----------|-------|
| Window | 60 seconds (sliding) |
| Limit | 120 requests per API key per window |
| Scope | Per integration API key |
| Enforcement | Database-backed (persistent across restarts) |
| Failure mode | Fail closed (denies on limiter error) |

### Rate Limit Response

**Status**: `429 Too Many Requests`

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests"
  }
}
```

**Headers**:
```
Retry-After: 42
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1709312460
```

---

## 5. Idempotency

### Supported Endpoints

| Endpoint | Idempotency Support |
|----------|-------------------|
| `POST /leads` | Via `Idempotency-Key` header + `idempotency_key` column |
| `POST /leads/:id/assign` | Via `Idempotency-Key` header + `integration_idempotency` table |
| `POST /leads/:id/move-stage` | Via `Idempotency-Key` header + `integration_idempotency` table |

### Behavior

| Call | Status Code | Behavior |
|------|-------------|----------|
| First call | `201` | Resource created/action performed, result stored |
| Duplicate call (same key) | `200` | Cached result returned, no side effects |

### Rules

1. The `Idempotency-Key` header is optional but recommended for all POST operations.
2. Keys are scoped to the tenant (two tenants can use the same key independently).
3. Keys are permanent — once used, the cached result is returned indefinitely.
4. Race conditions are handled: if two concurrent requests use the same key, the database unique constraint prevents duplicates and the second request returns the first's result.
5. Idempotency storage failures are non-blocking — the operation succeeds but may not be deduplicated on retry.

---

## 6. Error Model

### Standard Error Response

All error responses follow this deterministic format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": {
      "field_name": ["Error message 1", "Error message 2"]
    }
  }
}
```

The `details` field is only present on `VALIDATION_ERROR` responses.

### Error Codes

| HTTP Status | Code | Description |
|-------------|------|-------------|
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 403 | `FORBIDDEN` | Insufficient permission scope |
| 404 | `NOT_FOUND` | Resource not found (or cross-tenant access) |
| 409 | `CONFLICT` | Resource conflict |
| 422 | `VALIDATION_ERROR` | Request body validation failed (includes `details`) |
| 429 | `RATE_LIMITED` | Rate limit exceeded (includes `Retry-After` header) |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
| 503 | `SERVICE_UNAVAILABLE` | Database or downstream service unavailable |

### 500 Error Guarantee

All unhandled exceptions produce a deterministic JSON response:

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Unexpected server error"
  }
}
```

The server **never** returns HTML error pages, stack traces, or non-JSON 500 responses from integration endpoints.

### HTTP Status Code Separation

| Range | Usage |
|-------|-------|
| `2xx` | Success (200 OK, 201 Created) |
| `4xx` | Client errors (auth, validation, not found, rate limit) |
| `5xx` | Server errors (internal error, service unavailable) |

### Cross-Tenant Access

Attempting to access a resource belonging to another tenant returns `404 NOT_FOUND` — never `403`. This prevents information leakage about resource existence in other tenants.

---

## 7. Endpoint Reference

### 7.1 GET /leads

List leads with optional filtering and pagination.

**Path**: `/api/v1/integrations/crm/leads`
**Method**: `GET`
**Scope**: `read`

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `email` | string | No | — | Case-insensitive exact match on email. Returns 200 with empty array if none found. Never returns 404. |
| `stage_id` | uuid | No | — | Filter by pipeline stage UUID |
| `assigned_to` | uuid | No | — | Filter by assigned user UUID |
| `search` | string | No | — | Case-insensitive partial match across first_name, last_name, email, phone |
| `limit` | integer | No | 50 | Results per page (1–100) |
| `offset` | integer | No | 0 | Number of results to skip |

#### Success Response (200)

```json
{
  "data": {
    "leads": [
      {
        "id": "uuid",
        "first_name": "string",
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
        "custom_fields": {},
        "file_urls": {},
        "intake_source": "string | null",
        "intake_medium": "string | null",
        "intake_campaign": "string | null",
        "preferred_contact_method": "string | null",
        "is_final": true,
        "created_at": "ISO 8601",
        "updated_at": "ISO 8601"
      }
    ],
    "total": 42,
    "limit": 50,
    "offset": 0
  }
}
```

#### Empty Result Guarantee

When `email` filter is used and no leads match, the response is:

```json
{
  "data": {
    "leads": [],
    "total": 0,
    "limit": 50,
    "offset": 0
  }
}
```

**Status**: `200 OK` (never `404`)

---

### 7.2 GET /leads/:id

Get a single lead by ID with checklist summary.

**Path**: `/api/v1/integrations/crm/leads/:id`
**Method**: `GET`
**Scope**: `read`

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | uuid | Yes | Lead UUID |

#### Success Response (200)

```json
{
  "data": {
    "id": "uuid",
    "first_name": "string",
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
    "custom_fields": {},
    "file_urls": {},
    "intake_source": "string | null",
    "intake_medium": "string | null",
    "intake_campaign": "string | null",
    "preferred_contact_method": "string | null",
    "is_final": true,
    "created_at": "ISO 8601",
    "updated_at": "ISO 8601",
    "checklist_total": 0,
    "checklist_completed": 0
  }
}
```

#### Error Responses

| Status | When |
|--------|------|
| 404 | Lead not found or belongs to another tenant |

---

### 7.3 POST /leads

Create a new lead.

**Path**: `/api/v1/integrations/crm/leads`
**Method**: `POST`
**Scope**: `write`

#### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `first_name` | string | Yes | Lead's first name |
| `email` | string (email) | Yes | Lead's email address |
| `last_name` | string | No | Lead's last name |
| `phone` | string | No | Phone number |
| `city` | string | No | City |
| `country` | string | No | Country |
| `stage_id` | uuid | No | Pipeline stage UUID (mutually exclusive with `status`) |
| `status` | string | No | Pipeline stage slug (mutually exclusive with `stage_id`) |
| `custom_fields` | object | No | Arbitrary key-value data |
| `file_urls` | object | No | File URL mappings |
| `intake_source` | string | No | Lead source (default: `"integration"`) |
| `intake_medium` | string | No | Acquisition medium |
| `intake_campaign` | string | No | Campaign identifier |
| `preferred_contact_method` | string | No | Preferred contact method |

#### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Idempotency-Key` | Recommended | Unique key for deduplication |

#### Success Response

| Call | Status | Description |
|------|--------|-------------|
| First call | `201 Created` | Lead created |
| Duplicate (same Idempotency-Key) | `200 OK` | Cached lead returned |

#### Error Responses

| Status | Code | When |
|--------|------|------|
| 422 | `VALIDATION_ERROR` | Missing required fields, invalid email, invalid stage |

---

### 7.4 PATCH /leads/:id

Update lead fields.

**Path**: `/api/v1/integrations/crm/leads/:id`
**Method**: `PATCH`
**Scope**: `write`

#### Updatable Fields

`first_name`, `last_name`, `email`, `phone`, `city`, `country`, `status` (slug), `stage_id` (UUID), `assigned_to` (UUID), `custom_fields`, `file_urls`, `intake_source`, `intake_medium`, `intake_campaign`, `preferred_contact_method`

**Constraint**: Cannot provide both `status` and `stage_id` in the same request.

#### Success Response (200)

Returns the updated normalized lead object.

#### Error Responses

| Status | Code | When |
|--------|------|------|
| 404 | `NOT_FOUND` | Lead not found or belongs to another tenant |
| 422 | `VALIDATION_ERROR` | Both status and stage_id provided, invalid stage, invalid assigned_to |

---

### 7.5 POST /leads/:id/assign

Assign a lead to a team member.

**Path**: `/api/v1/integrations/crm/leads/:id/assign`
**Method**: `POST`
**Scope**: `write`

#### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user_id` | uuid | Yes | Team member UUID (must be tenant member) |

#### Idempotency

| Call | Status |
|------|--------|
| First call | `201 Created` |
| Duplicate (same Idempotency-Key) | `200 OK` |

---

### 7.6 POST /leads/:id/move-stage

Move a lead to another pipeline stage.

**Path**: `/api/v1/integrations/crm/leads/:id/move-stage`
**Method**: `POST`
**Scope**: `write`

#### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `stage_id` | uuid | Yes | Target pipeline stage UUID |

#### Constraints

- Cannot move a lead from a terminal stage.
- Target stage must belong to the same tenant.

#### Idempotency

| Call | Status |
|------|--------|
| First call | `201 Created` |
| Duplicate (same Idempotency-Key) | `200 OK` |

---

### 7.7 GET /leads/:id/checklists

Get checklist items for a lead.

**Path**: `/api/v1/integrations/crm/leads/:id/checklists`
**Method**: `GET`
**Scope**: `read`

#### Success Response (200)

```json
{
  "data": [
    {
      "id": "uuid",
      "title": "string",
      "is_completed": false,
      "completed_at": "ISO 8601 | null",
      "completed_by": "uuid | null",
      "position": 1,
      "created_at": "ISO 8601"
    }
  ]
}
```

---

### 7.8 GET /stages

List all pipeline stages.

**Path**: `/api/v1/integrations/crm/stages`
**Method**: `GET`
**Scope**: `read`

#### Success Response (200)

```json
{
  "data": [
    {
      "id": "uuid",
      "slug": "string",
      "name": "string",
      "position": 1,
      "color": "string",
      "is_default": false,
      "is_terminal": false
    }
  ]
}
```

---

### 7.9 GET /pipeline

Get grouped pipeline view with stages and their leads.

**Path**: `/api/v1/integrations/crm/pipeline`
**Method**: `GET`
**Scope**: `read`

#### Success Response (200)

```json
{
  "data": [
    {
      "stage": {
        "id": "uuid",
        "slug": "string",
        "name": "string",
        "position": 1,
        "color": "string",
        "is_default": false,
        "is_terminal": false
      },
      "leads": [
        { "...normalized lead object..." }
      ]
    }
  ]
}
```

---

### 7.10 GET /tools

Get the tool manifest describing all available endpoints.

**Path**: `/api/v1/integrations/crm/tools`
**Method**: `GET`
**Scope**: `read`

Returns a structured manifest of all endpoints, their methods, and parameters. Used by AI agents and orchestrators for tool discovery.

---

## 8. Webhook Guarantees

### Payload Contract

Webhook payloads **never** expose:

- `tenant_id`
- `integration_key_id`
- Internal database row IDs beyond entity UUIDs

### Payload Format

```json
{
  "event": "lead.created",
  "timestamp": "ISO 8601",
  "data": {
    "lead": { "...normalized lead object..." },
    "entity_type": "lead",
    "entity_id": "uuid"
  }
}
```

### Signing

- Algorithm: HMAC-SHA256
- Header: `X-Signature: sha256={hex_digest}`
- Payload: Raw JSON body string

### Delivery

| Property | Value |
|----------|-------|
| Timeout | 10 seconds per attempt |
| Max attempts | 3 |
| Retry delays | Immediate, 2s, 5s |
| Failure behavior | Logged to `webhook_deliveries` table, never blocks CRM operations |

### Supported Events

| Event | Trigger |
|-------|---------|
| `lead.created` | New lead created via integration API |
| `lead.status_changed` | Lead status/stage changed |
| `lead.assigned` | Lead assigned to a team member |

---

## 9. Stability Guarantees

### v1 Freeze Rules

1. **No breaking changes** to `/api/v1/` endpoints after this contract is published.
2. **Additive changes only**: new optional fields, new optional query parameters, new endpoints.
3. **No field removal**: existing response fields will never be removed.
4. **No type changes**: field types will not change (e.g., string will not become integer).
5. **No status code changes**: existing status codes for existing operations are fixed.
6. **No semantic changes**: the meaning of fields and parameters will not change.

### Breaking Change Definition

Any change that would cause a correctly-implemented client to break:

- Removing or renaming an endpoint
- Removing or renaming a response field
- Changing a field's data type
- Making an optional parameter required
- Changing authentication scheme
- Changing error response structure
- Changing status codes for existing behavior

### When v2 Is Required

A new API version (`/api/v2/`) is required for any breaking change. The v1 endpoints will continue to function with a minimum 90-day deprecation notice using the `Sunset` header.

---

*This document constitutes the official GenXCRM API v1 public contract. All external integrations, including Orca connectorFactory, should rely on this specification.*
