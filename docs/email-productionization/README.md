# Email Productionization — Connected Inboxes / Compose Email

**Status:** Path A (send-only) — productionizing 2026-07-20
**Owner:** Sadin (OAuth verification + prod config) · planning/review by Opus session

This folder documents taking the per-user Gmail feature
(`src/industries/_shared/features/email/`, `FEATURES.EMAIL`) from a dev/test-mode
feature to a real production feature usable by customers across all 8 industries.

---

## TL;DR — what changed and why

The feature was fully built (compose, send, encrypted token storage, reply-sync,
threading, per-industry gating) but only usable in **dev/test**, because the Google
OAuth app is in **"Testing" publishing status**: refresh tokens expire every 7 days,
capped at 100 manually-added test users. Unusable for real customers.

Going to production requires **Google OAuth verification**. The tier depends on the
scopes requested:

| Capability | Gmail scope | Google tier | Verification cost |
|---|---|---|---|
| **Send** email as the user | `gmail.send` | **Sensitive** | Standard review, **$0** |
| **Read** replies (reply-sync) | `gmail.readonly` | **Restricted** | Standard review **+ CASA security assessment** (~$500–$2k/yr, annual) |

Every Gmail scope that can read message content is **Restricted** → forces the
paid annual **CASA** assessment. There is no "sensitive-only" way to read a mailbox.

## The decision: Path A now, Path B later

**Path A (chosen):** ship **send-only** (`gmail.send` + `userinfo.email`, Sensitive tier,
$0, ~days–2 weeks to verify). Compose + send + email sequencing + AI draft-and-send go
live for all industries. Inbound **reply-sync is paused** — a lead's reply lands in the
user's real Gmail but is not mirrored into EdgeX until Path B.

**Path B (future):** when building the AI "**monitor** replies" phase (AI-native Phase 5),
re-enable `gmail.readonly`, complete **CASA Tier 2**, and reply-sync + two-way threads
come back on. Reversible — the reply-sync code stays in the repo, dormant behind a flag.

Nobody loses a working prod feature by choosing Path A: because prod OAuth is in Testing
mode today, no real customer has a usable connected inbox yet.

---

## What's in this folder

| Doc | For | What it covers |
|---|---|---|
| [`GOOGLE-OAUTH-VERIFICATION-RUNBOOK.md`](./GOOGLE-OAUTH-VERIFICATION-RUNBOOK.md) | **Sadin executes** | Step-by-step: domain verification, OAuth consent screen setup, scopes, homepage/privacy requirements, demo video, submit-for-review, timeline. This is the real dev→prod blocker. |
| [`PROD-CONFIG-CHECKLIST.md`](./PROD-CONFIG-CHECKLIST.md) | **Sadin verifies** | Prod env vars, redirect URI registration, encryption key, poll-cron status. |

---

## Code changes shipped for Path A (branch `feature/email-promote-all-industries`)

1. **Promotion** — `FEATURES.EMAIL` opened from education+travel to **all 8 industries**
   (`emailMeta.industries` + 6 manifests; 2 client gates swapped from hardcoded industry
   checks to `getFeatureAccess`).
2. **Scope narrowed to send-only** — `connect/route.ts` requests `gmail.send` +
   `userinfo.email` only (dropped `gmail.readonly`). The connected-account email address
   is now read from Google's **userinfo endpoint** instead of Gmail `getProfile` (which
   itself needs a read scope we no longer request).
3. **Reply-sync gated dormant** — the poller (`/api/internal/email/poll`) is guarded by
   `EMAIL_REPLY_SYNC_ENABLED` (default **off**). Off = returns immediately, no polling.
   Flip on (and restore the `gmail.readonly` scope + finish CASA) for Path B.
4. **Send rate limiting** — `/api/v1/email/send` is rate-limited per user (abuse guard now
   that sending is open to all industries/users).

## Re-enabling reply-sync later (Path B checklist)

1. Restore `gmail.readonly` in the `scope` string in `connect/route.ts`.
2. Re-point the connected-email lookup back to Gmail `getProfile` (or keep userinfo — both
   work once readonly is present).
3. Complete **CASA Tier 2** for the restricted scope (see runbook § "Path B / CASA").
4. Set `EMAIL_REPLY_SYNC_ENABLED=true` on the environment.
5. Have existing users **reconnect** so their grant includes the readonly scope.
