# User Flows

Three representative end-to-end flows, traced through the real code (UI → route → service → data).

## A. Auth / login

Email+password or OAuth via Supabase. The middleware refreshes the session on every request; the dashboard layout re-checks the user and resolves the tenant + permissions before rendering.

```mermaid
sequenceDiagram
    actor User
    participant Login as login/page.tsx
    participant SB as Supabase Auth
    participant MW as middleware.ts
    participant Layout as (dashboard)/layout.tsx
    participant Auth as lib/api/auth.ts
    participant DB as Postgres (tenant_users)

    User->>Login: enter email + password
    Login->>SB: signInWithPassword() (or signInWithOAuth)
    SB-->>Login: session cookie set
    Login->>Layout: redirect to /home
    Note over MW: runs on every request
    MW->>SB: updateSession() — refresh tokens
    Layout->>SB: auth.getUser()
    SB-->>Layout: user (or null → redirect /login)
    Layout->>Auth: authenticateRequest()
    Auth->>DB: join tenant_users → tenants, positions
    DB-->>Auth: role, industry_id, position, branch
    Auth-->>Layout: AuthContext (+ resolved permissions)
    Layout-->>User: render dashboard shell
```

## B. Public lead capture (embedded form → lead)

A form embedded on a 3rd-party site POSTs to the public submit endpoint. The endpoint authenticates by API key, rate-limits, enforces per-key origin/permission, resolves the pipeline + entry stage, **dedups by email/phone**, then either updates the canonical lead or inserts a new one — firing audit, events, notifications, and autoresponder as non-blocking side effects.

```mermaid
sequenceDiagram
    participant Form as (widget)/form/[slug]<br/>public-form.tsx
    participant API as api/public/submit/[tenant]/[form]/route.ts
    participant IAuth as integration-auth.ts
    participant Dedup as lib/leads/dedup.ts
    participant Pipe as pipeline-resolution.ts
    participant DB as Postgres (service client)
    participant Side as audit · events · email · notify

    Form->>API: POST submission (API key)
    API->>IAuth: authenticateIntegrationRequest()
    IAuth-->>API: context (tenant, scopes, origins)
    API->>API: rate-limit + origin + write-permission checks
    API->>DB: lookup tenant + form_config by slug
    API->>Pipe: resolveLeadPipelineAndStage()
    Pipe-->>API: pipelineId + entry stageId
    API->>Dedup: resolveLeadIdentity(email, phone)
    alt email matches existing lead
        Dedup-->>API: canonical lead
        API->>DB: recordSubmission + applyCanonicalUpdate
        API-->>Form: 200 { lead_id, deduped: true }
    else brand-new lead
        API->>DB: insert lead (pipeline, stage, branch, list)
        API->>DB: recordSubmission + recordDuplicateSuggestions
        API-->>Form: 201 { lead_id }
    end
    API-)Side: emitEvent · createAuditLog · notify admins ·<br/>email-forward rules · autoresponder (fire-and-forget)
```

## C. Deal → Proposal → Project handoff (IT-agency)

Converting a won deal seeds a project from the deal's latest **accepted** proposal (brief, baseline hours→minutes, budget), binds the proposal to the new project, copies deal contacts, and logs a project event. Guards against double-conversion (409). Never blocks: a deal with no accepted proposal converts with a blank baseline.

```mermaid
sequenceDiagram
    actor Admin
    participant Deals as deals/[id]/page.tsx
    participant API as deals/[id]/convert-to-project/route.ts
    participant Auth as authenticateRequest + requireAdmin
    participant DB as Postgres (scoped client)
    participant Events as lib/projects/events.ts

    Admin->>Deals: click "Convert to project"
    Deals->>API: POST convert-to-project
    API->>Auth: auth + feature gate (DEALS, ACCOUNTS) + admin
    Auth-->>API: ok
    API->>DB: load deal; check existing project by deal_id
    alt already converted
        DB-->>API: existing project
        API-->>Deals: 409 ALREADY_CONVERTED { project_id }
    else convert
        API->>DB: findProposalSeed() — latest accepted proposal + line items
        DB-->>API: brief, baseline minutes, budget, rate
        API->>DB: insert project (seeded baseline, deal_id)
        API->>DB: bind proposal.project_id; copy deal_contacts → project_contacts
        API->>Events: recordProjectEvent(baseline_seeded_from_proposal)
        API-)DB: createAuditLog + emitEvent(project.created)
        API-->>Deals: 201 { project }
    end
```

## Anchors
- Login: `src/app/(main)/(auth)/login/page.tsx`, `src/lib/supabase/middleware.ts`, `src/app/(main)/(dashboard)/layout.tsx`, `src/lib/api/auth.ts`
- Lead capture: `src/app/api/public/submit/[tenantSlug]/[formSlug]/route.ts`, `src/lib/leads/{dedup,pipeline-resolution,branch-membership}.ts`, `src/lib/api/integration-auth.ts`
- Deal→Project: `src/app/(main)/api/v1/deals/[id]/convert-to-project/route.ts`, `src/lib/projects/events.ts`
