# Brief: Track B — Migrate App Tier to GCP Cloud Run (Scale + Reliability)

**Owner:** Executor / DevOps (with Sadin for GCP console + credentials)
**Reviewer:** Architecture (Opus)
**Origin:** ADR-0001. Ratified params: **image in Artifact Registry** (see flag below),
**Cloudflare** at edge, region **`asia-south1`** (next to Supabase `ap-south-1`).
**Goal:** kill the single-point-of-failure + deploy downtime; get autoscale + zero-downtime
rolling deploys — without touching Supabase.

---

## ⚠️ Accuracy flag on the "keep GHCR" decision

Cloud Run deploys images from **Google Artifact Registry / GCR**, not from private GHCR.
So "keep GHCR" means: **CI pushes the image to Artifact Registry too** (one extra push in the
existing `build-push` job). GHCR can stay for continuity; Artifact Registry is the source
Cloud Run pulls from. Confirm current Cloud Run registry support at implementation; if direct
GHCR pull is supported for your setup, skip the AR mirror — otherwise AR is the safe default.

---

## Key facts that make this low-risk

- The existing `Dockerfile` is **already Cloud Run-ready**: `output: "standalone"` (next.config.ts),
  non-root user, `EXPOSE 3000`, `PORT`/`HOSTNAME` env, `CMD ["node","server.js"]`. Likely **zero
  Dockerfile changes**.
- The app talks to Supabase over **HTTP (PostgREST + Auth), not a native Postgres pool**. So
  Cloud Run autoscaling will **not** exhaust Postgres connections — a major de-risker vs typical
  serverless+Postgres. (This is exactly why ADR-0001 keeps Supabase.)
- `NEXT_PUBLIC_*` vars are **build-time baked** (Dockerfile ARG/ENV, lines 11-17) — they already
  flow via CI build-args. Only **runtime** secrets (e.g. `SUPABASE_SERVICE_ROLE_KEY`, email/
  Resend creds) go into Secret Manager.

---

## Steps

### 1. GCP project + APIs
- Create/confirm a GCP project. Enable: Cloud Run, Artifact Registry, Secret Manager,
  (Cloud Build optional), IAM.
- Create an Artifact Registry Docker repo in `asia-south1`.

### 2. Secrets → Secret Manager
- Load runtime secrets from the current VPS `.env.local` (service role key, email/SMTP/Resend,
  any server-only keys). **Do NOT** put `NEXT_PUBLIC_*` here — those are build-time.
- Grant the Cloud Run runtime service account `secretmanager.secretAccessor`.

### 3. CI: add Artifact Registry push
- In `.github/workflows/deploy.yml` (and `deploy-staging.yml`) `build-push` job, add a push of
  the same image to `asia-south1-docker.pkg.dev/<project>/<repo>/edgexcrm:<tag>` alongside GHCR.
- Auth GitHub→GCP with **Workload Identity Federation** (no long-lived JSON key). Create the
  WIF pool + a deployer service account (`run.admin`, `iam.serviceAccountUser`, `artifactregistry.writer`).

### 4. Cloud Run services (staging first)
- Deploy a **staging** service from the AR image:
  `gcloud run deploy edgexcrm-staging --image <AR image> --region asia-south1 --allow-unauthenticated`
  - `--min-instances=1` (avoid cold starts for a dashboard app), `--max-instances` sized to load,
    `--concurrency=80` (default; tune later), `--cpu`/`--memory` to match the container
    (build uses `--max-old-space-size=4096`; give ≥1 vCPU / ≥1–2 GiB).
  - Wire runtime secrets via `--set-secrets`.
  - Startup/liveness probe → `GET /login` (matches the current compose healthcheck).
- Validate staging thoroughly (see Verification), **then** create the **prod** service the same way.

### 5. Deploy workflow retarget
- Replace the SSH `appleboy/ssh-action` step (deploy.yml:83-112) with `gcloud run deploy` to the
  respective service. Traffic shifts to the new revision only after it passes health — that's the
  zero-downtime win. Keep the post-deploy HTTP 200 check.
- Rollback becomes `gcloud run services update-traffic --to-revisions <prev>=100` (instant,
  revision-based) — retire/repoint `rollback.yml`.

### 6. Edge: Cloudflare + custom domain
- Map `edgex.zunkireelabs.com` / `dev-lead-crm.zunkireelabs.com` to Cloud Run (Cloud Run domain
  mapping, or Cloudflare proxied CNAME → `*.run.app`). Cloud Run supplies managed TLS; Cloudflare
  adds edge cache/DDoS/origin-hiding. Confirm the `/form/:slug*` cache headers (next.config.ts:13-24)
  survive at the edge.

### 7. Cutover + decommission
- Move DNS to Cloud Run (via Cloudflare) for **staging first**, bake, then prod.
- **Keep the VPS warm as instant rollback** until Cloud Run is proven for both envs.
- Separate prod and dev (they currently share one box) — Cloud Run gives this for free (two services).
- Only after stable: retire `docker-compose.prod.yml` from prod runtime (keep for local),
  decommission the VPS app containers. Update CLAUDE.md deploy/server sections.

---

## Observability (do in this track — "production" requires it)
- **Sentry** (errors) wired into the Next app (server + client).
- **Uptime check** (GCP Uptime or external) on `/login` for staging + prod, with alerting.
- Cloud Run request metrics + **log-based alerts** (5xx rate, latency, instance count).

---

## Explicitly NOT in scope
- No Supabase migration (DB/Auth/Realtime/Storage stay). No app query changes (that's Track A).
- No Kubernetes. No BigQuery/Vertex (Track C).

## Verification (must do all)
1. **Zero-downtime proof:** trigger a deploy while hitting the staging URL in a loop — **zero
   failed requests** across the revision switch (vs the current in-place-swap downtime window).
2. **Autoscale:** drive concurrent load; confirm instances scale up and back down; p95 latency stable.
3. **Secrets:** confirm the app reads runtime secrets from Secret Manager (no `.env.local` on the box).
4. **Tenant isolation regression (real session, not service-role):** log in as two different
   tenants post-cutover; confirm no cross-tenant data. Isolation is app-enforced (per the coupling
   audit), so re-verify after the infra move. See memory `verify_rls_paths_under_real_session`.
5. **Rollback drill:** deploy a bad revision, roll back via traffic split, confirm recovery < 1 min.
6. **Edge:** confirm Cloudflare fronts the app, TLS valid, `/form/*` cached, origin IP hidden.

## Review gate
Infra changes touch prod. Stage everything on the **staging** Cloud Run service + dev domain
first; Opus reviews before prod cutover. VPS stays as rollback until sign-off.
