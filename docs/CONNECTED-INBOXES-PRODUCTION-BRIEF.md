# Connected Inboxes — Path to Production

> Status doc for taking the per-user Gmail "Connected Inboxes" feature (Settings → Communications) from one test account to real team-wide production use. Two independent tracks: **code** (this repo) and **Google verification** (Sadin, outside the repo). Update the checkboxes as items land; keep this at the top-level of `docs/` while it's in flight, then fold into `SESSION-LOG.md` + `FEATURE-CATALOG.md` and archive per the usual convention once shipped.

---

## What this feature is

Lets a team member connect their own Gmail (Settings → Communications → "Connect a Gmail inbox") so they can send email to leads from their own address inside the CRM, with replies syncing back into the lead's thread. Industry-gated to `education_consultancy` + `travel_agency`. Per-user, not shared — each person connects their own inbox; an admin cannot connect on someone else's behalf (Google requires the mailbox owner's own login).

## Where it started

Audited 2026-07-13: one connected account existed at all (`shrestha.sadin007@gmail.com`, Sadin's personal test Gmail), and the underlying code had real gaps — plaintext token storage, no visibility when a connection silently broke, no revoke-on-disconnect, a live bug excluding travel-agency tenants from inbound sync, dead legacy code, and no version-controlled production polling job.

---

## Track A — Code (this repo)

**Branch:** `feature/connected-inboxes-hardening` — **MERGED to `stage` 2026-07-17** (PR #198, reviewed + approved by `ani-shh`, deployed green to `dev-lead-crm`).

### Shipped (13 commits, build + lint clean)
- [x] Encrypt connected Gmail tokens at rest (AES-256-GCM, reusing the existing Unified Inbox key pattern)
- [x] "Needs reconnect" health badge — surfaces a broken inbox in the UI instead of failing silently forever
- [x] Revoke the Google OAuth grant on Disconnect (previously only deleted the local row)
- [x] Fixed a live bug: inbound poll worker was hardcoded to `education_consultancy` only, silently excluding travel-agency tenants from ever receiving replies
- [x] Removed dead legacy Gmail-connect route (unused, weaker security than the live path)
- [x] Added a version-controlled prod polling GitHub Actions workflow (`email-poll-prod.yml`), replacing an untracked hand-rolled VPS cron script
- [x] Code-review pass (xhigh effort, 14 confirmed findings) — fixed all of them: guarded every encrypt/decrypt call so failures are recorded (not silently dropped or swallowed), fixed the Reconnect button to target the specific broken account via `login_hint`, added a fetch timeout to the Google revoke call, corrected the prod cron's cadence assumption to GitHub Actions' real ~5-minute floor + added a concurrency guard, switched the health-badge query to a single embedded select, and surfaced the real sync error + last-synced time in the UI
- [x] Rebased onto latest `origin/stage`, CI green, lead-reviewed, merged

### Also shipped — Google-verification-readiness (separate PR, same feature area)
- [x] **PR #222** (`feature/google-oauth-verification-readiness`) — merged 2026-07-17, deployed green. Narrowed the requested Gmail scope from `mail.google.com` (restricted tier) to `gmail.readonly` + `gmail.send` (sensitive tier — see Track B decision below); added the public `/privacy` policy page.
- [x] **PR #224** (`fix/privacy-page-public-access`) — follow-up fix, open. `/privacy` was unreachable without login (auth middleware's public-route allowlist didn't include it — found via curl smoke on deployed stage, returned 307 not 200). One-line fix to `src/lib/supabase/middleware.ts`.

### Still to do (code)
- [ ] Merge PR #224 (the `/privacy` reachability fix) once reviewed
- [ ] Smoke-test the real logged-in OAuth connect/reconnect/disconnect flow on `dev-lead-crm` (not just the curl-level reachability checks done so far)
- [ ] Promote to `main`/production (separate gated PR; code-only, no DB migration on any of these branches)

### Infra checks before/at go-live (someone with VPS + GitHub-secrets access)
- [ ] Confirm `INBOX_TOKEN_ENC_KEY` is actually set on stage **and** prod — commit 1 fails closed without it (clean error, not silent corruption, but connect/send/poll all stop working until it's set)
- [ ] Confirm `INTERNAL_CRON_SECRET_PROD` exists as a GitHub secret — needed for the new `email-poll-prod.yml` to run once it reaches `main`
- [ ] Once the new GH Actions prod polling workflow is confirmed running, retire the old hand-rolled VPS crontab (`/root/poll-prod-email.sh`) — otherwise prod gets double-polled

---

## Track B — Google verification (Sadin, not code)

**Current state:** app (`edgeX CRM`, Google Cloud project `Orca Auth`) flipped from Testing → **In production** (2026-07-13). This already removed the 7-day forced-reconnect and the manual test-user-allowlist requirement. **Not removed yet:** the ~100-user lifetime cap, and the "Google hasn't verified this app" warning every connecting user sees.

- [x] **Decision made (2026-07-17): narrow to `gmail.readonly` + `gmail.send` instead of the broad `mail.google.com` scope.** The live code only ever calls `getProfile`/`history.list`/`messages.get`/`messages.send` — nothing needing full-mailbox access — so nothing was actually lost. This scope tier is classified *sensitive*, not *restricted*, which **skips the CASA Tier 2 paid security audit entirely** (~$540–$1,000 + mandatory annual re-assessment, avoided) while keeping reply-sync fully intact. Shipped in PR #222.
- [x] Privacy policy page drafted + hosted at `https://edgex.zunkireelabs.com/privacy` (PR #222 + reachability fix #224), including the required Google Limited Use compliance disclosure.
- [x] Scope justification for Google's review — drafted, ready to paste. See `docs/GOOGLE-OAUTH-VERIFICATION-BRIEF.md` §1.
- [ ] **Sadin: confirm consent-screen branding** (app name/logo/support email/domain) — defaults proposed in `docs/GOOGLE-OAUTH-VERIFICATION-BRIEF.md` §3, quick confirm-or-change.
- [ ] **Sadin: verify `zunkireelabs.com` domain ownership in Google Search Console** (required before Google accepts it as an authorized domain).
- [ ] Record the required demo video of the OAuth flow — **needs a human, can't be automated.** Shot-by-shot script ready in `docs/GOOGLE-OAUTH-VERIFICATION-BRIEF.md` §2.
- [ ] Submit for verification through Google Cloud Console — step-by-step in `docs/GOOGLE-OAUTH-VERIFICATION-BRIEF.md` §4.
- [ ] Wait for approval — the long pole, but shorter now that CASA isn't in the path (typical turnaround ~1–2 weeks for sensitive-scope-only apps vs. the CASA path's real weeks + recurring cost).

Full detail, exact text to paste, and the submission checklist: **`docs/GOOGLE-OAUTH-VERIFICATION-BRIEF.md`**.

---

## Track D — Rollout (once Track A is live)

- [ ] **Do not invite real counselors to connect before Track A is deployed** — otherwise their tokens land under the old unencrypted code
- [ ] Roll out gradually once live; watch the reconnect badge for anyone whose connection breaks
- [ ] Known gap, not blocking: no team-wide "which of my people have a broken connection" view for admins today — only the individual user sees their own badge. Worth a future feature if the team scales past a handful of connected inboxes.

---

## Housekeeping

- [ ] Update `docs/SESSION-LOG.md` once this actually ships
- [ ] Update the `FEATURES.EMAIL` row in `docs/FEATURE-CATALOG.md`
- [ ] Archive this brief into `docs/archive/features/` once shipped, per the repo's usual convention
- [ ] Clean up the local fake `broken.demo@gmail.com` seeded row + decide whether to reset the local `admin@admizz.local` password (low priority, local-only, no urgency)

---

## Explicitly out of scope (not touched by this work)

The older `FEATURE-CATALOG.md` "Phase 4 (pending)" items for this feature — contact-detail Email tab, Account 360 activity feed integration, subject search, attachments, quoted-block on reply — none of that was part of this hardening pass. Still not built.
