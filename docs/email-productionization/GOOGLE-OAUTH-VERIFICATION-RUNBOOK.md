# Google OAuth Verification Runbook (Path A — send-only)

**Who runs this:** Sadin (Google Cloud Console + Search Console work — cannot be automated).
**Goal:** move the EdgeX Gmail OAuth app from **Testing** → **In production / Verified**, so
any customer can connect their Gmail and **send** email from EdgeX with a stable, non-expiring
connection and no "unverified app" warning.

**Scopes being verified (Path A):**
- `https://www.googleapis.com/auth/gmail.send` — **Sensitive**
- `https://www.googleapis.com/auth/userinfo.email` — non-sensitive
- `openid` (added automatically) — non-sensitive

**Verification type:** **Sensitive-scope** OAuth verification (brand + consent-screen review
+ a demo video). **NO CASA / no security assessment / no cost** — that only applies to the
restricted `gmail.readonly` scope, which Path A does not request. (See § Path B for when you
add reply-sync later.)

**Expected timeline:** typically a few days to ~2–4 weeks of Google review, often with one or
two rounds of email clarification. Start early — it runs async in the background; your code
can ship to stage/prod meanwhile (users just can't connect in prod until verified, or you add
them as test users in the interim).

---

## Does the domain matter? — Yes. This is the part people get wrong.

Your prod app is at **`edgex.zunkireelabs.com`**. For OAuth verification:

- **Registrable domain = `zunkireelabs.com`.** That is the domain you list and verify.
  Subdomains (`edgex.`, `lead-crm.`, `www.`) are automatically covered once the parent is
  verified — you do **not** verify each subdomain separately.
- You must **own and verify `zunkireelabs.com`** in **Google Search Console**, signed in with
  the **same Google account** that owns the Google Cloud project / OAuth consent screen. If a
  different Google account owns the GCP project than owns the domain, either move the project
  or add that account as a verified owner in Search Console. **This is a hard prerequisite —
  verification cannot complete without it.**
- Everything on the consent screen (homepage, privacy policy, redirect URI) must live on
  `zunkireelabs.com` or a subdomain of it. Mixed/other domains cause rejection.
