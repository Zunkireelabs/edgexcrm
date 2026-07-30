# BRIEF: Prod hardening follow-ups (PROD-WEDGE part 2)

**Context:** follow-ups from the 2026-07-30 prod incident + the CodeRabbit review on PR #320.
Call sign `PROD-HARDEN`.
**Branch:** `fix/prod-hardening` off the LATEST `origin/stage`.
**Migrations:** none. **Schema:** none.
Small app-code change + one compose pin + one script fix + doc accuracy.

---

## 0. State of the world — read before touching anything

Already done today, **do not redo**:

| Thing | State |
|---|---|
| `mem_limit`/`memswap_limit` (swap off) | ✅ live prod + stage, declared in compose |
| `NODE_OPTIONS` runtime value | ✅ live (prod 1536, stage 768) |
| `autoheal` container + labels | ✅ deployed, project `autoheal`, **verified: ~2m30s recovery** |
| `NEXTAUTH_SECRET` | ✅ **manually added to `.env.local` on prod + stage, containers recreated, verified present** |
| **Detection / alerting** | ✅ **UptimeRobot is LIVE** — keyword monitor on `https://edgex.zunkireelabs.com/login`, keyword `EdgeX`, 5-min, alerts to sadin@/anish@/hardik@, **alert delivery tested end-to-end and confirmed by all three** |
| `scripts/uptime-watchdog.sh` | ⚠️ merged but **NOT installed anywhere**. UptimeRobot supersedes it as primary detection. |

**The single most important correction in this brief is §4** — the runbook currently claims the
watchdog is installed on the dev box. It is not, and UptimeRobot is what's actually protecting us.
A resilience doc that misdescribes what's live is worse than no doc.

---

## 1. `NEXTAUTH_SECRET` — fail closed, and make it survivable

### 1.1 Fail closed (the actual bug)

`src/app/(main)/api/v1/email/inboxes/connect/route.ts:15` and
`src/app/(main)/api/v1/email/inboxes/callback/route.ts:28` both do:

```ts
const secret = process.env.NEXTAUTH_SECRET || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
```

**`NEXT_PUBLIC_SUPABASE_ANON_KEY` is public by definition** — it ships in every browser bundle.
That HMAC is the CSRF binding for the Gmail OAuth callback, so with the fallback active it is
signed with a publicly-known key and anyone can forge state for any `userId`. Realistic impact:
attach an attacker-controlled mailbox to a victim's CRM account.

The env var is now set on both boxes, so the fallback is dormant — but a fallback that silently
degrades to a public value must not exist at all. Any future box rebuild or typo re-opens it with
no signal.

Required:
- Extract the shared logic (both files duplicate `signState`/`verifyState` and the same fallback)
  into one module — e.g. `src/lib/email/oauth-state.ts` — and import it in both routes. Do not
  fix the fallback twice.
- **Throw or return 503 when `NEXTAUTH_SECRET` is unset.** No fallback. Connect should surface
  `apiServiceUnavailable("...")` the way the missing-`GOOGLE_CLIENT_ID` path already does at
  `connect/route.ts:26`; follow that existing shape.
- Callback must refuse to verify (redirect to the settings URL with an error param) rather than
  verify against a guessed secret.
- Add unit tests: secret set → sign/verify round-trips; secret unset → connect 503s and verify
  returns false; a state signed with a *different* secret fails verification.

### 1.2 Secondary weakness — note it, don't necessarily fix it

The state is a static `HMAC(userId)` with no nonce and no expiry, so it is replayable forever even
with a proper secret. Fixing properly means a nonce + short TTL (and somewhere to keep it).
**Out of scope for this PR** — but add a `TODO` comment referencing this brief so the next person
doesn't assume it's solved. Call it out in your report.

### 1.3 Make the secret survive a box rebuild

