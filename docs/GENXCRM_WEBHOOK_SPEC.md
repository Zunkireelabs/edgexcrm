# GenXCRM Webhook Stability Specification

> **Version**: 1.0
> **Effective Date**: 2026-03-01
> **Status**: Production
> **Maintainer**: Zunkiree Labs

---

## Table of Contents

1. [Overview](#1-overview)
2. [Supported Events](#2-supported-events)
3. [Payload Schema](#3-payload-schema)
4. [Signing Algorithm](#4-signing-algorithm)
5. [Retry Strategy](#5-retry-strategy)
6. [Delivery Timeout](#6-delivery-timeout)
7. [Failure Logging](#7-failure-logging)
8. [Replay Mechanism](#8-replay-mechanism)
9. [Deduplication Strategy](#9-deduplication-strategy)
10. [Security Guarantees](#10-security-guarantees)
11. [Endpoint Registration](#11-endpoint-registration)
12. [Delivery Headers](#12-delivery-headers)

---

## 1. Overview

GenXCRM dispatches webhooks to registered endpoints when significant CRM events occur. Webhooks are **non-blocking** — they never delay or fail CRM operations. All delivery is asynchronous and best-effort with retries.

### Key Properties

| Property | Value |
|----------|-------|
| Delivery model | Push (HTTP POST) |
| Content type | `application/json` |
| Signing | HMAC-SHA256 |
| Max attempts | 3 per event per endpoint |
| Timeout | 10 seconds per attempt |
| Blocking | Never — webhook failures do not affect API responses |
| Ordering | Best-effort, not guaranteed |

---

## 2. Supported Events

### Lead Events

| Event Type | Trigger | Payload Contains |
|------------|---------|-----------------|
| `lead.created` | New lead created via integration API or form submission | Full normalized lead snapshot |
| `lead.status_changed` | Lead moved to a different pipeline stage | Lead snapshot + old/new status |
| `lead.assigned` | Lead assigned to a different team member | Lead snapshot + old/new assigned_to |

### Event Type Format

Event types follow the pattern: `{entity}.{action}`

- Entity: `lead` (more entity types may be added in future)
- Action: `created`, `status_changed`, `assigned`

### Future Events (Reserved)

The following event types are reserved for future use and may be added without breaking the webhook contract:

- `lead.updated`
- `lead.deleted`
- `lead.note_added`
- `checklist.completed`

---

## 3. Payload Schema

### Envelope

Every webhook delivery has this exact structure:

```json
{
  "event": "lead.created",
  "timestamp": "2026-03-01T12:00:00.000Z",
  "data": {
    "lead": {
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
    },
    "entity_type": "lead",
    "entity_id": "uuid"
  }
}
```

### Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `event` | string | Event type identifier |
| `timestamp` | ISO 8601 string | When the event was generated (server time) |
| `data` | object | Event payload (structure varies by event type) |
| `data.lead` | object | Normalized lead snapshot (present for all lead events) |
| `data.entity_type` | string | Entity type (`"lead"`) |
| `data.entity_id` | string (UUID) | Entity identifier |

### Event-Specific Fields

#### `lead.created`

```json
{
  "data": {
    "lead": { "...snapshot..." },
    "email": "user@example.com",
    "stage_id": "uuid",
    "entity_type": "lead",
    "entity_id": "uuid"
  }
}
```

#### `lead.status_changed`

```json
{
  "data": {
    "lead": { "...snapshot..." },
    "old_status": "new",
    "new_status": "contacted",
    "old_stage_id": "uuid",
    "new_stage_id": "uuid",
    "entity_type": "lead",
    "entity_id": "uuid"
  }
}
```

#### `lead.assigned`

```json
{
  "data": {
    "lead": { "...snapshot..." },
    "old_assigned_to": "uuid | null",
    "new_assigned_to": "uuid",
    "entity_type": "lead",
    "entity_id": "uuid"
  }
}
```

### Fields NEVER Present in Webhook Payloads

The following internal fields are **guaranteed to never appear** in webhook payloads:

| Field | Reason |
|-------|--------|
| `tenant_id` | Internal multi-tenancy identifier — security risk if exposed |
| `integration_key_id` | Internal API key identifier — security risk if exposed |
| `hashed_key` | Cryptographic material — security risk |
| `deleted_at` | Internal soft-delete marker |
| `idempotency_key` | Internal deduplication key |

---

## 4. Signing Algorithm

### Method

HMAC-SHA256

### Process

1. Serialize the webhook payload to a JSON string
2. Compute HMAC-SHA256 of the JSON string using the endpoint's secret key
3. Encode the digest as a lowercase hex string
4. Send in the `X-Signature` header with `sha256=` prefix

### Signature Header

```
X-Signature: sha256=a1b2c3d4e5f6...
```

### Verification (Consumer Side)

```python
import hmac
import hashlib

def verify_webhook(payload_bytes: bytes, signature_header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode(), payload_bytes, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

```typescript
import { createHmac, timingSafeEqual } from "crypto";

function verifyWebhook(payload: string, signatureHeader: string, secret: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
  if (expected.length !== signatureHeader.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}
```

### Important Notes

- **Always use constant-time comparison** to prevent timing attacks
- The payload used for signing is the exact raw JSON body string (no re-serialization)
- Secrets are per-endpoint and generated at registration time

---

## 5. Retry Strategy

### Retry Schedule

| Attempt | Delay Before Attempt | Cumulative Time |
|---------|---------------------|-----------------|
| 1 | 0ms (immediate) | 0s |
| 2 | 2,000ms | 2s |
| 3 | 5,000ms | 7s |

### Retry Conditions

A delivery is retried when:

- HTTP response status is not 2xx (200–299)
- Connection timeout (10s)
- DNS resolution failure
- Connection refused
- TLS handshake failure
- Any network-level error

### Retry Termination

Retries stop when:

- A 2xx response is received (success)
- All 3 attempts are exhausted
- **Retries do NOT stop on 4xx** — all non-2xx responses trigger retry

### Post-Exhaustion Behavior

After all 3 attempts fail:

1. The failure is logged to `webhook_deliveries` table with all attempt details
2. An error log entry is emitted via the application logger
3. No further automatic retries are attempted
4. The event data remains in the `events` table for manual replay

---

## 6. Delivery Timeout

| Property | Value |
|----------|-------|
| Timeout per attempt | 10,000ms (10 seconds) |
| Implementation | `AbortController` with `setTimeout` |
| Behavior on timeout | Aborts the request, counts as failed attempt, triggers retry |

### Recommendations for Consumers

- Respond with `200 OK` as quickly as possible
- Process webhook payloads asynchronously (queue internally)
- Do not perform long-running operations in the webhook handler
- A response within 5 seconds is recommended; 10 seconds is the hard limit

---

## 7. Failure Logging

### Database Logging

Every delivery attempt (success or failure) is logged to the `webhook_deliveries` table:

| Column | Type | Description |
|--------|------|-------------|
| `webhook_id` | uuid | The webhook endpoint ID |
| `event_type` | string | Event type (e.g., `lead.created`) |
| `payload` | jsonb | The full webhook payload |
| `attempt` | integer | Attempt number (1, 2, or 3) |
| `status_code` | integer | HTTP response status (0 for network errors) |
| `response_body` | text | First 2000 characters of response body |
| `success` | boolean | Whether the delivery was successful |
| `created_at` | timestamp | When the attempt was made |

### Application Logging

- **Success**: Info-level log with webhook ID, event type, attempt number, status code
- **Per-attempt failure**: Warn-level log with webhook ID, event type, attempt number, status code
- **All-attempts exhausted**: Error-level log with webhook ID, event type, endpoint URL

### Log Retention

Webhook delivery logs are retained in the database indefinitely. Consumers can query delivery history through the admin dashboard (future feature).

---

## 8. Replay Mechanism

### Current State

There is **no automated replay mechanism** in v1. This is a known limitation.

### Manual Replay

Events are persisted in the `events` table with full payload data. Manual replay can be performed by:

1. Querying the `events` table for the desired event
2. Re-dispatching the webhook using the stored payload
3. This must be done by a system administrator

### Future Considerations

An automated replay API endpoint is planned for v2:

```
POST /api/v2/integrations/crm/webhooks/:endpoint_id/replay
{
  "event_id": "uuid"
}
```

### Event Persistence

| Property | Value |
|----------|-------|
| Storage | `events` table (PostgreSQL) |
| Retention | Indefinite |
| Fields | tenant_id, type, entity_type, entity_id, payload, status, created_at |

---

## 9. Deduplication Strategy

### Producer Side (GenXCRM)

- Events are emitted once per trigger action
- The `events` table records each event with a unique ID
- Webhook dispatch is triggered exactly once per event (with retries for failed delivery)

### Consumer Side (Recommended)

Consumers should implement their own deduplication using:

1. **`entity_id` + `event` + `timestamp`**: These three fields together uniquely identify an event
2. **Idempotent processing**: Design webhook handlers to be safe for duplicate delivery
3. **Event deduplication window**: Track processed event signatures for a reasonable window (e.g., 1 hour)

### Duplicate Delivery Scenarios

Duplicates can occur in these edge cases:

| Scenario | Likelihood | Cause |
|----------|-----------|-------|
| Retry after timeout | Medium | Consumer processed but response timed out |
| Application restart during dispatch | Low | Event re-dispatched on recovery |
| Database transaction rollback | Very low | Event committed but parent transaction rolled back |

### Recommendation

**Always design webhook consumers to be idempotent.** Use the `entity_id` + `event` combination as a natural deduplication key.

---

## 10. Security Guarantees

### Payload Sanitization

1. **No internal identifiers**: `tenant_id`, `integration_key_id`, `hashed_key` are never included
2. **No database internals**: `deleted_at`, `idempotency_key`, row-level metadata excluded
3. **Normalized data only**: All lead data passes through `normalizeLead()` which strips internal fields
4. **Payload sanitization**: Event payloads are explicitly sanitized to remove `tenant_id` and `integration_key_id` before webhook dispatch

### Transport Security

1. **HTTPS required**: Webhook endpoints must use HTTPS (HTTP URLs are rejected at registration)
2. **TLS 1.2+**: Minimum TLS version for webhook delivery
3. **Signature verification**: Every payload is signed with HMAC-SHA256

### Secret Management

1. Webhook secrets are generated at endpoint registration
2. Secrets are stored encrypted in the database
3. Each endpoint has its own unique secret
4. Secrets can be rotated via the admin API

---

## 11. Endpoint Registration

### Configuration

Webhook endpoints are registered per-tenant in the `webhook_endpoints` table:

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | Endpoint identifier |
| `tenant_id` | uuid | Owning tenant |
| `url` | string | HTTPS URL for delivery |
| `secret` | string | HMAC-SHA256 signing secret |
| `event_types` | string[] | Subscribed event types |
| `is_active` | boolean | Whether the endpoint is active |

### Event Type Filtering

Endpoints only receive events they subscribe to. The `event_types` array acts as a filter:

```json
{
  "event_types": ["lead.created", "lead.status_changed"]
}
```

An endpoint with `["lead.created"]` will NOT receive `lead.assigned` events.

---

## 12. Delivery Headers

Every webhook delivery includes these HTTP headers:

| Header | Value | Description |
|--------|-------|-------------|
| `Content-Type` | `application/json` | Payload format |
| `X-Signature` | `sha256={hex}` | HMAC-SHA256 signature |
| `X-Webhook-Event` | Event type string | The event type (e.g., `lead.created`) |
| `User-Agent` | `LeadGenCRM-Webhook/1.0` | Identifies the sender |

---

*This specification is the authoritative reference for GenXCRM webhook behavior. All webhook consumers, including Orca connectorFactory, should implement against this specification.*
