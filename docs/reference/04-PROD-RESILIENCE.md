# 04 — Prod Resilience

Ops runbook for keeping a wedged container from becoming a silent multi-hour outage. Written
after the `PROD-WEDGE` incident (2026-07-30). Full incident writeup + phased fix design:
`docs/PROD-RESILIENCE-BRIEF.md`.

---

## The bare-Traefik-404 signature

If prod (or stage) starts returning a `text/plain`, ~19-byte body reading exactly
`404 page not found` — **that is Traefik, not the app.** Traefik generates that response itself
when it has **no router** for the host, which happens whenever the target container has no IP on
the `hosting` network (mid-restart, mid-recreate, or crashed and not yet back up).

Diagnostic tell: the app's own Next.js 404 page is HTML, has headers, and is styled. Traefik's
bare 404 is plain text with none of that. If you see the plain-text version, look at the
container's state (`docker ps`, `docker inspect <container> --format '{{.State.Status}}
{{.State.Health.Status}}'`), not the app code.

**Do not "fix" a bare-Traefik-404 by restarting Traefik.** It's shared across ~58 containers on
the box (`docs/PROD-RESILIENCE-BRIEF.md` §3 capacity note) — a restart bounces every host it
routes for, not just the one you're debugging.

## Why `unless-stopped` alone isn't enough

Docker's `restart: unless-stopped` policy only fires on **process exit**. A container whose
process is alive but wedged — event loop dead, not serving requests, healthcheck failing — is
invisible to it. That's exactly what happened on 2026-07-30: the app wedged at 04:28 UTC, the
healthcheck failed continuously, and nothing acted on it until the process finally exited on its
own at 06:13 UTC — 1h45m later. `restart: unless-stopped` is necessary but not sufficient;
something has to translate "unhealthy" into an action.

## Autoheal — the missing link

[`willfarrell/autoheal`](https://hub.docker.com/r/willfarrell/autoheal) watches Docker's own
healthcheck status and restarts any container labeled `autoheal=true` once it's been `unhealthy`
long enough. It's the piece that was missing: the healthcheck in both compose files was already
correct, it just wasn't wired to anything that acts on it.

- Deployed once, standalone, via `docker-compose.autoheal.yml` at repo root — **not** as a service
  inside either app compose file. Prod and stage are separate compose projects; embedding autoheal
  in both would spin up two autoheal containers fighting over the same name.
- Only touches containers carrying the `autoheal=true` label — both `leads-crm` (prod) and
  `leads-crm-dev` (stage) carry it, nothing else on the shared box does.
- Mounts `/var/run/docker.sock`. That's inherent to how any container-restarting watcher works,
  not a shortcut taken here — worth knowing before treating the container as routine.

**Recovery time target:** with autoheal running, a healthcheck-failing-but-alive container should
be back in **about a minute** (interval 15s + start period 60s + Docker's own restart), not the
1h45m the actual incident took. The acceptance test for this is forcing the exact failure
signature — process alive, healthcheck failing — via `docker exec <container> sh -c 'kill -STOP
1'`, which freezes the process without killing it. See the brief §4 for the full verification
gate and how to read the result.

## Uptime watchdog — detection, not recovery

Autoheal fixes recovery once a problem is *detected* by Docker's own healthcheck. It does nothing
if the whole box is down, Traefik itself is wedged, or Docker's healthcheck subsystem is the thing
that's broken. `scripts/uptime-watchdog.sh` is the independent check: it curls the public URLs
from **outside** the Zunkiree VPS (installed on the separate dev box, `173.249.9.91`) and emails an
alert if a target fails twice in a row, with a matching recovery notice once it comes back. A
monitor that runs on the box it's monitoring is not a monitor — if that box goes fully dark, so
does the alert.

Config is entirely env-driven (`WATCHDOG_TARGETS`, `WATCHDOG_ALERT_TO`, `RESEND_API_KEY`,
`WATCHDOG_STATE_DIR`) — nothing is hardcoded, and it refuses to run without an explicit
`WATCHDOG_ALERT_TO`. See the script's header comment for the full behavior spec (2-failure
threshold, alert-once-per-outage, recovery notice, always exits 0 so cron doesn't spam).

## Memory: swap is not a safety net here

`docker-compose.prod.yml` / `docker-compose.yml` set `mem_limit` **equal to** `memswap_limit`,
which disables swap for the container. That's deliberate, not an oversight: a Node process that's
about to exceed its memory cap either gets OOM-killed immediately (loud, ~30s to recover via the
restart policy) or, if swap is available, thrashes for hours as GC repeatedly touches pages that
have been paged out (quiet, exactly what turned this incident into a 1h45m hang instead of a fast
crash). A loud short restart beats a silent long hang every time — see the brief §1.1 for the
full reasoning and the measured baselines (`memory.current` after 30 idle minutes) the current
caps are calibrated against.

`NODE_OPTIONS=--max-old-space-size=...` for the **runtime** container lives in compose,
next to `mem_limit`, not in the Dockerfile — the same image runs at two different memory caps
(prod 2 GB, stage 1 GB), so the heap ceiling can't be baked in at build time. The Dockerfile's
`NODE_OPTIONS` on the **builder** stage is a separate, correct setting for the build process
itself and is not touched by this.
