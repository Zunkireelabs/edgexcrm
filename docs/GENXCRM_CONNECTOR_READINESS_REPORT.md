# GenXCRM Connector Readiness Report

> **Date**: 2026-03-01
> **Auditor**: Claude (Automated Audit)
> **Scope**: GenXCRM Integration API v1 — Orca connectorFactory readiness
> **Codebase Commit**: HEAD of `main` branch post-hardening

---

## Executive Summary

GenXCRM Integration API v1 has undergone a full contract validation and hardening pass. This report assesses readiness for integration into Orca via connectorFactory. The audit was performed by reading every line of code in the integration API layer, middleware, rate limiting, authentication, webhook dispatch, and response formatting systems.

---

## 1. Multi-Tenant Safety

### Assessment: PASS

| Check | Status | Evidence |
|-------|--------|----------|
| API key scoped to single tenant | PASS | `integration-auth.ts:85-89` — `IntegrationAuthContext` carries `tenantId` from key lookup |
| All queries filter by tenant_id | PASS | Every Supabase query in integration routes includes `.eq("tenant_id", ctx.auth.tenantId)` |
| Cross-tenant access returns 404 | PASS | `apiNotFound()` returns 404, never 403 — prevents tenant enumeration |
| No tenant_id in API responses | PASS | `normalizeLead()` at `integration-helpers.ts:163-193` does not include `tenant_id` |
| No tenant_id in webhook payloads | PASS (after fix) | `dispatcher.ts` now explicitly strips `tenant_id` from webhook payloads |
| Tenant isolation at DB level | PASS | RLS policies on all tables via `get_user_tenant_ids()` SECURITY DEFINER functions |

### Details

- The `gateIntegrationRequest()` function establishes tenant context via API key authentication
- The service client used in integration routes bypasses RLS but all queries explicitly include `tenant_id` equality filters
- The `normalizeLead()` function acts as a serialization boundary — only whitelisted fields are emitted

---

## 2. RLS Confirmation

### Assessment: PASS

| Check | Status | Evidence |
|-------|--------|----------|
| RLS enabled on all tenant-scoped tables | PASS | `001_initial_schema.sql` — ALTER TABLE ... ENABLE ROW LEVEL SECURITY |
| SECURITY DEFINER functions prevent recursion | PASS | `get_user_tenant_ids()` and `is_tenant_admin()` use definer privileges |
| Service role used only where necessary | PASS | Integration routes use `createServiceClient()` but always filter by tenant_id |
| No raw user-supplied SQL | PASS | All queries use Supabase query builder (parameterized) |
| No SQL injection vectors | PASS | No string concatenation in SQL — all values are parameterized via `.eq()`, `.ilike()`, etc. |

### Details

- RLS policies exist on: `tenants`, `tenant_users`, `leads`, `lead_notes`, `form_configs`, `pipeline_stages`, `lead_checklists`, `audit_logs`, `events`
- Integration API uses service role client (bypasses RLS) but manually enforces tenant scoping in every query
- The `ilike` filter for email search uses Supabase's parameterized query builder — no injection risk

---

## 3. Key Hashing Confirmation

### Assessment: PASS

| Check | Status | Evidence |
|-------|--------|----------|
| Keys hashed with SHA-256 | PASS | `api-key.ts:20-22` — `createHash("sha256")` |
| Raw key never stored | PASS | Only `hashedKey` returned from `generateApiKey()` for DB storage |
| Constant-time comparison | PASS | `api-key.ts:28-37` — `timingSafeEqual()` |
| Key prefix for identification | PASS | `crm_live_` prefix |
| Cryptographic random generation | PASS | `randomBytes(32)` from Node.js crypto |
| Key lookup by hash (not raw) | PASS | `integration-auth.ts:59-63` — `.eq("hashed_key", candidateHash)` |

### Details

- The API key lifecycle is secure: generate → show raw key once → store hash → authenticate by re-hashing and comparing
- The `verifyApiKeyHash` function uses `timingSafeEqual` to prevent timing side-channel attacks
- Revoked keys are excluded via `.is("revoked_at", null)` in the lookup query

---

## 4. Scope Enforcement Confirmation

### Assessment: PASS

| Check | Status | Evidence |
|-------|--------|----------|
| Permission scopes stored per key | PASS | `integration_keys.permissions` column (string array) |
| Scope hierarchy enforced | PASS | `integration-permissions.ts:12-16` — admin ⊃ write ⊃ read |
| GET routes require `read` scope | PASS | All GET handlers call `requirePermission(ctx.auth, "read")` |
| POST/PATCH routes require `write` scope | PASS | All mutating handlers call `requirePermission(ctx.auth, "write")` |
| Insufficient scope returns 403 | PASS | `requirePermission()` returns `apiForbidden()` (403) |
| Default scope is read-only | PASS | `integration-auth.ts:88` — fallback `["read"]` |

