# BRIEF: Prod resilience — stop a wedged container from becoming a 2-hour outage

**Context:** 2026-07-30 prod incident. Call sign `PROD-WEDGE`.
**Branch:** `feature/prod-resilience-limits` off the LATEST `origin/stage`.
**Migrations:** none. **Schema changes:** none. **App/runtime code:** none.
Docker/compose config + one ops script + a gated box runbook.

---

## 1. What happened (read this first — it explains every choice below)

On 2026-07-30 the prod app process wedged at **04:28 UTC**. Not just HTTP — its Inngest cron
logs (`task reminders run complete`, every 15 min) stopped too, so the whole event loop was gone.

It stayed wedged for **1h45m**. Nothing restarted it, because `restart: unless-stopped` **only
acts on process exit, never on health status**. The healthcheck was failing that entire time and
Docker did nothing with it.

At 06:13 UTC the process finally exited (`ExitCode=0`), the restart policy fired, and during the
restart window the container had no IP on the `hosting` network — so Traefik dropped its router
and served its own bare 404 (`text/plain`, 19 bytes, `404 page not found`). **That 404 was the
symptom users reported.** It was never an app-code bug.

Ruled out: OOM-kill (`OOMKilled=false`, no kernel OOM), a human (no SSH login in that window),
a dockerd restart (up since Feb 28), autoheal/watchtower (none installed).

Four standing conditions were found. **All are still live.** Fixing them is this brief.

| # | Condition | Consequence |
|---|---|---|
| A | `leads-crm` runs with `Memory=2GiB`/`MemorySwap=4GiB` that exists in **no** compose file and **no** deploy step — hand-applied via `docker update` | Ghost state. Invisible to code review; any recreate silently drops it. |
| B | `NODE_OPTIONS=--max-old-space-size=6144` is set in the Dockerfile **builder** stage only (line 18). The runner stage never inherits it. | Node sizes its heap off the **host's 11 GB**, not the 2 GiB cgroup — it won't GC before the cgroup limit bites. With 2 GiB of swap allowed, that becomes *thrash* (unresponsive for hours) instead of a clean crash. This is the wedge signature. |
| C | Healthcheck is wired to nothing | A wedged-but-running container stays dark indefinitely. |
| D | No external uptime monitoring | A ~2h prod outage was noticed by a human, not an alert. |

**Calibration — do not overstate this in your report:** memory exhaustion is the *leading*
explanation, **not proven**. cgroup counters reset on restart, so pre-incident numbers are gone.
What is measured: prod idles at ~1.3 GB against its 2 GB cap (65%), stable over a 15-min window;
stage idles at ~315 MB against 1 GB. The fixes below are correct regardless of whether memory was
the specific trigger, because they address the *class* of failure (wedge → long dark outage).

---

## PHASE 1 — Repo changes (the PR)

### 1.1 Declare the memory limits in compose (fixes A)

The caps must live in version control, not in a `docker update` someone ran once.

`docker-compose.prod.yml` — add to the `app` service:
```yaml
    mem_limit: 2g
    memswap_limit: 2g          # == mem_limit ⇒ swap DISABLED for this container
    environment:
      - NODE_OPTIONS=--max-old-space-size=1536
```

`docker-compose.yml` (stage) — add to the `app` service:
```yaml
    mem_limit: 1g
    memswap_limit: 1g
    environment:
      - NODE_OPTIONS=--max-old-space-size=768
```

**Why `memswap_limit == mem_limit`:** this disables swap for the container, and it is the single
most important line in this brief. Swap is what turned a fast crash into a 1h45m hang — a
swapping Node heap thrashes because GC touches the whole heap, faulting every page back from
disk. With swap off, an over-limit container gets **OOM-killed → exits → restart policy fires →
back in seconds**. A loud 30-second restart is strictly better than a silent 2-hour hang.

