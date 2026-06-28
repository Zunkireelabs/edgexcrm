# BRIEF — Build images in CI → push to GHCR → VPS only pulls (STAGE)

**Owner session:** Sonnet (executor). **Reviewer:** Opus (do NOT self-merge, do NOT push to stage, do NOT apply anything to the VPS — STOP at the review gate and produce a report).
**Skill:** `/ci-cd`.
**Branch:** create `feature/ci-ghcr-build-offload` off `stage`.
**Scope:** STAGE deploy pipeline ONLY. Do **not** touch `deploy.yml` (prod), `docker-compose.prod.yml`, or `rollback.yml` — those are Phase 2 behind a separate prod GO.

---

## Why

The staging VPS melts because every push to `stage` runs a Next/Docker build **on the box** (`deploy-staging.yml` → SSH → `docker compose build`). On the shared, RAM-tight VPS that build hits load 100+ and times out, orphaning headless build procs that pile up (this caused the 2026-06-24 incident).

We already build the app once in CI as a throwaway validation step, then build it *again* on the VPS. The fix: **build the Docker image once in GitHub Actions, push it to GHCR, and have the VPS only `docker compose pull && up -d`.** No build on the box, ever.

---

## Key constraints (read before coding)

1. **`NEXT_PUBLIC_*` are baked at build time** (see `Dockerfile` lines 11–20). Stage and prod point at different Supabase DBs, so **images are environment-specific and NOT interchangeable**. The stage image bakes the stage DB. (Prod, in Phase 2, builds its own image with prod build-args. No same-image promotion.)
2. **The GHCR package stays PRIVATE** — the image contains all server code. The VPS must authenticate to pull (read:packages PAT). CI's push side uses the built-in `GITHUB_TOKEN` (no PAT needed for push).
3. **Repo / image namespace:** remote is `https://github.com/Zunkireelabs/edgexcrm.git`. GHCR refs must be lowercase: **`ghcr.io/zunkireelabs/edgexcrm`**.
4. **The `NEXT_PUBLIC_*` anon key + URL are already committed in `docker-compose.yml`** (they're public values), so passing them as CI build-args is not a secret leak.
5. **Tag images two ways:** `:stage` (moving — what compose tracks) **and** `:stage-<sha>` (immutable — for future SHA-pinned rollback).

---

## Tasks

### 1. Rewrite `.github/workflows/deploy-staging.yml`

Replace the current 3-phase (checks-with-build → SSH-build → verify) flow with: **lint+typecheck → build-and-push-to-GHCR → SSH pull+up → verify**.

```yaml
name: Deploy to Staging

on:
  push:
    branches: [stage]

concurrency:
  group: deploy-staging
  cancel-in-progress: false

env:
  IMAGE: ghcr.io/zunkireelabs/edgexcrm

jobs:
  checks:
    name: Lint & Typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx eslint --max-warnings 50
      - run: npx tsc --noEmit

  build-push:
    name: Build & Push Image
    runs-on: ubuntu-latest
    needs: checks
    environment: staging
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ${{ env.IMAGE }}:stage
            ${{ env.IMAGE }}:stage-${{ github.sha }}
          build-args: |
            NEXT_PUBLIC_SUPABASE_URL=${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
            NEXT_PUBLIC_SUPABASE_ANON_KEY=${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
            NEXT_PUBLIC_APP_URL=${{ secrets.NEXT_PUBLIC_APP_URL }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    name: Deploy to Staging
    runs-on: ubuntu-latest
    needs: build-push
    environment: staging
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        env:
          GHCR_USER: ${{ secrets.GHCR_PULL_USER }}
          GHCR_TOKEN: ${{ secrets.GHCR_PULL_TOKEN }}
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USERNAME }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          command_timeout: 10m
          envs: GHCR_USER,GHCR_TOKEN
          script: |
            set -e
            cd /home/zunkireelabs/devprojects/lead-gen-crm-dev
            git pull origin stage
            echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
            docker compose pull
            docker compose up -d
            docker image prune -f
            echo "Waiting for container to be healthy..."
            sleep 10
            for i in $(seq 1 18); do
              STATUS=$(docker inspect --format='{{.State.Health.Status}}' leads-crm-dev 2>/dev/null || echo "unknown")
              if [ "$STATUS" = "healthy" ]; then echo "Container is healthy!"; exit 0; fi
              echo "Attempt $i/18: Status is $STATUS, waiting..."
              sleep 10
            done
            echo "Container did not become healthy within 3 minutes"
            docker logs leads-crm-dev --tail 50
            exit 1

      - name: Verify Health
        run: |
          for i in $(seq 1 10); do
            CODE=$(curl -s -o /dev/null -w "%{http_code}" https://dev-lead-crm.zunkireelabs.com/login || echo 000)
            if [ "$CODE" = "200" ]; then echo "Health OK (HTTP $CODE) on attempt $i"; exit 0; fi
            echo "Attempt $i/10: HTTP $CODE — waiting 15s..."; sleep 15
          done
          echo "Health check failed after retries"; exit 1
```

Notes:
- The throwaway `npm run build` validation step is **intentionally dropped** — the `build-push` job builds the app inside Docker (which runs `npm run build`), so a broken build still fails the pipeline. No validation coverage lost; we just stop building twice.
- `command_timeout` drops from `45m` → `10m` because there is no build on the box anymore (pull + up + healthcheck only). If 10m ever isn't enough, the box is unhealthy, not slow-building.
- `docker image prune -f` keeps the tight VPS disk from filling with old image layers.

### 2. Rewrite `docker-compose.yml` (stage) to be image-based

Remove the entire `build:` block and replace with an `image:` ref. **Everything else (container_name, env_file, networks, labels, healthcheck) stays byte-for-byte identical.**

```yaml
services:
  app:
    image: ghcr.io/zunkireelabs/edgexcrm:stage
    container_name: leads-crm-dev
    restart: unless-stopped
    env_file:
      - .env.local
    networks:
      - hosting
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=hosting"

      # HTTPS
      - "traefik.http.routers.leads-crm-dev-secure.entrypoints=websecure"
      - "traefik.http.routers.leads-crm-dev-secure.rule=Host(`dev-lead-crm.zunkireelabs.com`)"
      - "traefik.http.routers.leads-crm-dev-secure.tls=true"
      - "traefik.http.routers.leads-crm-dev-secure.tls.certresolver=letsencrypt"

      # HTTP redirect
      - "traefik.http.routers.leads-crm-dev.entrypoints=web"
      - "traefik.http.routers.leads-crm-dev.rule=Host(`dev-lead-crm.zunkireelabs.com`)"
      - "traefik.http.middlewares.leads-crm-dev-redirect.redirectscheme.scheme=https"
      - "traefik.http.routers.leads-crm-dev.middlewares=leads-crm-dev-redirect"

      # Service
      - "traefik.http.services.leads-crm-dev.loadbalancer.server.port=3000"

    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://127.0.0.1:3000/login"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

networks:
  hosting:
    external: true
```

> The previously-hardcoded build-args (`NEXT_PUBLIC_SUPABASE_URL=https://dymeudcddasqpomfpjvt.supabase.co`, the dev anon key, `NEXT_PUBLIC_APP_URL=https://dev-lead-crm.zunkireelabs.com`) now live in the **staging GitHub environment secrets** consumed by the `build-push` job. See task 4 — these MUST match or the stage image will bake the wrong DB (split-brain).

### 3. Leave Dockerfile unchanged

The multi-stage Dockerfile already takes the three `NEXT_PUBLIC_*` build-args and emits a standalone server. No changes needed. (Confirm it still `docker build`s locally — see verification.)

### 4. Document the required GitHub secrets (do NOT create them — list for Sadin)

In the brief report, list exactly what must exist before the first deploy. New secrets:
- **`GHCR_PULL_USER`** — a GitHub username (org member) that owns the pull PAT.
- **`GHCR_PULL_TOKEN`** — a **classic PAT with `read:packages`** scope (repo or org secret). Used by the VPS to `docker login ghcr.io`.

Existing secrets that must be present **in the `staging` environment** (the `build-push` job uses `environment: staging`) and must equal the values currently hardcoded in `docker-compose.yml`:
- `NEXT_PUBLIC_SUPABASE_URL` = `https://dymeudcddasqpomfpjvt.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = (the dev anon key currently in `docker-compose.yml`)
- `NEXT_PUBLIC_APP_URL` = `https://dev-lead-crm.zunkireelabs.com`
- `SSH_HOST`, `SSH_USERNAME`, `SSH_PRIVATE_KEY` — unchanged, already in use.

**Flag clearly in your report if you cannot confirm these staging-env secret values** — Opus/Sadin will verify them. A mismatch silently bakes the wrong Supabase DB into the stage image.

---

## Verification (Sonnet does locally, then STOPS)

1. `npx eslint --max-warnings 50` — clean.
2. `npx tsc --noEmit` — clean.
3. **YAML sanity:** the two workflow files parse (e.g. `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy-staging.yml'))"`).
4. **Dockerfile still builds locally** with the stage build-args (proves the image build path works before CI runs it):
   ```bash
   docker build \
     --build-arg NEXT_PUBLIC_SUPABASE_URL=https://dymeudcddasqpomfpjvt.supabase.co \
     --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<dev anon key from docker-compose.yml> \
     --build-arg NEXT_PUBLIC_APP_URL=https://dev-lead-crm.zunkireelabs.com \
     -t edgexcrm:localtest .
   ```
   (If local Docker is unavailable, say so — do not skip silently.)
5. Confirm `docker-compose.yml` has **no `build:` key** and the `image:` ref is lowercase `ghcr.io/zunkireelabs/edgexcrm:stage`.

## STOP — review gate

Do **not** push to `stage`, do **not** open the PR to merge, do **not** run any deploy, do **not** SSH the VPS. Commit to `feature/ci-ghcr-build-offload`, then produce a report covering:
- The diff of both files.
- Which verification steps passed (with output) and which you couldn't run (and why).
- The exact list of GitHub secrets that must exist (task 4), flagging any you couldn't confirm.
- Anything you changed beyond this brief's scope (there should be nothing).

Opus will review the diff independently, verify secrets, and drive the stage merge + watch the first GHCR deploy.

---

## Phase 2 (separate brief, after stage GHCR is proven — do NOT do now)

- Mirror into `deploy.yml` (prod): tag `:prod` + `:prod-<sha>`, build-args from `production` environment secrets (prod Supabase DB).
- Convert `docker-compose.prod.yml` to image-based (`ghcr.io/zunkireelabs/edgexcrm:prod`).
- Rewrite `rollback.yml` to `docker pull` a SHA-pinned tag (`:prod-<sha>`) + `up -d` instead of building on the box.
- All gated behind explicit prod GO + the prod-compose landmine procedure.
