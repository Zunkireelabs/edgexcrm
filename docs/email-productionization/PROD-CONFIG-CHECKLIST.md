# Prod Config Checklist — Email feature

Verify these on **production** (`pirhnklvtjjpuvbvibxf` DB / `edgex.zunkireelabs.com` app box).
Only Sadin can shell into the Zunkiree VPS — items marked 🔒 need the box; items marked ✅ were
pre-verified by the Opus session via `gh`.

## Environment variables (prod VPS `.env.local` + `docker-compose.prod.yml` build args)

The DB/OAuth pointer lives in **two places per env** — the VPS `.env.local` (runtime) **and**
the compose build args (baked `NEXT_PUBLIC_*`). Keep them in lockstep.

| Var | Purpose | Notes |
|---|---|---|
| 🔒 `GOOGLE_CLIENT_ID` | OAuth client (the verified prod app) | Must be the client whose consent screen you verify. |
| 🔒 `GOOGLE_CLIENT_SECRET` | OAuth token exchange | Server-side only; never `NEXT_PUBLIC_`. |
| 🔒 `INBOX_TOKEN_ENC_KEY` | AES-256-GCM key encrypting stored Gmail tokens | **Must be set and stable.** If it changes, all stored tokens become undecryptable → users must reconnect. Back it up. |
| 🔒 `NEXT_PUBLIC_APP_URL` | Builds the OAuth redirect URI | Must be `https://edgex.zunkireelabs.com` (or whatever prod domain the redirect URI in Google Console is registered for — the two MUST match exactly). |
| 🔒 `NEXTAUTH_SECRET` | Signs the OAuth `state` param | Falls back to the anon key if unset, but set it explicitly. |
| ✅ `INTERNAL_CRON_SECRET` (box) ↔ `INTERNAL_CRON_SECRET_PROD` (GH secret) | Auth for the poll cron | GH secret **exists** (`INTERNAL_CRON_SECRET_PROD`). The box value must equal the GH secret. |
| — `EMAIL_REPLY_SYNC_ENABLED` | Path A dormancy flag for reply-sync | Leave **unset/false** for Path A. Set `true` only after CASA (Path B). |

## Google Cloud Console

- [ ] 🔒 OAuth client → Authorized redirect URIs includes exactly
      `https://edgex.zunkireelabs.com/api/v1/email/inboxes/callback`
      (matches prod `NEXT_PUBLIC_APP_URL`).
- [ ] 🔒 Consent screen scopes = `gmail.send` + `userinfo.email` only (no `gmail.readonly`).
- [ ] 🔒 Publishing status → In production / Verified (per the verification runbook).

## Poll cron (reply-sync infrastructure — dormant under Path A)

- ✅ `email-poll-prod.yml` exists, enabled, and returns **HTTP 200** on schedule
  (verified 2026-07-20; recent runs all `success`). Hits
  `https://edgex.zunkireelabs.com/api/internal/email/poll`.
- ⚠️ **Cadence caveat:** the workflow is written `*/5 * * * *`, but GitHub Actions scheduled
  workflows are heavily throttled — observed real cadence was **1–3 hours between runs**, not
  5 minutes. Fine while reply-sync is dormant (Path A). **Before Path B** (when reply freshness
  matters, especially for AI-monitor), move polling to a more reliable trigger (dedicated cron
  on the VPS, Cloud Scheduler, or Inngest) — GH Actions cron is not dependable for
  minute-level freshness.
- Under Path A, once `EMAIL_REPLY_SYNC_ENABLED` is off, the endpoint returns immediately and
  the cron is a harmless no-op (still 200). You may leave it running or disable the workflow.

## Sanity smoke (after OAuth verification completes)

1. As a real user in any tenant → Settings → Communications → Connect a Gmail inbox → complete
   Google consent → lands back on Settings with the inbox connected (no 7-day warning once
   verified).
2. Open a lead → Activity → Emails → Compose Email → send → arrives; row appears in the
   Emails tab.
3. Rate limit: rapid repeated sends eventually return HTTP 429 (per-user cap) — expected.
