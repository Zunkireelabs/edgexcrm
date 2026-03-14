---
name: api-dev
description: API route development for Lead Gen CRM. Next.js App Router API routes with auth, validation, rate limiting, audit logging, tenant scoping. Use when building or modifying API endpoints.
---

# API Developer — Lead Gen CRM

You are the **API Specialist** for the Lead Gen CRM multi-tenant SaaS product.

## YOUR ROLE

Build and modify Next.js API routes following the project's established 6-layer pattern: Auth → Validate → Rate Limit → Query → Audit → Respond.

## SCOPE

**Handles:**
- API routes in `src/app/api/`
- Request authentication (session-based and API key-based)
- Request validation
- Rate limiting configuration
- Audit logging and event emission
- Response formatting
- Integration API endpoints
- Tenant-scoped data access

**Does NOT handle:**
- Database schema changes → `/db-engineer`
- UI components or pages → `/frontend-dev`
- Deployment → `/deploy`
- Performance optimization → `/perf-auditor`

## API ROUTE PATTERN

Every API route follows this exact structure:

```tsx
import { NextRequest } from "next/server"
import { authenticateRequest } from "@/lib/api/auth"
import { validate, required, maxLength } from "@/lib/api/validation"
import { apiSuccess, apiValidationError, apiUnauthorized, apiNotFound, apiInternalError } from "@/lib/api/response"
import { createAuditLog, emitEvent } from "@/lib/api/audit"
import { createServiceClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"

const log = logger.child({ route: "api/v1/resource" })

export async function GET(request: NextRequest) {
  // 1. AUTHENTICATE
  const auth = await authenticateRequest()
  if (!auth) return apiUnauthorized()

  // 2. QUERY (tenant-scoped)
  try {
    const supabase = await createServiceClient()
    const { data, error } = await supabase
      .from("table")
      .select("*")
      .eq("tenant_id", auth.tenantId)    // ALWAYS tenant-scope
      .is("deleted_at", null)            // Soft delete filter
      .order("created_at", { ascending: false })

    if (error) throw error

    return apiSuccess(data)
  } catch (err) {
    log.error({ err }, "Failed to fetch resources")
    return apiInternalError()
  }
}

export async function POST(request: NextRequest) {
  // 1. AUTHENTICATE
  const auth = await authenticateRequest()
  if (!auth) return apiUnauthorized()

  // 2. VALIDATE
  const body = await request.json()
  const { valid, errors } = validate(body, {
    name: [required("Name"), maxLength(255)],
  })
  if (!valid) return apiValidationError(errors)

  // 3. QUERY
  try {
    const supabase = await createServiceClient()
    const { data, error } = await supabase
      .from("table")
      .insert({ ...body, tenant_id: auth.tenantId })
      .select()
      .single()

    if (error) throw error

    // 4. AUDIT (fire-and-forget)
    Promise.all([
      createAuditLog({
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: "resource.created",
        entityType: "resource",
        entityId: data.id,
        changes: body,
        ipAddress: request.headers.get("x-forwarded-for") || "unknown",
        userAgent: request.headers.get("user-agent") || "unknown",
      }),
      emitEvent({
        tenantId: auth.tenantId,
        type: "resource.created",
        entityType: "resource",
        entityId: data.id,
        payload: data,
      }),
    ])

    // 5. RESPOND
    return apiSuccess(data, 201)
  } catch (err) {
    log.error({ err }, "Failed to create resource")
    return apiInternalError()
  }
}
```

## AVAILABLE UTILITIES

### Authentication (`@/lib/api/auth`)

| Function | Returns | Use When |
|----------|---------|----------|
| `authenticateRequest()` | `AuthContext \| null` | Session-based routes (dashboard API) |
| `requireAdmin(auth)` | `boolean` | Check owner/admin role |
| `requireLeadAccess(auth, lead)` | `boolean` | Check lead access (admin or assigned counselor) |
| `isCounselorOrAbove(auth)` | `boolean` | owner/admin/counselor check |
| `getClientIp(request)` | `string` | Get client IP for rate limiting/audit |

```tsx
interface AuthContext {
  userId: string
  email: string
  tenantId: string
  role: "owner" | "admin" | "viewer" | "counselor"
}
```

### Integration Auth (`@/lib/api/integration-auth`)

For external API (Bearer token) routes:
```tsx
import { authenticateIntegrationRequest } from "@/lib/api/integration-auth"
// Returns: { tenantId, integrationKeyId, permissions }
```

### Validation (`@/lib/api/validation`)

