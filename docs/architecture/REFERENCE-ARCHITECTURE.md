# ZunkireeLabs Reference Architecture (Golden Path)

**Status:** v1 — derived from EdgeX (2026-07-02). This is the canonical stack + patterns every
new ZunkireeLabs product should inherit. Deviations require an ADR.

> Purpose: stop re-deciding the foundation on every product. Start here on day 1.

---

## 1. Canonical stack

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend + backend | **Next.js (App Router) + React + TypeScript** as a modular monolith | One deployable, clear domain boundaries, no premature microservices |
| UI | Tailwind + shadcn/ui | Consistent, fast to build |
| Data / Auth / Realtime / Storage | **Supabase** (managed Postgres) | Managed Postgres with batteries; portable data; low ops |
| Compute | **GCP Cloud Run** (container) | Managed autoscale + zero-downtime deploys, near-zero lock-in |
| Edge | **Cloudflare** (or GCP Cloud CDN) | Edge cache, TLS, DDoS, origin hiding |
| AI | **Claude via Vertex AI** (or Anthropic API) | Best models + GCP enterprise compliance |
| Analytics / warehouse | **BigQuery** (when needed) | Serverless analytics at scale |
| Jobs / cron | **Cloud Scheduler → Cloud Run Jobs** | Reliable scheduling (not GH-Actions cron) |
| Secrets | **GCP Secret Manager** | No box-local `.env` drift |
| Observability | **Sentry + uptime monitor + Cloud Run metrics/logs** | Never operate blind |
| CI/CD | **GitHub Actions → build image → deploy to Cloud Run** | Artifact-based, reproducible |

**Do NOT** introduce Kubernetes, microservices, or a bespoke auth system without an ADR
justifying it. Those are the default over-engineering traps.

---

## 2. Runtime topology

```
                 ┌───────────────┐
   Users ───────▶│  Cloudflare   │  edge cache · TLS · DDoS · origin hide
                 └──────┬────────┘
                        │
                 ┌──────▼────────────────┐
                 │  GCP Cloud Run        │  N instances · autoscale · zero-downtime deploy
                 │  (app container)      │  ← image built by CI (GHCR / Artifact Registry)
                 └──────┬────────────────┘
                        │  Supabase JS client / PostgREST + Auth + Realtime
                 ┌──────▼────────────────┐     ┌──────────────────────────┐
                 │  Supabase (managed)   │     │  GCP AI/Data (phased)     │
                 │  Postgres · Auth ·    │     │  BigQuery · Vertex(Claude)│
                 │  Realtime · Storage   │     │  Cloud Storage            │
                 └───────────────────────┘     └──────────────────────────┘
   Cross-cutting: Sentry (errors) · Uptime · Cloud Run metrics/logs
   Jobs: Cloud Scheduler → Cloud Run Job (replaces GH-Actions cron + VPS crontab)
```

---

## 3. Mandatory patterns (the non-negotiables)

### 3.1 Multi-tenant isolation
- Every tenant table: `tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE` + RLS policies
  using SECURITY DEFINER helpers (`get_user_tenant_ids()`, `is_tenant_admin()`).
- **Every authenticated route** authenticates first, then queries via the tenant-scoped
  wrapper (`scopedClient(auth)` in EdgeX) that auto-injects the tenant filter.
- Raw service-role clients are a legacy exception, not a pattern. New code uses the scoped
  wrapper. Isolation is verified under a **real user session**, never only via service-role.

### 3.2 Data-access & pagination standard
- **No endpoint loads an unbounded dataset into one render.** All list queries are
  server-side paginated (limit/offset or keyset). This is the primary single-user speed lever.
- Avoid oversized `.in("id", [...])` filters (they can overflow the HTTP header limit). Chunk
  or inline-filter instead.

### 3.3 Modular monolith / feature scoping
- Industry/feature-specific code lives in its own module folder; universal code stays shared.
  Parallel teams don't collide on shared files. (See EdgeX `src/industries/`.)

### 3.4 Deploy standard
- Build the image in CI; deploy the **artifact** to Cloud Run. No building on the runtime host.
- Config/secrets from Secret Manager, not host-local files.
- Dev/staging and prod are **separate** environments (separate hosts/services and DBs).

### 3.5 Observability baseline (required before "production")
- Error tracking (Sentry), uptime monitoring + alerting, request metrics + log-based alerts.

---

## 4. Scale posture

| Scale | Design stance |
|-------|---------------|
| ~1k–10k users | Monolith + managed Postgres. No distributed complexity. |
| ~10k–50k (target) | Cloud Run autoscale + pagination + CDN + observability. |
| ~100k | Add read replicas / heavier pooling, Redis cache, real job queue. Evolution, not rewrite. |
| 1M+ | Only then: partitioning, multi-region, cell-based tenancy. Do not build for this early. |

Rule of thumb: **build for 10×, plan for 100×, don't build for 1000×.**

---

## 5. New-project day-1 checklist (Golden Path SOP)

- [ ] Next.js modular-monolith scaffold (this reference stack).
- [ ] Supabase project (Postgres + Auth + Storage); RLS helpers + `tenant_id` on every table.
- [ ] Tenant-scoped DB wrapper mandatory for authenticated routes.
- [ ] Pagination standard applied to every list endpoint from the start.
- [ ] Dockerfile → Cloud Run (standalone output, non-root, `PORT`/`HOSTNAME`).
- [ ] CI: lint + typecheck + build image + deploy to Cloud Run; separate dev/prod.
- [ ] Secret Manager for config; no host-local `.env`.
- [ ] Sentry + uptime + metrics wired before first customer.
- [ ] Cloudflare in front.
- [ ] ADR-0001 inherited; new deviations get their own ADR.
