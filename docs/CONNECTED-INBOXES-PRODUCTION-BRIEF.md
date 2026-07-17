# Connected Inboxes — Path to Production

> Status doc for taking the per-user Gmail "Connected Inboxes" feature (Settings → Communications) from one test account to real team-wide production use. Two independent tracks: **code** (this repo) and **Google verification** (Sadin, outside the repo). Update the checkboxes as items land; keep this at the top-level of `docs/` while it's in flight, then fold into `SESSION-LOG.md` + `FEATURE-CATALOG.md` and archive per the usual convention once shipped.

---

## What this feature is

Lets a team member connect their own Gmail (Settings → Communications → "Connect a Gmail inbox") so they can send email to leads from their own address inside the CRM, with replies syncing back into the lead's thread. Industry-gated to `education_consultancy` + `travel_agency`. Per-user, not shared — each person connects their own inbox; an admin cannot connect on someone else's behalf (Google requires the mailbox owner's own login).

## Where it started

Audited 2026-07-13: one connected account existed at all (`shrestha.sadin007@gmail.com`, Sadin's personal test Gmail), and the underlying code had real gaps — plaintext token storage, no visibility when a connection silently broke, no revoke-on-disconnect, a live bug excluding travel-agency tenants from inbound sync, dead legacy code, and no version-controlled production polling job.

---

## Track A — Code (this repo)

**Branch:** `feature/connected-inboxes-hardening` (off `origin/stage`)

### Shipped on the branch (12 commits, build + lint clean)
- [x] Encrypt connected Gmail tokens at rest (AES-256-GCM, reusing the existing Unified Inbox key pattern)
- [x] "Needs reconnect" health badge — surfaces a broken inbox in the UI instead of failing silently forever
- [x] Revoke the Google OAuth grant on Disconnect (previously only deleted the local row)
- [x] Fixed a live bug: inbound poll worker was hardcoded to `education_consultancy` only, silently excluding travel-agency tenants from ever receiving replies
- [x] Removed dead legacy Gmail-connect route (unused, weaker security than the live path)
- [x] Added a version-controlled prod polling GitHub Actions workflow (`email-poll-prod.yml`), replacing an untracked hand-rolled VPS cron script
- [x] Code-review pass (xhigh effort, 14 confirmed findings) — fixed all of them: guarded every encrypt/decrypt call so failures are recorded (not silently dropped or swallowed), fixed the Reconnect button to target the specific broken account via `login_hint`, added a fetch timeout to the Google revoke call, corrected the prod cron's cadence assumption to GitHub Actions' real ~5-minute floor + added a concurrency guard, switched the health-badge query to a single embedded select, and surfaced the real sync error + last-synced time in the UI

### Still to do (code)
- [ ] Rebase onto latest `origin/stage` (it has moved since branching)
- [ ] Push branch, open PR into `stage`
- [ ] Get CI green + 1 lead approval (Sadin/Anish), squash-merge
- [ ] Smoke-test on the deployed staging site (`dev-lead-crm...`) — not just local
- [ ] Promote to `main`/production (separate gated PR; code-only, no DB migration on this branch)

### Infra checks before/at go-live (someone with VPS + GitHub-secrets access)
- [ ] Confirm `INBOX_TOKEN_ENC_KEY` is actually set on stage **and** prod — commit 1 fails closed without it (clean error, not silent corruption, but connect/send/poll all stop working until it's set)
- [ ] Confirm `INTERNAL_CRON_SECRET_PROD` exists as a GitHub secret — needed for the new `email-poll-prod.yml` to run once it reaches `main`
- [ ] Once the new GH Actions prod polling workflow is confirmed running, retire the old hand-rolled VPS crontab (`/root/poll-prod-email.sh`) — otherwise prod gets double-polled

---

## Track B — Google verification (Sadin, not code)

**Current state:** app (`edgeX CRM`, Google Cloud project `Orca Auth`) flipped from Testing → **In production** (2026-07-13). This already removed the 7-day forced-reconnect and the manual test-user-allowlist requirement. **Not removed yet:** the ~100-user lifetime cap, and the "Google hasn't verified this app" warning every connecting user sees.

- [ ] **Decision needed:** keep the broad `https://mail.google.com/` scope (reply-sync stays, but needs Google's restricted-scope verification + likely a paid third-party security assessment — real weeks + cost) vs. narrow to send-only (faster/cheaper verification, but loses the reply-sync feature that's the actual value prop) — **recommendation: keep replies, pay for the assessment**
- [ ] Draft + host a privacy policy page (Claude can draft the text)
- [ ] Draft the scope justification for Google's review (Claude can draft this)
- [ ] Decide branding shown on the consent screen (name/logo/support email)
- [ ] Record the required demo video of the OAuth flow (needs a human — can't be automated)
- [ ] Submit for verification through Google Cloud Console
- [ ] Wait for approval — this is the long pole; nothing else can shorten it once submitted

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