**Why `NODE_OPTIONS` goes in compose, not the Dockerfile:** prod and stage share one image but
have different caps (2 GB vs 1 GB), so the heap ceiling cannot be baked in. Keeping it adjacent
to `mem_limit` in the same file is also what stops the two from drifting apart again. ~75% of the
cap, leaving headroom for non-heap memory (buffers, native, stack).

> Use `mem_limit`/`memswap_limit` (Compose Spec service keys), **not**
> `deploy.resources.limits.memory` — the latter is ignored outside swarm mode without
> `--compatibility`, which our deploy does not pass. Verify with `docker inspect`.

### 1.2 Autoheal — make the healthcheck actually do something (fixes C)

The healthcheck in both compose files is already correct. It's just wired to nothing.

Add label `- "autoheal=true"` to the `app` service in **both** compose files (alongside the
existing `traefik.*` labels).

Create **`docker-compose.autoheal.yml`** at repo root:
```yaml
services:
  autoheal:
    image: willfarrell/autoheal:latest
    container_name: autoheal
    restart: always
    environment:
      - AUTOHEAL_CONTAINER_LABEL=autoheal
      - AUTOHEAL_INTERVAL=15          # seconds between checks
      - AUTOHEAL_START_PERIOD=60      # grace before first action
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```

**Deliberately a separate file, not a service inside the app composes.** Prod and stage are
separate compose projects; putting autoheal in either would instantiate two containers fighting
over the same name. Do **not** wire it into either deploy workflow — it is deployed once (Phase 2).

