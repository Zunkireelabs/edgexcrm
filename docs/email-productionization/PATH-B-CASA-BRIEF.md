# Connected Inboxes (Gmail) — Path A Completion Report & Path B/CASA Feasibility Brief

**Date:** 2026-07-27
**Author:** Hardik (session with Claude) · **For:** Sadin / leadership review
**Status:** Path A production bugs found & fixed today, OAuth verification prep in
progress. Path B (reply-sync) evaluated — feasible but not started; requires budget +
a new governance mechanism before it's safe to enable for any tenant.

---

## 1. Executive Summary

The Connected Inboxes (Gmail send) feature shipped to production on 2026-07-20 (PR
#264) and was believed complete. Today's work revealed it was **never actually
functional on prod** — three separate, previously-undiscovered bugs blocked every
real connection attempt. All three are now fixed and verified working end-to-end.
Google OAuth verification submission (required before real, non-test customers can
use it) is in progress — most steps done, a few small items remain.

Separately, we researched what it would take to also enable **reply-sync** (pulling a
lead's email reply back into the CRM automatically) for all tenants. It's small on the
code side — that capability was already fully built months ago and is just switched
off. The real cost is an **annual paid Google security assessment (CASA)**, and more
importantly, **this codebase currently has no safe way to roll a feature like this out
per-tenant** — turning it on today would turn it on for every customer across every
industry simultaneously, with no consent step. There's already a working fix for
exactly this problem, built for the AI feature — the same pattern should be reused
here before Path B is enabled for anyone.

**Recommendation:** treat Path B as a scoped, budgeted future project, not something
to flip on quickly. No immediate business need is blocked by leaving it off.

---

## 2. Background

- **Connected Inboxes** lets any EdgeX user connect their own Gmail account and send
  emails to leads directly from the CRM, logged in the lead's activity timeline.
- Built in phases starting 2026-05-31; originally education-only, with both send and
  read-reply capability (using Google's `gmail.readonly` scope).
- On 2026-07-20, the feature was promoted to **all 8 industries** and re-scoped to
  **"Path A" — send-only** (`gmail.send` + `userinfo.email`), deliberately dropping
  `gmail.readonly`. Reason: any Gmail scope that can *read* a mailbox is Google's
  "Restricted" tier, which forces a paid, recurring security audit (CASA — see §5).
  Send-only stays in the "Sensitive" tier — a normal, free Google review.
- The OAuth app has been sitting in Google's "Testing" publishing status since then —
  usable only by a handful of manually-whitelisted test accounts, with tokens that
  expire every 7 days. Getting it to "In production / Verified" status (so any real
  customer can connect, with stable, non-expiring access) was today's starting task.

---

## 3. What Was Accomplished Today

### 3.1 Google OAuth Console configuration
- Audited the consent screen and confirmed `gmail.readonly` was **not** present —
  clearing the top risk item carried over from an earlier (superseded) two-scope plan.
- Added the exact scopes Path A requires: `gmail.send` + `userinfo.email`, with the
  written justification text Google requires for review.
- Renamed the consent-screen app identity from a stale placeholder ("Orca") to
  **"EdgeX"** — brand consistency matters for both user trust and Google's review.
- Confirmed the privacy policy link and its Google API "Limited Use" disclosure were
  already correctly in place.
- Confirmed the OAuth client's redirect URIs were already correctly registered
  (including the current production domain).
- Added a whitelisted test account so the flow could actually be exercised while
  still in Testing status.

### 3.2 Domain ownership verification
- Verified `zunkireelabs.com` ownership in Google Search Console (a hard prerequisite
  for OAuth verification), via a DNS TXT record added at the domain's DNS host.

### 3.3 Three production bugs found and fixed

This is the most important finding from today — **the feature had been live in the
codebase for a week but was silently broken for every real user** the whole time.
None of these were caught by the original code review or deploy checks, because
nothing had ever actually exercised the full connect flow on production before today.

| # | Bug | Symptom | Root cause | Fix |
|---|---|---|---|---|
| 1 | Stale production URL config | Every OAuth redirect, invite link, and share link silently pointed at the old `lead-crm.zunkireelabs.com` domain instead of `edgex.zunkireelabs.com` | A GitHub Actions deployment secret (`NEXT_PUBLIC_APP_URL`) was last updated in March — months before the domain migration — despite project docs claiming it had been fixed in June | Updated the secret, redeployed production |
| 2 | Missing encryption key | Every Gmail-connect attempt failed with a generic "unknown" error | The production server's environment was missing `INBOX_TOKEN_ENC_KEY`, the key used to encrypt stored Gmail tokens — the code fails safely (refuses to save a token unencrypted) rather than silently, which is correct behavior, but the key had simply never been set | Generated a new key, added it to the production environment, restarted the affected service |
| 3 | Consent-screen checkbox missed | Connections "succeeded" but sending email failed with "insufficient permission" | Google's newer consent-screen UI requires explicitly **checking a box** next to each requested permission — clicking "Continue" without checking it silently grants nothing for that permission. Every prior test attempt missed this step | Identified via the actual Google consent screen; not a code bug — a process gotcha now documented for future testing |

Bugs 1 and 2 are structural, permanent fixes — they cannot recur. Bug 3 is a
one-time testing gotcha now understood and avoidable.

### 3.4 Current status
- The full connect → consent → send flow is now confirmed working end-to-end on
  production.
- A demo video (required by Google for this type of scope request) has been
  recorded; needs a narration/caption pass before submission.
- Remaining before formal submission: upload an app logo and set the app's public
  homepage URL on the Google consent screen (both small, no dependencies), then
  submit via Google's Verification Centre, then publish the app from Testing to
  In-Production once approved.

---

## 4. Path B (Reply-Sync) — What It Is and Why It's Off

**Path B** means: when a lead replies to an email EdgeX sent, that reply
automatically appears in the CRM's conversation thread, instead of only landing in
the user's personal Gmail inbox.

This capability was **already fully built months ago** — polling logic, message
parsing, database schema, notifications — all of it exists in the codebase today.
It's simply switched off behind a single setting, specifically because turning it on
requires Google's `gmail.readonly` scope, which is "Restricted" tier and forces the
paid annual CASA security assessment described below. Path A (send-only) was
deliberately chosen to ship now, free, without that obligation — deferring the read
capability to a future "Path B."

---

## 5. What It Would Take to Turn Path B On

### 5.1 Code and configuration — small

- **One line of code**: add `gmail.readonly` back to the scope request.
- **One environment setting**: flip the reply-sync feature flag on.
- **Google Console**: re-add the `gmail.readonly` scope to the consent screen.
- **Every existing connected user must reconnect** — a Google authorization is
  permanently locked to the permissions it was granted with; there's no way to
  silently upgrade an existing connection.
- Everything else — the polling job, the Gmail reading logic, the message parser,
  the database tables — needs **zero changes**, it's already built and tested.

### 5.2 Google's CASA Tier 2 security assessment — the real cost

Any app requesting a Restricted-tier Gmail scope must pass an independent security
review:
- An **approved third-party scanner** is run against the live application and the
  results are submitted through an authorized assessor lab.
- **Cost: roughly $500–$2,000 per year**, paid to the assessor.
- **Takes a few weeks** to complete.
- **Recurring — must be renewed annually**, for as long as the feature stays live.
- Also requires meeting Google's data-handling expectations: encryption at rest
  (already satisfied), plus a **data deletion / retention policy** — which does
  **not** currently exist for this feature's synced email content and would need
  to be built as part of getting CASA-ready.

### 5.3 Multi-tenant rollout safety — the real work, and a direct precedent

This is the part that actually needs the most attention before Path B should be
considered, separate from Google's requirements entirely.

**The problem:** the reply-sync on/off switch today is a single, application-wide
setting. Every customer, across all 8 supported industries, shares it. There is
**no per-tenant control** — flipping it on would turn reply-sync on for every
tenant's every user simultaneously, with no ability to stage the rollout or require
individual customer consent first.

**We've already solved this exact problem once, for a different feature.** The AI
assistant feature originally had this identical flaw: a plan existed to roll it out
tenant-by-tenant, with one customer (Admizz, an education client whose end-users are
students) requiring explicit written consent before their data touched an AI
provider — but the only real switch available was application-wide, making that
staged, consent-gated plan technically unenforceable. This was caught, and fixed, by
building:
- A **per-tenant setting** (defaulting to off for every tenant, including existing
  ones — no customer is ever silently opted in).
- **Both** the application-wide switch **and** the per-tenant setting must be on —
  neither alone is enough.
- A single, deliberate, logged action to turn a specific tenant on — not a config
  flip that silently affects everyone at once.

**Recommendation:** before Path B is enabled for any tenant, build the same kind of
per-tenant control for reply-sync that already exists for the AI feature. This is a
real, contained engineering task, and reusing the proven pattern is far cheaper than
inventing a new one — but it hasn't been built yet for this feature.

### 5.4 Privacy and customer disclosure

- The public privacy policy currently only describes the send capability. It would
  need to be updated to disclose that EdgeX can read incoming mail once reply-sync
  is live for any tenant.
- Depending on the tenant's industry (education, where end-users may be students, is
  the clearest example), a direct customer notice/consent step is likely warranted —
  there's already a working template for this from the AI feature's rollout to reuse.

### 5.5 Good news: data isolation is already solid

Independent of all of the above, the actual database design is already safe:
every table this feature touches has correct tenant-level data isolation enforced
at the database layer, not just in application code. This part does not need
rework.

---

## 6. Recommendation

Path B is technically straightforward and the groundwork is already built — but it
carries a real recurring cost (CASA, annual) and a real engineering gap (per-tenant
rollout control, customer disclosure) that should be closed **before** it's turned on
for anyone, not after. There's no current business need forcing this — Path A (send)
covers today's use case on its own. Recommend treating Path B as a scoped, budgeted
project for whenever reply-sync becomes a real priority, using the AI feature's
per-tenant flag pattern as the template, rather than something to enable quickly.

---

## 7. Open Items From Today (tracked separately, not blocking)

- [ ] Upload app logo + set homepage URL on the Google consent screen.
- [ ] Finish the demo-video narration/caption pass.
- [ ] Submit for Google verification via the Verification Centre.
- [ ] Publish the app from Testing to In-Production once approved.
