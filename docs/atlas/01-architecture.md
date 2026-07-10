# Architecture

How EdgeX is put together: one Next.js app split into route groups, a thin auth-refresh middleware, Supabase as the whole backend, an industry-module registry that gates features, cron workers hitting internal endpoints, and a Docker/Traefik deploy.

```mermaid
flowchart TB
    subgraph clients["Clients"]
        browser["Dashboard user<br/>(browser)"]
        embed["Embedded public form<br/>(3rd-party site)"]
        agent["AI agent / integration<br/>(API key)"]
    end

    subgraph edge["Edge"]
        mw["Auth middleware<br/>src/middleware.ts → lib/supabase/middleware.ts<br/>refresh session; bypass /form /consent /proposals/share"]
    end

    subgraph app["Next.js 16 App Router — src/app"]
        direction TB
        gmain["(main) — authenticated app<br/>(auth)/login · (dashboard)/* pages · api/v1/*"]
        gwidget["(widget) — public, no auth<br/>form/[slug] · consent/[token] · proposals/share/[token]"]
        gapi["api/ — public + machine<br/>api/public/* · api/webhooks/* · api/internal/*"]
    end

    subgraph domain["Domain & infra libs — src/lib"]
        apilib["api/ — auth, permissions, entitlements,<br/>validation, response, audit, rate-limit"]
        featlib["leads · deals · projects · hr · email ·<br/>inbox · ai · knowledge-base · webhooks"]
        sb["supabase/ — client · server · scoped · queries"]
    end

    subgraph industries["Industry modules — src/industries"]
        registry["_registry.ts (IDs) + _loader.ts (getFeatureAccess)"]
        manifests["8 manifest.ts (education, it-agency built out;<br/>6 placeholder) → features[] + sidebar[]"]
    end

    subgraph supabase["Supabase (Postgres + Auth + Storage)"]
        pg[("Postgres<br/>RLS by tenant_id<br/>130 migrations")]
        sbauth["Supabase Auth<br/>(sessions, OAuth)"]
        storage["Storage<br/>(files, PDFs)"]
    end

    subgraph external["External services"]
        gmail["Gmail API<br/>(inbox sync)"]
        email["Resend / Nodemailer<br/>(outbound email)"]
        meta["Meta Lead Ads<br/>(webhook)"]
    end

    subgraph crons["Cron workers (GitHub Actions → api/internal/*)"]
        cron["email/poll (5 min) ·<br/>inbox/process · reminders/run"]
    end

    subgraph deploy["Deploy"]
        traefik["Traefik (TLS)"]
        docker["Docker standalone<br/>node:22-alpine · GHCR image"]
    end

    browser --> mw --> gmain
    embed --> gwidget
    embed --> gapi
    agent --> gapi
    meta --> gapi

    gmain --> apilib
    gwidget --> featlib
    gapi --> apilib
    apilib --> sb
    featlib --> sb
    gmain -.feature gate.-> registry
    gapi -.feature gate.-> registry
    registry --> manifests

    sb --> pg
    mw --> sbauth
    apilib --> sbauth
    featlib --> gmail
    featlib --> email
    cron --> gapi

    traefik --> docker --> app
```

## Anchors
- Route groups: `src/app/(main)/`, `src/app/(widget)/`, `src/app/api/`
- Middleware: `src/middleware.ts`, `src/lib/supabase/middleware.ts`
- Industry gate: `src/industries/_registry.ts`, `src/industries/_loader.ts`, `src/industries/*/manifest.ts`
- Supabase clients: `src/lib/supabase/{client,server,scoped,queries}.ts`
- Cron targets: `src/app/api/internal/{email/poll,inbox/process,reminders/run}`; workflows in `.github/workflows/*.yml`
- Deploy: `Dockerfile`, `docker-compose.prod.yml`, `docs/dev-collab/DEV-WORKFLOW-AND-DEPLOYMENT.md`
