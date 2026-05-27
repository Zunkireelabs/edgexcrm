# GenXCRM API Governance Model

> **Version**: 1.0
> **Effective Date**: 2026-03-01
> **Status**: Active
> **Maintainer**: Zunkiree Labs
> **Applies to**: All `/api/v1/integrations/crm/*` endpoints

---

## Table of Contents

1. [Purpose](#1-purpose)
2. [Versioning Strategy](#2-versioning-strategy)
3. [v1 Freeze Rules](#3-v1-freeze-rules)
4. [Breaking vs Non-Breaking Changes](#4-breaking-vs-non-breaking-changes)
5. [Deprecation Policy](#5-deprecation-policy)
6. [Change Management Policy](#6-change-management-policy)
7. [Schema Change Protocol](#7-schema-change-protocol)
8. [Stability Guarantee Statement](#8-stability-guarantee-statement)

---

## 1. Purpose

This document defines the governance model for the GenXCRM Integration API. It establishes the rules, processes, and guarantees that allow external consumers — including Orca via connectorFactory — to depend on GenXCRM's API long-term without fear of unexpected breakage.

This governance model is binding. All API changes must follow these rules.

---

## 2. Versioning Strategy

### URL-Based Versioning

```
/api/v{major}/integrations/crm/...
```

The API version is embedded in the URL path. The major version number increments only on breaking changes.

### Version Lifecycle

| State | Description |
|-------|-------------|
| **Current** | Actively maintained. Receives bug fixes, security patches, and additive features. |
| **Deprecated** | Still functional but scheduled for removal. Sunset header is set on all responses. Minimum 90-day notice. |
| **Sunset** | Removed. Returns `410 Gone` with migration instructions. |

### Current Versions

| Version | State | Freeze Date |
|---------|-------|-------------|
| v1 | Current (Frozen) | 2026-03-01 |

### When /v2 Is Required

A new major version (`/api/v2/`) is required when ANY breaking change is necessary. This includes:

- Removing or renaming an endpoint
- Removing or renaming a response field
- Changing a field's data type
- Making an optional parameter required
- Changing the authentication scheme
- Changing the error response structure
- Changing status code semantics for existing operations
- Changing rate limit enforcement semantics
- Altering idempotency behavior

A v2 must:
1. Be developed alongside v1 (dual-running)
2. Have its own complete contract document
3. Include a migration guide from v1
4. Be announced with minimum 90-day advance notice before v1 deprecation begins

---

## 3. v1 Freeze Rules

The following rules are **immutable** for `/api/v1/`:

### MUST NOT change:

1. **Endpoint paths** — no renaming, no removal
2. **HTTP methods** — GET stays GET, POST stays POST
3. **Required fields** — no new required fields on existing endpoints
4. **Response field names** — no renaming of existing fields
5. **Response field types** — a string stays a string, a number stays a number
6. **Status codes** — 201 stays 201, 404 stays 404
7. **Authentication scheme** — Bearer token stays Bearer token
8. **Error response structure** — `{ error: { code, message, details? } }` is permanent
9. **Rate limit enforcement model** — per-key, 120/minute window
10. **Idempotency semantics** — 201 first call, 200 duplicate

### MAY change (additive only):

1. New optional query parameters on existing endpoints
2. New optional fields in response objects
3. New optional fields in request bodies
4. New endpoints under `/api/v1/integrations/crm/`
5. New webhook event types
6. New permission scopes (as long as existing scopes retain their meaning)
7. Increased rate limits (never decreased)
8. Bug fixes that bring behavior in line with this contract

---

## 4. Breaking vs Non-Breaking Changes

### Breaking Changes (Require v2)

| Category | Example |
|----------|---------|
| Endpoint removal | Removing `GET /leads` |
| Endpoint rename | Changing `/leads` to `/contacts` |
| Field removal | Removing `stage_slug` from lead response |
| Field rename | Renaming `assigned_to` to `owner_id` |
| Type change | Changing `position` from integer to string |
| Required field addition | Making `phone` required on POST /leads |
| Auth change | Switching from Bearer to OAuth2 |
| Error structure change | Changing error envelope from `{ error: {...} }` to `{ errors: [...] }` |
| Status code change | Changing POST /leads from 201 to 200 on first call |
| Semantic change | Changing `email` filter from exact match to partial match |

### Non-Breaking Changes (Allowed in v1)

| Category | Example |
|----------|---------|
| New optional field in response | Adding `tags` array to lead response |
| New optional query parameter | Adding `created_after` filter to GET /leads |
| New optional request field | Adding `notes` to POST /leads body |
| New endpoint | Adding `GET /leads/:id/notes` |
| New webhook event | Adding `lead.deleted` event |
| New permission scope | Adding `delete` scope |
| Bug fix | Fixing incorrect status code that deviated from contract |
| Rate limit increase | Raising from 120/min to 200/min |
| Performance improvement | Faster response times |

---

## 5. Deprecation Policy

### Timeline

| Phase | Duration | Action |
|-------|----------|--------|
| Announcement | Day 0 | Public notice via changelog, email to registered integrators |
| Sunset header | Day 0+ | `Sunset: {date}` header added to all deprecated version responses |
| Grace period | 90 days minimum | Both old and new versions run concurrently |
| End of life | Day 90+ | Old version returns `410 Gone` with migration URL |

### Sunset Header

When a version is deprecated, all responses include:

```
Sunset: Sat, 01 Jun 2026 00:00:00 GMT
Deprecation: true
Link: <https://lead-crm.zunkireelabs.com/docs/migration-v1-to-v2>; rel="successor-version"
```

### Notification Requirements

1. **Email notification** to all registered integration key owners at deprecation announcement
2. **In-API notification** via Sunset header on every response
3. **Dashboard notification** in the GenXCRM admin panel
4. **Changelog entry** in the public documentation

### Minimum Deprecation Period

**90 calendar days** from announcement to sunset. No exceptions.

For critical security vulnerabilities, an expedited deprecation may be applied with a minimum **30-day** notice, but only if the security issue cannot be resolved without a breaking change.

---

## 6. Change Management Policy

### How Endpoints Evolve

1. **Proposal**: Document the change with rationale, impact assessment, and compatibility analysis
2. **Classification**: Determine if the change is breaking or non-breaking using Section 4 criteria
3. **Review**: At least one team member must review the change against this governance model
4. **Testing**: All changes must pass integration tests that validate contract compliance
5. **Deployment**: Non-breaking changes deploy directly. Breaking changes require v2 pathway.
6. **Documentation**: Update `GENXCRM_API_V1_STABLE.md`, `openapi.json`, and Postman collection simultaneously

### Change Approval Matrix

| Change Type | Approval Required |
|-------------|------------------|
| Bug fix (aligns with contract) | Team lead |
| New optional response field | Team lead |
| New endpoint | Engineering lead + product |
| New required field on new endpoint | Engineering lead + product |
| Deprecation of v1 | CTO + all active connector maintainers notified |
| Breaking change (v2) | CTO + architecture review |

### Rollback Policy

All API changes must be reversible within 1 hour of deployment. This means:
- Database migrations must be backward-compatible
- New code must not depend on schema changes that break the previous version
- Feature flags should be used for significant changes

---

## 7. Schema Change Protocol

### Database Schema Changes

1. **Additive only** for v1: New columns must have defaults or be nullable
2. **No column removals** while v1 is active
3. **No column renames** while v1 is active
4. **No type changes** on columns exposed through the API
5. Migrations must be idempotent and reversible

### Response Schema Changes

1. New fields may be added to response objects at any time (non-breaking)
2. Consumers must ignore unknown fields (forward-compatible parsing)
3. Field order in JSON objects is not guaranteed and must not be relied upon
4. Array ordering is guaranteed only where explicitly documented (e.g., stages ordered by position)

### Request Schema Changes

1. New optional fields may be added to request bodies
2. Unknown fields in request bodies are silently ignored (not rejected)
3. Validation rules on existing fields must not become stricter

---

## 8. Stability Guarantee Statement

### Official Statement

> **Zunkiree Labs guarantees that the GenXCRM Integration API v1, as documented in `GENXCRM_API_V1_STABLE.md`, will remain stable, backward-compatible, and fully operational for all correctly-implemented clients. No breaking changes will be made to v1 endpoints. When a future version is required, v1 will receive a minimum 90-day deprecation notice with full migration documentation.**

### What This Means for Orca

1. The Orca connectorFactory can hard-code against v1 endpoints with confidence
2. Response field names, types, and status codes will not change
3. Rate limit headers will always be present on integration responses
4. Error responses will always follow the documented JSON structure
5. Idempotency behavior is permanent and reliable
6. Webhook payloads will never expose internal identifiers
7. Authentication via Bearer API key will not change

### Compliance Verification

This governance model is enforced through:
- TypeScript type contracts (`NormalizedLead`, `NormalizedLeadDetail` interfaces)
- The `withIntegrationErrorBoundary` wrapper ensuring deterministic error responses
- The `normalizeLead` function stripping internal fields before API responses
- Integration test suites validating contract compliance
- OpenAPI spec validation against live endpoints

---

*This governance model is effective immediately and applies to all future changes to the GenXCRM Integration API.*