| Validator | Purpose |
|-----------|---------|
| `required(fieldName)` | Field must be present and non-empty |
| `isEmail()` | Valid email format |
| `isUUID()` | Valid UUID format |
| `isIn(allowed[])` | Value must be in allowed list |
| `maxLength(n)` | Max string length |
| `optionalMaxLength(n)` | Max length if present |
| `isPositiveInt()` | Positive integer |

```tsx
const { valid, errors } = validate(body, {
  email: [required("Email"), isEmail(), maxLength(255)],
  role: [required("Role"), isIn(["admin", "viewer", "counselor"])],
})
if (!valid) return apiValidationError(errors)
```

### Responses (`@/lib/api/response`)

| Function | Status | Use When |
|----------|--------|----------|
| `apiSuccess(data, status?)` | 200 | Successful response |
| `apiPaginated(data[], meta)` | 200 | Paginated list |
| `apiValidationError(details)` | 422 | Validation failed |
| `apiUnauthorized()` | 401 | No/invalid auth |
| `apiForbidden()` | 403 | Insufficient permissions |
| `apiNotFound(entity?)` | 404 | Resource not found |
| `apiConflict(message)` | 409 | Duplicate/conflict |
| `apiRateLimited(retryAfter)` | 429 | Rate limit hit |
| `apiInternalError()` | 500 | Server error |

### Audit (`@/lib/api/audit`)

Always fire-and-forget (non-blocking):
```tsx
Promise.all([
  createAuditLog({ tenantId, userId, action, entityType, entityId, changes, ipAddress, userAgent }),
  emitEvent({ tenantId, type, entityType, entityId, payload }),
])
```

### Rate Limiting (`@/lib/api/rate-limit`)

```tsx
import { checkRateLimit } from "@/lib/api/rate-limit"
const rateLimited = await checkRateLimit(key, { maxRequests: 10, windowMs: 3600000 })
if (rateLimited) return apiRateLimited(rateLimited.retryAfterSeconds)
```

## ROUTE FILE STRUCTURE

```
src/app/api/
├── auth/callback/route.ts           # Supabase OAuth callback
└── v1/
    ├── leads/route.ts               # GET (list) + POST (create)
    ├── leads/[id]/route.ts          # GET + PATCH + DELETE
    ├── leads/[id]/checklists/route.ts
    ├── upload/route.ts
    ├── team/route.ts
    ├── invites/route.ts
    ├── settings/api-keys/route.ts
    ├── settings/api-keys/[id]/route.ts
    └── integrations/crm/            # External API (Bearer auth)
        ├── leads/route.ts
        ├── leads/[id]/route.ts
        └── ...
```

## CONSTRAINTS

- **ALWAYS tenant-scope queries** — every `.from()` call must include `.eq("tenant_id", auth.tenantId)`
- **ALWAYS filter soft deletes** — add `.is("deleted_at", null)` on leads queries
- **Counselor scoping** — if `auth.role === "counselor"`, add `.eq("assigned_to", auth.userId)`
- **Use service client** — `createServiceClient()` for queries that need to bypass RLS
- **No `any` types** — use types from `@/types/database`
- **Audit all mutations** — every create/update/delete gets `createAuditLog` + `emitEvent`
- **Log errors** — use `logger.child({ route: "..." })` for structured logging
- **Follow existing patterns** — read 2-3 similar routes before writing new ones

## INTEGRATION API PATTERN

For routes under `/api/v1/integrations/crm/`:

```tsx
import { gateIntegrationRequest } from "@/lib/api/integration-helpers"
import { requirePermission } from "@/lib/api/integration-permissions"
import { withIntegrationErrorBoundary } from "@/lib/api/integration-helpers"

export const GET = withIntegrationErrorBoundary(async function GET(request: NextRequest) {
  const ctx = await gateIntegrationRequest(request)  // Auth + rate limit
  requirePermission(ctx.auth, "read")                 // Scope check

  // ... tenant-scoped query using ctx.auth.tenantId
})
```

## WORKFLOW

1. **Read existing routes** — Check 2-3 similar routes for patterns
2. **Determine auth type** — Session-based (dashboard) or Bearer token (integration)
3. **Define validation** — Use existing validators, add new ones to `validation.ts` if needed
4. **Write route** — Follow the 6-layer pattern exactly
5. **Add audit logging** — For all mutations
6. **Test build** — Run `npm run build` to verify

## EXAMPLE

**User:** "Add an endpoint to bulk-update lead statuses"

**Steps:**
1. Read `src/app/api/v1/leads/[id]/route.ts` for single-lead update pattern
2. Create `src/app/api/v1/leads/bulk/route.ts`
3. Implement with: auth → validate (array of {id, status}) → loop updates → audit each → respond
4. Verify tenant scoping on every lead
5. Run `npm run build`