`NEXTAUTH_SECRET` currently lives **only** in `.env.local` on each box. The deploy appends managed
blocks (`sed` delete + `>>`) and never rewrites the rest, so it survives deploys — but not a lost
or rebuilt box.

Add it to the GitHub-Actions-managed block, exactly like `INBOUND_TOKEN_SECRET`:
- `.github/workflows/deploy.yml` — add `NEXTAUTH_SECRET: ${{ secrets.NEXTAUTH_SECRET }}` to the
  `env:` list, to the `envs:` passthrough list, and to the OPS-env heredoc.
- `.github/workflows/deploy-staging.yml` — same.
- **Do not invent values.** Sadin adds the GitHub environment secrets (`production` + `stage`)
  using the values already on each box. Flag this in your report as a required manual step, and
  note that the two environments must keep **different** values.
- Because the managed block is appended *after* the hand-added line, the GitHub-managed value wins
  (last assignment). Once the GH secret is set to the same value, the hand-added line is
  harmless — but list "remove the now-duplicate hand-added line" as a follow-up.

---

## 2. Remove dead credentials from prod

Prod's environment still carries `OLD_SUPABASE_URL` and `OLD_SUPABASE_SERVICE_ROLE_KEY`, left over
from the 2026-06-21 database split. A stale **service-role** key (RLS-bypassing) sitting in a live
environment is pure liability.

- Confirm nothing reads them: `grep -rn "OLD_SUPABASE" src/ scripts/ .github/` must return nothing.
- **Do not edit prod `.env.local` yourself** — hand Sadin the exact commands (back up first,
  delete the two lines, recreate with `-f docker-compose.prod.yml`).
- Recommend in your report that the old service-role key be **rotated/revoked** in the old
  Supabase project, since it has been sitting in an env file of unknown exposure.

---

## 3. CodeRabbit items on `scripts/uptime-watchdog.sh` + autoheal

### 3.1 Pin the autoheal image (do this one properly)

`docker-compose.autoheal.yml` uses `willfarrell/autoheal:latest`. That container **mounts the
Docker socket and can restart any container on a box hosting ~57 containers including other
clients' production**. A mutable tag there is a real supply-chain surface.

Pin to a digest: `willfarrell/autoheal@sha256:<digest>`. Get the digest of the image **currently
running and verified** (`docker inspect autoheal --format '{{index .RepoDigests 0}}'` on the VPS —
ask Sadin to run it, or read it from a public registry). Add a comment recording the date pinned
and how to update it deliberately.

### 3.2 `mktemp` for the Resend response file

`send_email` writes `/tmp/watchdog-resend-response.$$` — predictable. Use `mktemp`, store the path,
and remove it on **both** the failure-return path and the success path.

### 3.3 Recovery-notice state reset — leave as is, document why

CodeRabbit flagged that the state file resets to `0 0` even when the *recovery* email fails to
send. This is **deliberate**: a stuck "still down" state is worse than a missed all-clear, and the
down-alert path (which does retry) is the one that matters. Add a short comment in the recovery
branch saying so, so it isn't "fixed" later by someone reading it as a bug.

---

## 4. Doc accuracy — the most important item here

### 4.1 `docs/reference/04-PROD-RESILIENCE.md` — the watchdog is NOT installed

The "Uptime watchdog" section currently reads:

> `scripts/uptime-watchdog.sh` is the independent check: it curls the public URLs from **outside**
> the Zunkiree VPS (installed on the separate dev box, `173.249.9.91`) …

**Present tense. It is not installed. Nothing is running it.** Anyone reading this concludes
alerting exists via the watchdog. Rewrite so it says plainly:

- **UptimeRobot is the live detection layer** (as of 2026-07-30): keyword monitor on
  `https://edgex.zunkireelabs.com/login`, keyword `EdgeX`, 5-minute interval, alerting
  sadin@/anish@/hardik@zunkireelabs.com, **delivery tested end-to-end**.