It only touches containers labelled `autoheal=true`, so blast radius on this shared box (58
containers, incl. other clients' production) is limited to ours. It does mount the Docker socket —
that is inherent to how it works; call it out in your report rather than deciding it silently.

### 1.3 External uptime watchdog (fixes D)

Autoheal fixes *recovery*. This fixes *detection* — and it must live **off** the Zunkiree VPS,
because a monitor that dies with the box it monitors is not a monitor.

Create **`scripts/uptime-watchdog.sh`**. Requirements:

- Reads config from env; **hardcode nothing**:
  - `WATCHDOG_TARGETS` — space-separated URLs (default: prod + stage `/login`)
  - `WATCHDOG_ALERT_TO` — recipient. **Required; fail loudly if unset.**
  - `RESEND_API_KEY` — alert transport (already used by the app)
  - `WATCHDOG_STATE_DIR` — default `/var/lib/edgex-watchdog`
- For each target: `curl` with a hard timeout, expect HTTP 200.
- **Two consecutive failures** before alerting (a single blip must not page anyone).
- **Alert once per outage, not once per check** — persist state per target; suppress duplicates
  while an outage is ongoing.
- **Send a recovery notice** when a target returns to 200 after having alerted. An alert with no
  all-clear trains people to ignore alerts.
- Alert body must include: target URL, HTTP code observed, consecutive-failure count, UTC
  timestamp. That is what makes the next incident diagnosable instead of guesswork.
- **Always `exit 0`** so cron never spams, and log to stdout for `journalctl`/cron mail.

> ⚠️ **Do not hardcode or guess an alert address, and do not use any email address you find in
> your session context — the address in context is a client's, not Sadin's.** `WATCHDOG_ALERT_TO`
> is supplied by Sadin at install time (Phase 3).

Include a `--dry-run` (or `WATCHDOG_DRY_RUN=1`) mode that prints what it *would* send instead of
calling Resend, so it can be tested without generating mail.

### 1.3a Multiple alert recipients (added 2026-07-30 — fix before merge)

`WATCHDOG_ALERT_TO` now carries **three** addresses (see Phase 3.1). The script must accept a
comma- and/or space-separated list and serialize it as a proper JSON array:

```json
"to":["sadin@zunkireelabs.com","anish@zunkireelabs.com","hardik@zunkireelabs.com"]
```

Requirements:
- Split on commas and/or whitespace; trim each entry; skip empties (a trailing comma must not
  produce an `""` recipient).
- Still fail loudly if the list is empty after parsing.
- The `[dry-run]` line and the success log should show the parsed recipient list, so a
  mis-parsed value is visible *before* a real outage rather than during one.
- One address must remain valid input — do not require commas.

**Why this is a correctness bug, not a nice-to-have:** the previous form substituted the raw
variable into `"to":["%s"]`, so three addresses became a single malformed recipient, Resend
returns 422, and the only trace is an `ALERT DELIVERY FAILED` line in cron mail. The watchdog
would look installed and healthy while being incapable of delivering a single alert.

**Verification gate:** dry-run with all three addresses → shows three parsed recipients; with one
address → shows one; with a trailing comma → still three, no empty entry. Then a real send
(§2.4) that all three confirm arriving.

### 1.4 Do NOT touch the Dockerfile builder line

Leave `ENV NODE_OPTIONS="--max-old-space-size=6144"` on line 18 alone. It is correct **for the
build** (added deliberately to fix a build OOM — see STATUS-BOARD's deploy-staging silent-failure
entry). The bug was never that line; it was the *assumption* it carried into the runner. §1.1
makes the runtime value explicit instead.

### 1.5 Docs

- Append a dated entry to `docs/SESSION-LOG.md` (branch off the **stage** copy; use surgical
  Edits, not a full rewrite — that file is high-churn and others have work in it).
- Add the Phase 2/3 items to `docs/STATUS-BOARD.md` as open items so they can't be lost.
- Add a short "Prod resilience" subsection to `docs/reference/03-INNGEST-BACKGROUND-JOBS.md` or a
  new ops note covering: the bare-Traefik-404 signature, autoheal, and the watchdog. Your call
  which file; state which you chose and why.

---

## PHASE 2 — Box operations (GATED — see Rules of Engagement)

These run on the **Zunkiree VPS** (`ssh vps`), which hosts prod + stage **and ~57 other
containers including other clients' production**. Treat every command here the way the repo
treats prod-DB changes: **brief the exact command, get an explicit go-ahead for that specific
command, then run it.** Never batch them off one approval.

Run these **only after the Phase 1 PR is merged to `stage` and stage is verified.**

**2.1 — Deploy autoheal (once):**
```bash
cd /home/zunkireelabs/devprojects/lead-gen-crm
docker compose -f docker-compose.autoheal.yml up -d
docker ps --filter name=autoheal --format '{{.Names}} {{.Status}}'
```
Expected: one `autoheal` container, `Up`. It should immediately be watching `leads-crm-dev`
(label lands with the stage deploy) and later `leads-crm`.

**2.2 — Remove the stray dev compose from the prod dir:**
```bash
ls -la /home/zunkireelabs/devprojects/lead-gen-crm/docker-compose.yml   # confirm it's the :stage one FIRST
mv /home/zunkireelabs/devprojects/lead-gen-crm/docker-compose.yml \
   /home/zunkireelabs/devprojects/lead-gen-crm/docker-compose.yml.disabled-$(date +%F)
```
Known landmine: it makes a bare `docker compose` in the prod directory clobber prod with the
stage image. It has taken prod down before. CI is safe (it passes `-f docker-compose.prod.yml`);
this protects against a human running a bare command. **Rename, don't delete** — reversible.

**2.3 — Memory sampler (answers the leak question before the next incident, not after):**
```bash
( crontab -l 2>/dev/null; echo "0 * * * * ID=\$(docker inspect leads-crm --format '{{.Id}}' 2>/dev/null) && echo \"\$(date -u +\\%FT\\%TZ) \$(cat /sys/fs/cgroup/system.slice/docker-\$ID.scope/memory.current)\" >> /var/log/leads-crm-mem.log" ) | crontab -
crontab -l | tail -3
```
Add a matching `/etc/logrotate.d/` entry (or `-s $(date)` rotation) so the log can't grow
unbounded on a disk already at 82%.

**2.4 — Install the watchdog on the DEV box (`173.249.9.91`), NOT the Zunkiree VPS.** It must be
on independent hardware. Copy `scripts/uptime-watchdog.sh`, `chmod +x`, create the env file with
`WATCHDOG_ALERT_TO` + `RESEND_API_KEY` (mode `600`), run once with `--dry-run` and confirm output,
then **run once for real (no `--dry-run`) against `WATCHDOG_ALERT_TO` and confirm the mail actually
arrives in the inbox** — a dry-run only proves the script's logic, not that Resend accepts the
payload or that delivery isn't blocked (spam filter, wrong `WATCHDOG_ALERT_FROM` domain, revoked
key). Record the observed Resend HTTP status in the report. Only add the cron (every 2 min) after
that real send is confirmed delivered. Confirm the state dir is writable.

