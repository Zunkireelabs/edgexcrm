# Google OAuth Verification — Submission Plan

> Companion to Track B in `docs/CONNECTED-INBOXES-PRODUCTION-BRIEF.md`. That doc tracks status; this doc has the actual content to submit. Everything here targets the **narrowed scope decision** (`gmail.readonly` + `gmail.send`, sensitive tier — no CASA Tier 2 audit required), shipped in PR #222 (`feature/google-oauth-verification-readiness`). If that decision changes back to the broad `mail.google.com` scope, the scope justification below needs a rewrite and a CASA Tier 2 assessment gets added to the timeline.

**Where this happens:** Google Cloud Console → project `Orca Auth` → APIs & Services → OAuth consent screen. Only someone with access to that project (Sadin) can actually click through this — my part ends at having every field's content ready to paste.

---

## 1. Scope justification (paste into the verification form)

Google's verification form asks for a written justification per sensitive/restricted scope requested. Two scopes need one; `userinfo.email` is non-sensitive and doesn't require justification.

**For `https://www.googleapis.com/auth/gmail.readonly`:**

> EdgeX CRM is a business lead-management platform. It offers an opt-in feature, "Connected Inboxes," that lets an individual team member connect their own Gmail account so that email conversations with a business lead stay visible inside the CRM alongside that lead's other activity. We request `gmail.readonly` specifically to detect and read *new replies* to an email thread the user already started from within EdgeX — using the Gmail History API (`users.history.list`) to poll for new messages on a thread, then `users.messages.get` to fetch the full message so it can be displayed back in the CRM's conversation view. This is read access to a small, user-initiated subset of their mailbox (their own sent threads with business contacts), not bulk mailbox access, and is never used for any purpose outside displaying that reply to the user inside their own CRM account.

**For `https://www.googleapis.com/auth/gmail.send`:**

> We request `gmail.send` so that a user can send an email to a business lead directly from inside EdgeX, using their own Gmail identity (`users.messages.send`), rather than an unrelated no-reply address. This preserves normal email etiquette for a sales/consulting relationship — the recipient sees an email from the real person they're working with, in a thread they can reply to normally. Sending is always a single, explicit user action (composing and clicking Send inside the CRM); nothing is sent automatically or in bulk without the user's direct action.

**Product context, if the form has a general "how is this scope used" free-text field:**

> Scopes are requested per-user, opt-in only, from Settings → Communications inside EdgeX. A user must explicitly click "Connect a Gmail inbox" and complete Google's consent screen themselves — an administrator cannot connect Gmail on another user's behalf. Tokens are encrypted at rest (AES-256-GCM). A user can disconnect at any time, which deletes the stored credential and revokes the grant on Google's side (`oauth2.googleapis.com/revoke`). Full technical + privacy detail: `https://edgex.zunkireelabs.com/privacy` (see the "Google user data — Connected Inboxes" section).

---

## 2. Demo video — shot list / script

Google requires a screen-recording demo showing the OAuth flow end-to-end and how the scope is actually used in-app. **This part needs an actual human at a keyboard** — I can't record it. Suggested script, ~2–3 minutes, one continuous take, no narration required (captions/on-screen text are fine if you'd rather not talk):

1. **(0:00–0:15) Start logged into EdgeX** as a real user, land on `/settings`, scroll to the **Communications** panel showing "Connected Inboxes."
2. **(0:15–0:30) Click "Connect a Gmail inbox."** Show the redirect to Google's real OAuth consent screen — this is the critical shot Google's reviewers look for, showing your actual consent screen (app name, logo, and the two scopes being requested) as end users will see it.
3. **(0:30–1:00) Complete the Google consent flow** with a real test Google account — sign in, see the scope-grant screen listing what EdgeX is asking for, click Allow.
4. **(1:00–1:20) Land back in EdgeX**, show the newly connected inbox appearing in Settings with its email address and a "connected" status.
5. **(1:20–2:00) Open a lead's detail page**, show the Emails tab, compose and send a real email to a test recipient from the connected Gmail address. Point out (via caption or narration) that this uses `gmail.send`.
6. **(2:00–2:40) Have the test recipient reply** from their own email client (can be sped up / cut to "a few minutes later"), then refresh the lead's Emails tab in EdgeX and show the reply appearing in the same thread. Point out this uses `gmail.readonly`.
7. **(2:40–3:00) Show the Disconnect flow** — Settings → Communications → Disconnect — to demonstrate revocation is user-controlled and immediate.

Record at 1080p, screen only (no need to show your face), upload unlisted to YouTube (Google's standard requirement — the review team needs a stable link, not a raw file upload).

---

## 3. Consent screen branding — fields to confirm

These are Sadin's call per the original brief, but here are sensible defaults pre-filled so it's a quick confirm-or-change rather than starting blank:

| Field | Suggested value | Notes |
|---|---|---|
| App name | `EdgeX CRM` | What end users see on the consent screen (`"EdgeX CRM wants to access your Google Account"`) |
| User support email | `privacy@zunkireelabs.com` | Must be an email you (Sadin/Zunkiree) control — shown to users if they have questions |
| App logo | `public/zunkireelabs-icon.png` (400×400, already square) | Meets Google's ≥120×120 square requirement as-is; Google may downscale it for display |
| App domain / authorized domain | `zunkireelabs.com` | Must own this domain in Search Console under the same Google account as the Cloud project |
| Application home page | `https://edgex.zunkireelabs.com` | Or `https://edgex.zunkireelabs.com/login` if Google wants a more specific landing page |
| Application privacy policy | `https://edgex.zunkireelabs.com/privacy` | **Live now** — shipped in PR #222 |
| Application terms of service | *(not yet built)* | Optional field in Google's form — can be left blank for now, or flag if you want a ToS page drafted too |
| Developer contact email(s) | `privacy@zunkireelabs.com` | Where Google sends review status/questions — check this inbox regularly once submitted |

---

## 4. Submission steps (Google Cloud Console)

1. Confirm `zunkireelabs.com` is verified in [Google Search Console](https://search.google.com/search-console) under the same Google account that owns the `Orca Auth` Cloud project — required before Google will accept it as an authorized domain.
2. Cloud Console → `Orca Auth` project → **APIs & Services → OAuth consent screen** → fill in / confirm the branding fields from §3 above.
3. **APIs & Services → OAuth consent screen → Scopes** → confirm the app requests exactly `gmail.readonly`, `gmail.send`, `userinfo.email` (matches the code as of PR #222 — nothing broader).
4. Paste the justification text from §1 into the scope-justification field(s) the form presents for the two sensitive scopes.
5. Upload the demo video link from §2.
6. Submit for verification.
7. **Wait.** Google's typical turnaround is 1–2 weeks for sensitive-scope-only apps (no CASA involved on this path) — check the developer contact inbox for requests for more info, which restart the clock if not answered promptly.
8. Once approved: the ~100-user cap and the "unverified app" warning both go away automatically — no further action needed.

---

## Status

- [x] Scope narrowed to `gmail.readonly` + `gmail.send` in code (PR #222).
- [x] Privacy policy live at `/privacy` with the required Limited Use disclosure.
- [x] Scope justification text drafted (§1).
- [x] Demo video script drafted (§2) — **recording itself still needs a human**.
- [ ] Consent screen branding fields confirmed by Sadin (§3).
- [ ] `zunkireelabs.com` domain ownership verified in Search Console.
- [ ] Submitted for verification.
- [ ] Approved — cap + warning removed.
