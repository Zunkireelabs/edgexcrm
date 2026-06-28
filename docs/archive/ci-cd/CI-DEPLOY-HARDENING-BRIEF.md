# BRIEF — Harden the staging deploy (kill the 30-min timeout) — for Sonnet (/ci-cd)

**Owner:** Sonnet executor (`/ci-cd`). **Review-gated** — build on a branch, but the only real test is a live deploy run, so this one DOES need to merge to `stage` to verify. Get Opus's GO before merging. **Do NOT touch the prod deploy workflow** (`deploy.yml`) in this PR — staging only (prod has the `docker-compose.prod.yml` landmine; separate follow-up).
**Branch:** `feature/ci-deploy-hardening` off `stage`.

## Problem (measured)
Staging deploys hit the **30-min SSH `command_timeout`** and die mid-build. On the shared VPS (chronic load 20–30 on 6 cores) the `next build` step alone took **~21 min** (`#13 DONE 1264.9s`), and the pipeline makes it worse:
- `.github/workflows/deploy-staging.yml` runs **`rm -rf .next`** then **`docker compose build --no-cache`** — discards Next's incremental-compile cache AND Docker layer cache every deploy, forcing a cold 21-min build every time.
- `command_timeout: 30m` is too tight for that.
- The separate **"Verify Health"** step curls `/login` once with **no retry**, so a still-warming container false-fails a successful deploy.

Result: deploys show red and the new image often isn't even swapped (build killed before `docker compose up`). Nothing has reached dev-lead-crm since the box got loaded.

## Root cause / the real lever
Layer caching alone won't fix it: source changes every deploy, so `next build` always re-runs. The win is **persisting Next's incremental build cache (`.next/cache`) across builds** via a BuildKit cache mount — that reuses compiled modules and can cut the 21-min build to ~2–4 min.

## Changes

### 1. `Dockerfile` — BuildKit cache mounts on the slow steps
The Dockerfile is already well-layered (deps at line 7, source COPY at line 8, build at line 19). Add cache mounts (requires BuildKit, which Docker Compose v2 uses by default):
- `npm ci` (line 7) → `RUN --mount=type=cache,target=/root/.npm npm ci`
- `npm run build` (line 19) → `RUN --mount=type=cache,target=/app/.next/cache npm run build`

> Verify the syntax against the existing Dockerfile and that `# syntax=docker/dockerfile:1` (or BuildKit default) is honored. The `.next/cache` mount is the high-impact one — it's where Next's SWC/webpack incremental cache lives.

### 2. `.github/workflows/deploy-staging.yml` — stop fighting the cache, widen the windows
In the `Deploy via SSH` step:
- **Remove `rm -rf .next`** (it nukes the incremental cache; the build's `.next` is internal to the image anyway).
- **Change `docker compose build --no-cache` → `docker compose build`** (let layer + cache-mount caching work). Confirm BuildKit is on for the compose build (`DOCKER_BUILDKIT=1`/`COMPOSE_DOCKER_CLI_BUILD=1` if needed on the VPS).
- **Bump `command_timeout: 30m` → `45m`** (margin for a cold first build before the cache warms).
- Widen the in-script health poll from 12→**18** attempts (≈3 min) before it gives up.

Replace the separate **`Verify Health`** step with a retry loop so a warming container doesn't false-fail:
```yaml
      - name: Verify Health
        run: |
          for i in $(seq 1 10); do
            CODE=$(curl -s -o /dev/null -w "%{http_code}" https://dev-lead-crm.zunkireelabs.com/login || echo 000)
            if [ "$CODE" = "200" ]; then echo "Health OK (HTTP $CODE) on attempt $i"; exit 0; fi
            echo "Attempt $i/10: HTTP $CODE — waiting 15s..."; sleep 15
          done
          echo "Health check failed after retries"; exit 1
```

## Safety note
Dropping `--no-cache` is safe here because the Dockerfile invalidates the source layer on every `COPY . .` (so code changes always rebuild). If a truly clean build is ever needed, run `docker compose build --no-cache` manually on the VPS — don't put it back in the pipeline.

## Verify (this MUST merge to stage to test — get Opus GO first)
- After merge, watch the `Deploy to Staging` run: the build step should now be **minutes, not ~21 min** (capture the timing), and the run should go **green** (Deploy via SSH + Verify Health both pass).
- Confirm the new image actually swapped: on the VPS, `docker inspect --format '{{.State.StartedAt}}' leads-crm-dev` is recent and `git -C /home/zunkireelabs/devprojects/lead-gen-crm-dev log -1` = the deployed commit.
- Confirm dev-lead-crm serves the **combined-route** code that's been stuck undeployed (the staging "Move to list" dialog shows the new "Assign to (optional)" picker).
- `npm run build` + `npx eslint --max-warnings 50` clean locally before pushing.

## Report
The diff (Dockerfile + workflow), the before/after deploy build timing, the deploy run result, and the VPS container-swap confirmation. Flag any deviation. Do NOT touch prod's `deploy.yml`.
