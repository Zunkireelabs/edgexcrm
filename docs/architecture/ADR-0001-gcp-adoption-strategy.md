# ADR-0001 — GCP Adoption Strategy

- **Status:** Approved (2026-07-02)
- **Scope:** EdgeX first; intended to generalize to the ZunkireeLabs golden path.
- **Deciders:** Sadin (product owner) + Architecture (CAO).

## Context

EdgeX (multi-tenant lead-gen CRM, Next.js 16 + Supabase) is entering a tenant-growth phase.
Current production runtime is a **single VPS** (`94.136.189.213`) running a **single app
container** behind Traefik, with prod and dev on the same box. CI/CD is mature
(build-in-CI → GHCR → SSH pull), but the runtime has four critical weaknesses:

1. Single point of failure (one box, one container).
2. Deploy-time downtime (`docker compose up -d` swaps the container in place).
3. ~35 authenticated routes bypass RLS (service-role + manual tenant filter).
4. No observability (no error tracking, metrics, tracing, or alerting).

The owner wants to introduce **GCP**, driven by: startup credits, enterprise credibility,
an AI-native data-platform ambition, and less hands-on ops. The question is not *whether* to
use GCP but *where* — and, critically, whether to migrate off Supabase.

A codebase coupling audit was performed to answer that. Key findings:

| Supabase feature | Coupling | Migration difficulty |
|---|---|---|
| Auth (sole IdP, OAuth, 18 `auth.admin.*` files, 305+ cookie-dependent clients) | HEAVY | Hard — full auth rebuild |
| Connection model (PostgREST via Supabase JS client; no native `pg` driver; 400+ query sites) | HEAVY | Hard — full query rewrite |
| Realtime (3 live subscribers: inbox, pipeline, deals) | LIVE | Hard — pub/sub + client rewrite |
| Storage (2 buckets, 6 sites) | LIGHT | Easy — GCS drop-in |
| RLS (enabled but mostly bypassed; `scopedClient` enforces in app layer) | MEDIUM | App-layer already carries isolation |
| Edge Fn / pgvector / pg_cron | NONE | — |

## Decision

**Adopt GCP for the compute tier and the AI/data platform. Keep Supabase as the database,
auth, realtime, and storage backbone. Put a CDN at the edge.**

- **Compute → Google Cloud Run** running the existing container image unchanged. Provides
  multi-instance (no SPOF), zero-downtime rolling deploys, request-based autoscaling, managed
  TLS. Lock-in ≈ zero (portable OCI container).
- **AI/data → GCP (phased)** — BigQuery (tenant analytics/warehouse), Cloud Storage where
  cheaper, and **Claude via Vertex AI** (keep Anthropic models, gain GCP enterprise
  compliance/billing/data-residency).
- **Data/Auth/Realtime/Storage → stay on Supabase.** The audit shows migrating these is a
  multi-month, high-risk rewrite for ~zero user-facing benefit. Supabase *is* managed
  Postgres; enterprise buyers accept it.
- **Edge → Cloudflare** (recommended) or GCP Cloud CDN + LB in front of Cloud Run.

## Alternatives considered

1. **Stay fully self-hosted (VPS replicas + Traefik).** Lowest cost, but you hand-build
   rolling deploys, replica orchestration, and monitoring. Cloud Run does this managed for
   near-zero lock-in. **Rejected** in favor of Cloud Run.
2. **Full lift to GCP (Cloud Run + Cloud SQL/AlloyDB, drop Supabase).** Rejected — the
   coupling audit shows Auth + Realtime + PostgREST are heavily wired in; ~400 query sites and
   the entire identity system would need rewriting for no user benefit.
3. **Kubernetes (GKE).** Rejected — massive ops overhead for a 1-to-few-instance workload.
   Over-engineering. Cloud Run is the managed-scale answer at this stage.
4. **Vercel for the app tier.** Rejected for now — cost scales fast, and its serverless model
   creates connection-pooling friction with Supabase vs the current long-lived server. Revisit
   at ~100k users.

## Consequences

- Reliability and scale improve immediately (SPOF removed, zero-downtime deploys, autoscale).
- Enterprise posture improves ("runs on Google Cloud", Secret Manager, Cloud audit logs).
- The AI-native vision gets a first-class home (BigQuery + Vertex/Claude) without leaving GCP.
- **Speed is a separate workstream** — Cloud Run does not make a slow query fast; the
  query-layer/pagination fix (Track A) is what users feel. The two run in parallel.
- Deploy pipeline changes from SSH-to-VPS to Cloud Run deploy; the VPS is kept warm as
  rollback until Cloud Run is proven.
- Tenant isolation must be re-verified under a real user session after the infra change, since
  the audit confirmed isolation is app-enforced, not RLS-enforced, on most routes.

## Trade-offs accepted

- Two clouds (Supabase + GCP) instead of one — accepted, because consolidating would mean the
  rejected full-rewrite. Net lock-in stays low (portable container + standard Postgres).
- Cloudflare adds a third vendor at the edge — accepted for simplicity/cost over all-in-GCP CDN.

## Scale target (guardrail)

Architect for **10k–50k users / low-hundreds concurrent / millions of rows**, with a
documented no-rewrite path to 100k. Explicitly **not** architecting for 1M+ concurrent.

## Ratified operating parameters (2026-07-02)

1. **Image registry: keep GHCR** for now (Cloud Run pulls the existing image); migrate to GCP
   Artifact Registry later if IAM integration warrants it.
2. **Edge: Cloudflare** in front of Cloud Run.
3. **Cloud Run region: `asia-south1`** (co-located with Supabase `ap-south-1` for low app↔DB latency).
