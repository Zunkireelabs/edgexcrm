# INCIDENT HANDOFF — staging VPS overloaded, dev container unhealthy

**For:** the VPS-manager Claude (has SSH access to the Zunkiree VPS).
**From:** the edgeX app/dev Claude (no infra mandate on the box).
**Severity:** High — `dev-lead-crm.zunkireelabs.com` is degraded/down.

## Symptoms (observed 2026-06-24)
- `ssh vps` (root@94.136.189.213) → `uptime` shows **load average 121 / 84 / 68 on a 6-core box** (~20× capacity, and climbing: was 30 earlier, then 22, now 121).
- `docker ps` → container **`leads-crm-dev` "Up 16 hours (unhealthy)"** — it was NOT recreated by today's deploys, and its healthcheck is now failing.
- SSH itself + `docker inspect` time out at ~2 min under the load.
- Dev app dir git HEAD = `3139497` (latest stage; `git pull` did run).

## Most likely root cause (hypothesis to verify)
The staging deploy (`.github/workflows/deploy-staging.yml`) runs a **VPS-side `docker compose build`** via `appleboy/ssh-action`. On this overloaded box the build exceeds the SSH `command_timeout` (was 30m, raised to 45m today) and **times out**. When the action times out it **kills the SSH session but orphans the remote `docker compose build` / BuildKit / node compile processes**. Several deploys were triggered today → **orphaned build processes likely accumulated and are pinning the box**. The container was never swapped because the build never finished cleanly.

(Today's pipeline change DID help the build itself — Next compile dropped 21min→8.5min via new BuildKit cache mounts — but the cold total still blew past 45m at this load.)

## Evidence (read-only `ps` captured during the incident — CONFIRMS the hypothesis)
```
PID 3347754  17.6%  ELAPSED 47:33   node /app/node_modules/.bin/next build      ← ORPHANED build (no deploy active)
PID 3356317  14.8%  ELAPSED 37:29   node .../next/dist/compiled/jest-worker/... ← its build worker
PID 2538300  26.5%  ELAPSED 16:12:46 next-server (v…)                            ← our leads-crm-dev container (16h)
PID 3679836  15.2%  ELAPSED 2 days   next-server                                ← another tenant project (do NOT touch)
PID 3194123  12.9%  next-server v16.2.1                                          ← another instance
PID 3331783  18.4%  claude                                                       ← a claude process on the box
+ VS Code remote servers, and `apport` processing a systemd-journald CRASH
```
A `next build` + jest-worker running **47 minutes with no deploy in flight** = the orphaned build from the timed-out SSH deploy. **These (the long-running `/app/node_modules/.bin/next build` and its jest-worker child, not tied to any active deploy) are the safe, OURS-to-kill targets.** PIDs will differ by the time you act — match on the *pattern* (orphaned `next build`/jest-worker with long elapsed). The `apport`/journald crash suggests the box is also swap-thrashing/OOM — worth checking `free -h` / dmesg for OOM-killer activity.

## Please investigate + resolve
1. `ps -eo pid,%cpu,etime,cmd --sort=-%cpu | head -20` — identify the top CPU eaters. Look for orphaned `buildkitd` / `docker-compose build` / `node` (next build) / `npm` processes tied to **lead-gen-crm-dev**.
2. If they're our orphaned builds: kill those specific PIDs → load should drop quickly.
3. Then recreate/restart the dev container so it goes healthy again:
   - `cd /home/zunkireelabs/devprojects/lead-gen-crm-dev`
   - **Use the dev compose explicitly** and confirm health: `docker compose up -d` then poll `docker inspect --format '{{.State.Health.Status}}' leads-crm-dev`.
4. Confirm `https://dev-lead-crm.zunkireelabs.com/login` returns 200.

## CRITICAL cautions
- **Shared box, multiple tenants.** Other projects run here (`nuad-thai`, `knsewa`, `admizz-edu`, `web-ota`, plus prod `leads-crm`). **Only kill OUR orphaned lead-gen-crm-dev build processes** — do NOT touch other tenants' running containers/processes.
- **Prod landmine:** the prod dir contains a stray DEV `docker-compose.yml`; a bare `docker compose` there has taken prod down before. Operate only in the **dev** dir (`lead-gen-crm-dev`) for this; never bare-compose in the prod dir.
- Do NOT touch the prod container `leads-crm` or prod deploy.

## Permanent fix recommendation (app team will implement if you agree)
This box (6 cores, chronic load 20–30, 15–18 users, many tenants) **cannot reliably build a Next app**. The durable fix is to **stop building on the VPS**: build the image in GitHub Actions, push to a registry (GHCR), and have the VPS only `docker pull` + `docker compose up -d`. That removes the 8–10 min build from the box entirely (VPS does a ~1-min pull). Until that's in place, **every `git push` to `stage` re-triggers a VPS build and risks re-melting the box** — so deploys should be paused.

## What the app team has done / will do
- All staging merges are **frozen** until the box recovers.
- Verified-but-unmerged PRs queued: #29 (poll-guards), #30 (db index mig 073, already applied to stage DB), #31 (Agentics load, already applied to stage DB), #33 (pagination). None will be merged until you give the all-clear.