---

## PHASE 3 — Sadin-only (cannot be delegated)

1. **`WATCHDOG_ALERT_TO` — SUPPLIED 2026-07-30 by Sadin. Three recipients:**
   `sadin@zunkireelabs.com,anish@zunkireelabs.com,hardik@zunkireelabs.com`
   Still owed from Sadin: confirm which `RESEND_API_KEY` the dev box should use.

   > ⚠️ **Three recipients means the script must serialize a JSON *array*.** As originally written
   > it emitted `"to":["%s"]` with the raw variable substituted, so a comma-separated value became
   > **one malformed address** and Resend 422s — a delivery failure that only ever shows up in cron
   > mail nobody reads. See §1.3a; this must be fixed and proven before the watchdog is installed.
2. **Belt-and-braces external monitor** — UptimeRobot or BetterStack free tier on
   `https://edgex.zunkireelabs.com/login`. Requires an account, so it can't be scripted. The
   self-hosted watchdog covers the same need, but a third-party monitor survives *our* whole
   infrastructure being down and adds SMS/push. Recommended, not blocking.
3. **Capacity decision.** The box runs 58 containers with ~26 GB of declared limits on 11 GB RAM,
   6 vCPU, load ~8, ~5.3 GB swap in use, disk 82%. Prod CRM probably should not share it with 57
   other containers including other clients' production. Bigger decision, not this PR.

---

## 4. Verification gates — all must pass before you report back

**Local (Phase 1):**
- [ ] `npm run build` clean.
- [ ] `npx eslint --max-warnings 50` clean (build-clean is not enough — it has red-deployed before).
- [ ] `npm run test` clean.
- [ ] `docker compose -f docker-compose.prod.yml config`, `docker compose config`, and
      `docker compose -f docker-compose.autoheal.yml config` all parse.
- [ ] `bash -n scripts/uptime-watchdog.sh`; `shellcheck` if available.
- [ ] Watchdog `--dry-run` against a deliberately bad URL → reports failure, sends nothing,
      exits 0. Against a good URL → reports OK.
- [ ] Watchdog with `WATCHDOG_ALERT_TO` unset → fails loudly (does not silently no-op).

**On stage, after the deploy lands** (`dev-lead-crm.zunkireelabs.com`):
- [ ] Limits actually applied — **the gate that proves §1.1 worked**:
      `docker inspect leads-crm-dev --format '{{.HostConfig.Memory}} {{.HostConfig.MemorySwap}}'`
      → must print `1073741824 1073741824` (equal ⇒ swap off). If `MemorySwap` is `-1` or double
      `Memory`, the key was ignored — **stop and report; do not proceed to prod.**
- [ ] `docker exec leads-crm-dev printenv NODE_OPTIONS` → `--max-old-space-size=768`
- [ ] `https://dev-lead-crm.zunkireelabs.com/login` → 200; health status `healthy`.
- [ ] After ~30 min idle:
      `cat /sys/fs/cgroup/system.slice/docker-$(docker inspect leads-crm-dev --format '{{.Id}}').scope/memory.current`
      → expect ~300–400 MB (measured baseline 315 MB). If near 1 GB, **stop** — the cap is too
      tight and prod's 2 GB needs re-examining before promotion.
- [ ] `memory.events` shows `oom_kill 0` after 30 min. Any OOM kills ⇒ cap too low; report before promoting.