- Brand consistency: the **app name**, **logo**, homepage, and domain are reviewed together.
  App name "EdgeX" on a `zunkireelabs.com` domain is fine — just make the homepage clearly
  present the product, and keep the consent-screen app name stable (e.g. "EdgeX by Zunkiree
  Labs" or just "EdgeX"). Don't rename it mid-review.

---

## Prerequisites checklist (do these first)

- [ ] **Access to the Google Cloud project** that holds the OAuth client (the one whose
      `GOOGLE_CLIENT_ID` prod uses). Confirm you're an Owner/Editor of it.
- [ ] **A public homepage** at `https://zunkireelabs.com` (or `https://edgex.zunkireelabs.com`)
      that describes EdgeX. Must be reachable, not behind login.
- [ ] **A public privacy policy** URL that is live and reachable. The app already ships a
      privacy page (`/privacy`) → `https://edgex.zunkireelabs.com/privacy`. Confirm it loads
      publicly and that it **discloses how EdgeX uses Google user data** and includes a
      **Google API Services Limited Use** statement (see § Privacy policy language).
- [ ] **App logo** — square PNG, 120×120px, under 1MB, no copyrighted content.
- [ ] **A support email** and a **developer contact email** (can be the same).
- [ ] **Domain ownership verified in Search Console** for `zunkireelabs.com`.

---

## Step-by-step

### 1. Verify domain ownership (Search Console)
1. Go to <https://search.google.com/search-console> signed in with the Google account that
   owns the GCP project.
2. Add property → **Domain** → `zunkireelabs.com`.
3. Verify via the DNS TXT record it gives you (add the TXT record at your DNS/registrar for
   zunkireelabs.com). Wait for it to confirm (minutes–hours for DNS propagation).

### 2. Configure the OAuth consent screen
GCP Console → **APIs & Services → OAuth consent screen** (for the correct project):
1. **User type: External.** (Internal is only for a single Google Workspace org — not
   applicable, since customers connect their own external Gmail accounts.)
2. **App information:**
   - App name: `EdgeX` (or `EdgeX by Zunkiree Labs`) — keep stable.
   - User support email.
   - App logo: upload the 120×120 PNG.
3. **App domain:**
   - Application home page: `https://zunkireelabs.com` (or `https://edgex.zunkireelabs.com`).
   - Application privacy policy link: `https://edgex.zunkireelabs.com/privacy`.
   - (Terms of service optional but nice.)
   - **Authorized domains:** `zunkireelabs.com`.
4. **Developer contact information:** your email.
5. Save.

### 3. Add scopes
On the consent screen **Scopes** step → Add or remove scopes → add exactly:
- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/userinfo.email`
- (`openid` — usually auto-added; fine.)

**Do NOT add `gmail.readonly`** for Path A — it would drag you into Restricted + CASA.
`gmail.send` will be flagged as **Sensitive** — that's expected and correct.

### 4. Confirm the OAuth client's redirect URI
GCP Console → **APIs & Services → Credentials** → your OAuth 2.0 Client ID (the prod
`GOOGLE_CLIENT_ID`) → **Authorized redirect URIs** must include **exactly**:

```
https://edgex.zunkireelabs.com/api/v1/email/inboxes/callback
```

It must match the running prod `NEXT_PUBLIC_APP_URL` + `/api/v1/email/inboxes/callback`
character-for-character (https, no trailing slash, correct subdomain). If prod's
`NEXT_PUBLIC_APP_URL` is `lead-crm.zunkireelabs.com` instead, register that one — the two
must agree. (See PROD-CONFIG-CHECKLIST.md.)

### 5. Add test users (optional, to use it before verification finishes)
Consent screen → **Test users** → add the specific Gmail addresses you want to let connect
while verification is pending. Test users can connect immediately (with the 7-day token-expiry
caveat). Good for piloting with a few known users before Google approves.

### 6. Publish + submit for verification
1. Consent screen → **Publishing status** → **Publish app** → confirm to move from Testing to
   "In production."
2. Because a **Sensitive** scope is present, Google will require verification. Click
   **Prepare for verification** / **Submit for verification** and fill in:
   - **Scope justification** for `gmail.send` (see § Scope justification text below).
   - **Demo video** URL (see § Demo video).
3. Submit. Google responds by email; expect one or more clarification rounds. Reply promptly —
   stalled threads are the main cause of long timelines.

### 7. While you wait
- The app works for **test users** (added in step 5) immediately, 7-day token expiry.
- Once **verified**, publishing status is "In production," any user can connect, tokens stop
  expiring on the 7-day testing clock, and the unverified-app warning is gone.

---

## Scope justification text (paste/adapt in the verification form)

> EdgeX is a multi-tenant CRM. The `gmail.send` scope is used solely to send emails that the
> signed-in user composes inside EdgeX, sent from their own connected Gmail account on their
> own behalf (e.g. replying to a sales/education lead). EdgeX does not read, store, or process
> the contents of the user's mailbox. Sent messages are logged in the user's own EdgeX tenant
> for their record-keeping. We do not transfer Google user data to third parties, do not use it
> for advertising, and do not use it to train generalized AI/ML models. Use complies with the
> Google API Services User Data Policy, including the Limited Use requirements.

## Demo video (required for Sensitive scopes)

Record a short (1–3 min) screen capture, upload **unlisted to YouTube**, paste the link:
1. Show the EdgeX app and where the user starts the "Connect a Gmail inbox" flow
   (Settings → Communications).
2. Show the **Google OAuth consent screen** clearly displaying the app name and the
   **exact scopes** requested (`gmail.send`, email).
3. Show the granted result and then the feature **using** the scope: composing an email in a
   lead's Activity → Emails → **Compose Email** and sending it.
4. Narrate that the scope is used only to send user-composed email.

## Privacy policy language (must be present at the privacy URL)

The privacy policy must:
- Disclose that EdgeX accesses Google user data via the `gmail.send` scope to send email on
  the user's behalf.
- Explain what is stored (sent-email records in the user's tenant) and that mailbox contents
  are not read.
- Include the **Google API Services User Data Policy — Limited Use** disclosure, e.g.:
  > "EdgeX's use and transfer of information received from Google APIs will adhere to the
  > Google API Services User Data Policy, including the Limited Use requirements."

> Action: confirm `https://edgex.zunkireelabs.com/privacy` contains the above. If it doesn't,
> update the privacy page (`src/app/(main)/privacy/page.tsx`) before submitting.

---

## Path B (future) — adding reply-sync back with CASA

When you later build the AI "monitor replies" phase and want inbound reply-sync:
1. Add `https://www.googleapis.com/auth/gmail.readonly` back to the scopes (code + consent
   screen). This flips the app into the **Restricted** tier.
2. Google will require a **CASA Tier 2 security assessment** (annual):
   - Restricted-scope verification adds a security-assessment requirement because you store/
     transmit restricted-scope data on servers.
   - **CASA Tier 2** = run an **approved security scanner** against the app and submit results
     to an **authorized third-party assessor lab** (this is the self-scan tier, *not* the
     full Tier 3 penetration test). You must also meet data-handling requirements — encryption
     at rest (already satisfied via `INBOX_TOKEN_ENC_KEY`), deletion, incident response, etc.
   - Ballpark **$500–$2,000/yr** via a lab; a few weeks; **renewed annually**.
3. Set `EMAIL_REPLY_SYNC_ENABLED=true` and have users reconnect (to grant readonly).

Budget the annual CASA cost + assessment effort as part of the Phase-5 AI-monitor roadmap,
not before.

---

## Sources
- Gmail API scope classifications — <https://developers.google.com/workspace/gmail/api/auth/scopes>
- Restricted scope verification — <https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification>
