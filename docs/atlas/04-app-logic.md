# App Logic

The cross-cutting rules every request obeys: the standard API route pattern, the two authentication systems, and the three-layer permission model.

## API route pattern

Almost every authenticated endpoint under `src/app/(main)/api/v1/` follows the same shape. The `scopedClient` auto-injects `.eq("tenant_id", ...)` so tenant data can't leak.

```mermaid
flowchart TB
    start(["Request → route.ts"]) --> log["createRequestLogger()<br/>requestId, method, path"]
    log --> auth{"authenticateRequest()<br/>session valid?"}
    auth -- no --> u401["apiUnauthorized() 401"]
    auth -- yes --> feat{"getFeatureAccess(industryId, FEATURE)<br/>industry allows feature?"}
    feat -- no --> f403["apiForbidden() 403"]
    feat -- yes --> role{"role / permission check<br/>e.g. requireAdmin()"}
    role -- no --> f403
    role -- yes --> valid{"validate() body / query"}
    valid -- invalid --> v400["apiValidationError() 400"]
    valid -- valid --> scoped["scopedClient(auth)<br/>tenant-scoped Supabase"]
    scoped --> work["do the work<br/>read/write via lib/&lt;domain&gt;"]
    work --> side["createAuditLog + emitEvent<br/>(fire-and-forget)"]
    side --> ok["apiSuccess() / apiPaginated()"]
```

## Two authentication systems

EdgeX authenticates humans and machines differently, but both resolve to a tenant-scoped context.

```mermaid
flowchart LR
    subgraph session["Session auth — dashboard users"]
        s1["Supabase session cookie"] --> s2["authenticateRequest()<br/>lib/api/auth.ts"]
        s2 --> s3["join tenant_users → tenants, positions"]
        s3 --> s4["AuthContext<br/>userId, tenantId, role, industryId,<br/>branchId, permissions, plan, entitlements"]
    end
    subgraph apikey["API-key auth — integrations"]
        k1["Bearer crm_live_… token"] --> k2["authenticateIntegrationRequest()<br/>lib/api/integration-auth.ts"]
        k2 --> k3["SHA-256 match vs integration_keys.hashed_key"]
        k3 --> k4["IntegrationContext<br/>tenantId, scopes, allowedOrigins, formId"]
    end
    s4 --> data[("Tenant-scoped data<br/>(RLS + scopedClient)")]
    k4 --> data
```

## Three-layer permission model

Access is resolved from base role, then narrowed by position/RBAC permissions, then by branch scope. Owners/admins always get full access; a counselor is auto-scoped to their own leads.

```mermaid
flowchart TB
    role["Layer 1 — base role<br/>owner | admin | viewer | counselor<br/>(tenant_users.role)"]
    pos["Layer 2 — position / RBAC<br/>positions.permissions JSONB<br/>resolvePermissions() → ResolvedPermissions"]
    branch["Layer 3 — branch scope<br/>leadScope: all | own | team<br/>branchId + branchMemberIds"]

    role --> pos --> branch --> result

    result{"Effective access<br/>requireLeadAccess() / requireLeadBranchAccess()"}
    result -- "owner/admin" --> all["all leads"]
    result -- "leadScope=own<br/>(counselor)" --> own["only assigned_to == self"]
    result -- "leadScope=team" --> team["own branch:<br/>lead_branches roster or branch_id match"]

    rls[("DB safety net: RLS<br/>get_user_tenant_ids() (SELECT)<br/>is_tenant_admin() (mutations)")]
    all -.enforced under.-> rls
    own -.enforced under.-> rls
    team -.enforced under.-> rls
```

## Anchors
- Route pattern: `src/app/(main)/api/v1/leads/route.ts` (canonical), `CLAUDE.md` §API Route Pattern
- Shared API lib: `src/lib/api/{auth,permissions,entitlements,response,validation,rate-limit,audit,integration-auth}.ts`
- Tenant scoping: `src/lib/supabase/{scoped,server,middleware}.ts`
- RLS functions: `supabase/migrations/` (`get_user_tenant_ids`, `is_tenant_admin`); `CLAUDE.md` §Database / RLS Architecture