- **Why keyword, not plain HTTP:** the login page is client-rendered, so "Sign in" never appears in
  the HTML UptimeRobot fetches — a keyword monitor on that string would report DOWN permanently.
  `EdgeX` comes from the server-rendered `<title>`. Record this; it is a trap someone will re-hit.
- **Why an external SaaS over our own script:** the watchdog sends alerts via **Resend — our own
  infrastructure**. If Resend is down, the key rotates, or the sender domain de-verifies, alerts
  fail silently. A monitor of last resort must not share dependencies with what it monitors.
- `scripts/uptime-watchdog.sh` is **available but not installed**, kept as an optional second layer.
  Say so explicitly, including the install path (`docs/PROD-RESILIENCE-BRIEF.md` §2.4).

### 4.2 `docs/STATUS-BOARD.md`

- `WATCHDOG_ALERT_TO` is no longer outstanding — supplied 2026-07-30
  (sadin@/anish@/hardik@zunkireelabs.com). Remove from Sadin's open actions.
- Mark detection as **CLOSED via UptimeRobot** (tested), and re-scope Phase 2.4 to "optional second
  layer", not a blocker.
- Mark `NEXTAUTH_SECRET` as applied to both boxes, with GitHub-secret backfill (§1.3) still open.
- **Add a new open item: `.env.local` has no backup.** `RESEND_API_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `INBOX_TOKEN_ENC_KEY`, `NEXTAUTH_SECRET` and others exist **only**
  on the boxes — not in git, not in GitHub. `INBOX_TOKEN_ENC_KEY` is the sharp one: lose it and
  every stored OAuth token is permanently undecryptable. Owner: Sadin.

### 4.3 `CLAUDE.md`

- Add `04-PROD-RESILIENCE.md` to the `docs/reference/` list (it was created but never indexed).
- Fix the server section: it claims the Zunkiree VPS is "**NOT reachable from the dev box**" and
  that Sadin's Mac alias `vps` points at the dev box. On the Mac, `vps` → `94.136.189.213`, the
  **Zunkiree VPS**. Correct it — this cost real time today.

### 4.4 `docs/SESSION-LOG.md`

Dated entry for the incident and everything that shipped: root cause, the ~2m30s vs 1h45m result,
UptimeRobot going live, `NEXTAUTH_SECRET`. Branch off the **stage** copy; surgical Edits only.

---

## 5. Verification gates

- [ ] `npm run build`, `npx eslint --max-warnings 50`, `npm run test` all clean.
- [ ] New tests for §1.1 pass — **including the secret-unset case**, which is the actual bug.
- [ ] `grep -rn "NEXT_PUBLIC_SUPABASE_ANON_KEY" src/app/\(main\)/api/v1/email/inboxes/` returns
      **nothing** (the fallback is gone from both routes).
- [ ] `docker compose -f docker-compose.autoheal.yml config` still resolves `name: autoheal` and
      shows the pinned digest.
- [ ] `bash -n` + `shellcheck` clean on the watchdog.
- [ ] Watchdog dry-run still parses 3 recipients and the alert/suppress/recover sequence is intact.
- [ ] `grep -rn "installed on the separate dev box" docs/` returns nothing.

---

## 6. Rules of engagement

- Branch from the latest `origin/stage`; rebase before merge. PR to **`stage`**, stop at review.
- **Do not touch either box.** §1.3 GitHub secrets and §2 prod `.env.local` edits are Sadin's;
  hand him exact commands in your report.
- Do not self-merge; do not promote to `main`.
- Do not "fix" §3.3 — it is deliberate.
- If a gate fails, stop and report rather than adjusting the gate.

## 7. Report back with

- PR link (base `stage`) + diff summary.
- Gate results, especially the secret-unset test.
- The exact commands Sadin must run: GitHub secrets to add (names + which environment),
  prod `.env.local` line removals, and the autoheal digest lookup.
- Anything contradicting this brief — particularly if `OLD_SUPABASE_*` turns out to still be read
  somewhere.