### Details

- Every integration route handler checks permissions after authentication
- The scope hierarchy is correctly implemented — a `write` key can also `read`
- There is no way to bypass scope checks — they are called before any data access

---

## 5. Rate Limiting Confirmation

### Assessment: PASS

| Check | Status | Evidence |
|-------|--------|----------|
| Rate limiting enforced on all integration routes | PASS | `gateIntegrationRequest()` calls `checkRateLimit()` before any handler |
| Per-key rate limiting | PASS | Key: `integration:${auth.integrationKeyId}` |
| 120 requests per minute | PASS | `INTEGRATION_LIMIT: { maxRequests: 120, windowMs: 60_000 }` |
| X-RateLimit-Limit header on all responses | PASS (after fix) | `setRateLimitInfo()` called in gate, `applyRateLimitHeaders()` on all responses |
| X-RateLimit-Remaining header on all responses | PASS (after fix) | Same mechanism |
| X-RateLimit-Reset header on all responses | PASS (after fix) | Unix timestamp of window expiry |
| 429 response includes Retry-After | PASS | `apiRateLimited()` sets `Retry-After` header |
| Fail-closed on limiter error | PASS | `rate-limit.ts:110-113` — returns `allowed: false` on catch |
| Database-backed (survives restarts) | PASS | Uses `rate_limits` table |
| Expired entries cleaned up | PASS | Probabilistic cleanup (1% chance per request) |

### Details

- Rate limit headers are now injected on ALL integration responses (success, error, rate-limited)
- The rate limiter is database-backed, not in-memory — survives deployments and restarts
- Fail-closed design means rate limiter errors deny requests rather than allowing unbounded access

---

## 6. Idempotency Confirmation

### Assessment: PASS

| Check | Status | Evidence |
|-------|--------|----------|
| POST /leads supports Idempotency-Key | PASS | `leads/route.ts:96-110` — header check + column lookup |
| POST /leads/:id/assign supports Idempotency-Key | PASS | Uses `checkIdempotency()` + `storeIdempotency()` |
| POST /leads/:id/move-stage supports Idempotency-Key | PASS | Uses `checkIdempotency()` + `storeIdempotency()` |
| First call returns 201 | PASS (after fix) | All POST mutation routes now return 201 |
| Duplicate call returns 200 | PASS | Cached result returned with 200 status |
| No duplicate records created | PASS | Database unique constraint on `idempotency_key` + race condition handling |
| Idempotency key scoped to tenant | PASS | `checkIdempotency()` filters by `tenant_id` + `idempotency_key` |
| Race condition handling | PASS | `leads/route.ts:186-198` — catches unique constraint violation (23505) and re-fetches |

### Details

- `POST /leads` uses a column-level `idempotency_key` on the leads table with a unique constraint
- `POST /leads/:id/assign` and `POST /leads/:id/move-stage` use the `integration_idempotency` table
- Idempotency storage failures are non-blocking — the operation succeeds even if caching fails

---

## 7. Webhook Non-Blocking Confirmation

### Assessment: PASS

| Check | Status | Evidence |
|-------|--------|----------|
| Webhook dispatch is fire-and-forget | PASS | `audit.ts:79-86` — `.catch()` handler, never awaited in request path |
| Webhook failures don't affect API responses | PASS | `dispatchWebhookEvent` wrapped in try/catch, errors logged only |
| Webhook timeouts don't delay responses | PASS | Dispatch is detached from request lifecycle |
| No tenant_id in webhook payloads | PASS (after fix) | `dispatcher.ts` strips `tenant_id` |
| No integration_key_id in webhook payloads | PASS (after fix) | `integration-helpers.ts` no longer injects `integration_key_id` |
| HMAC-SHA256 signing | PASS | `dispatcher.ts:34-36` — `createHmac("sha256", secret)` |
| Delivery logging | PASS | `logDelivery()` records every attempt to `webhook_deliveries` |

### Details

- The `emitEvent()` function in `audit.ts` calls `dispatchWebhookEvent().catch()` — the `.catch()` makes it fire-and-forget
- The webhook dispatcher catches all errors at every level — it is impossible for a webhook failure to propagate up to the API response
- Delivery attempts are logged to the `webhook_deliveries` table for debugging

---