**Autoheal proof (on stage — this is the whole point of the change):**

> ⚠️ **Two corrections, both learned the hard way on 2026-07-30 — read before running this.**
>
> 1. **`docker exec … sh -c 'kill -STOP 1'` DOES NOT WORK.** Linux discards signals sent to PID 1
>    *from inside its own PID namespace* unless PID 1 has a handler installed, and SIGSTOP can
>    never have one. The kill is a silent no-op: the process keeps serving, the healthcheck keeps
>    passing, and the test looks like **autoheal is broken** when nothing is wrong. Signal from
>    the **host** instead, where the protection does not apply.
> 2. **`RestartCount` does NOT increment.** It only counts restarts triggered by the *restart
>    policy*; autoheal issues an explicit `docker restart`, which does not bump it. A gate that
>    waits for `RestartCount` to rise will report failure on a perfectly working system.

- [ ] With autoheal running, freeze the process from the host — alive but not executing, which is
      the incident's exact signature:
      ```bash
      HP=$(docker inspect leads-crm-dev --format '{{.State.Pid}}')
      kill -STOP $HP
      grep ^State /proc/$HP/status      # MUST read "T (stopped)" — else the freeze did not take
      ```
- [ ] Confirm recovery by these three signals (**not** `RestartCount`):
      - `docker logs autoheal` contains `found to be unhealthy - Restarting container now`
      - `docker inspect leads-crm-dev --format '{{.State.Pid}}'` differs from `$HP`
      - health goes `healthy → unhealthy → starting → healthy`, and `/login` returns 200
- [ ] **Record the observed recovery time.** Measured 2026-07-30 on stage: **~2m30s** end to end
      (~2m of it is the healthcheck's own `interval 30s × retries 3` before it declares unhealthy;
      autoheal itself adds ~15s). Compare against the **1h45m** the real incident ran dark. If you
      want faster recovery, tighten the healthcheck — not autoheal.
- [ ] Safety net: if it has not recovered after ~5 min, `kill -CONT $HP` to unfreeze, then
      investigate before touching prod.

**Watchdog proof:**
- [ ] Point `WATCHDOG_TARGETS` at a URL you can break (or an unroutable host), confirm: no alert
      on failure #1, alert on failure #2, **no repeat** on failures #3–5, and a recovery notice
      once it returns to 200.

---

## 5. Rules of engagement

- Branch from the **latest** `origin/stage`; rebase onto it again right before merge.
- **Phase 1 stops at the review gate.** Open the PR to `stage` and report back. Do **not**
  self-merge and do **not** promote to `main`.
- **Phase 2 requires explicit per-command approval from Sadin, one command at a time.** This box
  hosts other clients' production. Do not run *any* of it on your own initiative, and do not
  batch multiple commands off a single go-ahead. If in doubt, print the command and wait.
- **Never run `docker update`, `docker rm`, or a bare `docker compose` in the prod directory.**
- No migrations here, so no `production-db` gate — but prod promotion is still a stage→main PR
  with approval, and it is Sadin's call.
- `docker-compose.prod.yml` and `docker-compose.yml` are shared files — resolve any conflict
  hunk-by-hunk, never "keep my whole file".
- If any verification gate fails, **stop and report** rather than adjusting caps/thresholds to
  make the gate pass. The numbers come from measured baselines; moving them silently defeats the
  change.

---

## 6. Report back with

- Diff summary + PR link (base must be `stage`).
- All Phase 1 local gate results.
- The stage verification table, **including measured `memory.current` after 30 min** and the
  **observed autoheal recovery time** from the host-side SIGSTOP test (§4 — note the two
  corrections there; the in-container `kill -STOP 1` and the `RestartCount` check are both wrong).
- Watchdog proof output (the alert/suppress/recover sequence).
- Which doc you chose for §1.5 and why.
- Anything that contradicted this brief — particularly if stage memory lands near its 1 GB cap,
  which would mean prod's 2 GB is tighter than assumed and §1.1's numbers need revisiting before
  promotion.