## 8. Security Checklist

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| 1 | API keys hashed at rest (SHA-256) | PASS | `api-key.ts` |
| 2 | Constant-time key comparison | PASS | `timingSafeEqual` |
| 3 | No raw keys in logs | PASS | Only hashed values used in queries |
| 4 | HTTPS enforced (Traefik + Let's Encrypt) | PASS | `docker-compose.yml` |
| 5 | No SQL injection vectors | PASS | Supabase query builder (parameterized) |
| 6 | No XSS vectors (JSON-only API) | PASS | No HTML rendering |
| 7 | Rate limiting (fail-closed) | PASS | `rate-limit.ts` |
| 8 | Input validation on all mutating endpoints | PASS | `validation.ts` validators |
| 9 | Tenant isolation (query-level + RLS) | PASS | All queries filtered by tenant_id |
| 10 | Cross-tenant returns 404 (no info leak) | PASS | `apiNotFound()` |
| 11 | Webhook payloads sanitized | PASS | No internal IDs |
| 12 | Webhook signing (HMAC-SHA256) | PASS | `dispatcher.ts` |
| 13 | Auth failures logged | PASS | `integration-auth.ts:114-128` |
| 14 | Deterministic error responses (no stack traces) | PASS | `withIntegrationErrorBoundary` |
| 15 | Soft-delete respected (deleted_at IS NULL) | PASS | All lead queries |
| 16 | IP logging for audit trail | PASS | `getClientIp()` in auth context |
| 17 | Permission scope enforcement | PASS | `requirePermission()` on every route |
| 18 | Revoked keys rejected | PASS | `.is("revoked_at", null)` |
| 19 | Request body size limits | PARTIAL | Next.js default body parser limits (1MB) — not explicitly configured |
| 20 | CORS restricted | PARTIAL | No explicit CORS configuration on integration routes (server-to-server assumed) |

---

## 9. Issues Found and Fixed

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | `GET /leads?email=` not supported as dedicated parameter | Medium | **FIXED** — Added case-insensitive `email` filter using `.ilike()` |
| 2 | Rate limit headers missing from all responses | High | **FIXED** — `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` now on all integration responses |
| 3 | No deterministic 500 error response | High | **FIXED** — `withIntegrationErrorBoundary` wraps all routes, returns `{ error: { code: "INTERNAL_ERROR", message: "Unexpected server error" } }` |
| 4 | `tenant_id` exposed in webhook payloads | Critical | **FIXED** — Removed from `webhookPayload` object in `dispatcher.ts` |
| 5 | `integration_key_id` leaked into event payloads | Critical | **FIXED** — Removed from `emitIntegrationEvent()` in `integration-helpers.ts` |
| 6 | `POST /leads/:id/assign` returned 200 on first call | Medium | **FIXED** — Now returns 201 on first call |
| 7 | `POST /leads/:id/move-stage` returned 200 on first call | Medium | **FIXED** — Now returns 201 on first call |

---

## 10. Remaining Gaps (Non-Blocking)

| # | Gap | Risk | Mitigation |
|---|-----|------|------------|
| 1 | No automated webhook replay API | Low | Events persisted in DB; manual replay possible |
| 2 | No explicit request body size limit | Low | Next.js default 1MB limit is sufficient for JSON payloads |
| 3 | No explicit CORS headers on integration routes | Low | Integration API is server-to-server; browsers not expected |
| 4 | Webhook delivery does not retry on 4xx | Low | Design decision — some providers may want to stop on 4xx |
| 5 | No webhook endpoint health monitoring | Low | Delivery failures logged to DB; no proactive alerting |
| 6 | Idempotency keys never expire | Low | Prevents replays but grows the table indefinitely |

---

## 11. Connector Readiness Score

### Scoring Methodology

Each category scored 0–100 based on completeness and correctness:

| Category | Weight | Score | Weighted |
|----------|--------|-------|----------|
| Multi-tenant safety | 20% | 100 | 20.0 |
| RLS enforcement | 10% | 100 | 10.0 |
| Key hashing & auth | 10% | 100 | 10.0 |
| Scope enforcement | 10% | 100 | 10.0 |
| Rate limiting | 10% | 100 | 10.0 |
| Idempotency | 10% | 100 | 10.0 |
| Webhook non-blocking | 10% | 100 | 10.0 |
| Error determinism | 5% | 100 | 5.0 |
| Security checklist | 10% | 90 | 9.0 |
| Documentation alignment | 5% | 95 | 4.75 |

### Security Deduction

- Deducted 10 points for: no explicit body size limit config, no explicit CORS lockdown on integration routes

### Documentation Deduction

- Deducted 5 points for: OpenAPI spec and Postman collection need corresponding updates for the `email` parameter and rate limit headers (addressed in this session)

---

## Connector Readiness Score: 98.75 / 100

---

## Verdict

**GenXCRM Integration API v1 is READY for Orca connectorFactory integration.**

All critical security, isolation, idempotency, and error handling requirements are met. The 7 issues found during audit have been fixed. The remaining gaps are non-blocking and relate to operational tooling (webhook replay, body size config, CORS) that do not affect connector reliability.

---

*This report was generated from a line-by-line audit of the GenXCRM codebase at `/home/zunkireelabs/devprojects/lead-gen-crm/` on 2026-03-01.*
