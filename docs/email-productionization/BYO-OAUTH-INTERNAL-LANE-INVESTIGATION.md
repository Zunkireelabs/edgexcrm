# Investigation — BYO-OAuth "Internal" lane for `gmail.readonly`

**Status:** OPEN INVESTIGATION. Not a build brief. Produces a go/no-go.
**Written by:** Opus planner session, 2026-07-30
**Unparks:** memory `project_byo_oauth_internal_lane` (parked by Sadin 2026-07-28,
with the note "revisit before building Phase 2 slice A"). Slice A is now built and
smoke-passed on stage, so this is the moment.
**Blocks:** the prod promotion of slice A (BCC dropbox) and any further investment
in token-based lanes.

---

## 1. The question

HubSpot shows a lead a **normal reply address** because HubSpot **reads the rep's
mailbox** over the Gmail API. It never rewrites `Reply-To`, so there is no token
anywhere and no BCC ritual for the rep to remember. That requires
`https://www.googleapis.com/auth/gmail.readonly`, which Google classifies as a
**restricted scope** → OAuth verification → CASA Tier 2 security assessment,
~$500–4,500/yr. That was settled as **"skip"** on 2026-07-28, which is why EdgeX has
the token lanes at all.

**But:** Google exempts apps configured with **Internal** user type — apps whose
users all belong to a single Google Workspace organization — from that review. All
three EdgeX tenants are on Google Workspace. If the exemption holds in the shape
EdgeX needs, the Reply-To token and the BCC dropbox are a **bridge**, not the
destination.

**Deliverable of this investigation:** a one-page go/no-go answering "does the
Internal lane give us HubSpot's behavior at acceptable cost, for enough of our
users, to be worth building?" — and if go, a phased build brief.

---

## 2. What is already established (desk research, needs console confirmation)

Google's own documentation states that for apps used only internally by a Google
Workspace organization, **scopes are not listed on the consent screen and use of
restricted or sensitive scopes does not require further review by Google**.
"Internal use within an organization" appears explicitly in Google's list of
verification exceptions, alongside personal use, dev/test/staging, and
service-owned data. Internal user type is set on the OAuth consent screen
configuration.

Two caveats found in the same sources that must be resolved before trusting this:

- One Google page states that an app targeting only a Workspace/Cloud Identity
  organization via **domain-wide installation** skips *brand* verification but
  **still requires app verification if it uses restricted or sensitive scopes**.
  That is a different configuration from Internal user type, but the two are easy
  to conflate and the distinction decides this whole question.
- The 100-user testing cap and the 7-day refresh-token expiry are properties of
  **Testing** publishing status, not Internal user type. Do not let a console
  screenshot showing "Testing" be read as evidence about Internal.

Sources:
- [Restricted scope verification — Google for Developers](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Configure the OAuth consent screen and choose scopes — Google Workspace](https://developers.google.com/workspace/guides/configure-oauth-consent)
- [Restricted Scopes — Google Cloud Console Help](https://support.google.com/cloud/answer/13464325?hl=en)
- [Choose Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Google verification & security assessment guide — Nylas](https://developer.nylas.com/docs/provider-guides/google/google-verification-security-assessment-guide/)

---

## 3. The constraint that shapes everything: Internal is *one org per Cloud project*

An OAuth client marked **Internal** can only be consented to by users **in the
Workspace organization that owns the Cloud project**. EdgeX is a multi-tenant SaaS
spanning three *different* organizations (`zunkireelabs.com`, `admizz.org`,
`mobilise.agency`). So there are two candidate shapes, and only one of them works:

| Shape | Description | Verdict |
|---|---|---|
| **A — EdgeX's own project set to Internal** | Flip the existing EdgeX Cloud project to Internal user type. | **Dead.** Only serves `zunkireelabs.com` users. Admizz and Mobilise reps could not consent at all. |
| **B — BYO-OAuth** | Each tenant creates a Cloud project + OAuth client **inside their own Workspace**, marks it Internal, enables the Gmail API, and pastes `client_id` / `client_secret` into EdgeX. EdgeX stores per-tenant OAuth credentials and uses the tenant's own client for that tenant's reps. | **The actual lane.** This is what "BYO-OAuth" means and why the parked memory is named that. |

Shape B moves the verification burden onto each tenant's own org — where the
exemption applies — at the cost of a per-tenant setup ritual and a real chunk of
EdgeX engineering (see §6).

### The finding that stops "Internal obsoletes the BCC dropbox"

**Reps sending from consumer `@gmail.com` addresses can never be covered by an
Internal app.** A consumer Google account is not a member of any Workspace
organization, so an Internal OAuth client cannot grant it consent. This is not
hypothetical: **Sadin's own sending mailbox is `shrestha.sadin007@gmail.com`**, a
consumer account, while his login is `sadin@zunkireelabs.com`. The same mismatch is
what broke the BCC sender guard (see `SLICE-A-GUARD-REPLYTO-FIX-BRIEF.md`).

So even in the best case where the exemption holds perfectly, the Internal lane
covers **Workspace mailboxes only**. Every rep on a personal Gmail still needs a
token lane. Conclusion to carry into the decision: the Internal lane can become the
*preferred* lane, but the BCC dropbox and Reply-To token remain the fallback for
consumer mailboxes. "Obsoletes" is too strong — **"demotes to fallback"** is the
accurate framing, and that changes the ROI math.

---

## 4. Questions to answer, with owners

**Already settled, do not re-litigate** (verified in code 2026-07-30): EdgeX currently
requests **only** `gmail.send` + `userinfo.email`
(`api/v1/email/inboxes/connect/route.ts:38`). There is **no read capability today** —
`gmail.readonly` was deliberately removed, and `email-poll.ts` survives only
flag-gated behind `EMAIL_REPLY_SYNC_ENABLED` with no scope to run on. So the
cheap "maybe we can already read Sent mail" escape hatch does not exist; a new
restricted scope really is required for the HubSpot behavior.

### [SADIN-CONSOLE] — only Sadin can do these

0. **The known first blocker.** On the `Orca Auth` project the **"Make internal"
   button was greyed out** — which usually means the Cloud project is not owned by
   a Workspace org. Resolve this before anything else: either move `Orca Auth`
   under the `zunkireelabs.com` org, or create a fresh project inside it. If
   Internal cannot be selected at all, the rest of this investigation is moot.
1. In a Workspace-owned Cloud project with consent screen **User type = Internal**
   and publishing status **In production** (not Testing): can you add
   `gmail.readonly` to the scope list and save **without** being routed into a
   verification submission or a CASA questionnaire? Screenshot the scope table and
   the publishing-status panel.
2. Complete one real OAuth consent for `gmail.readonly` as a `zunkireelabs.com`
   user against that client. Record: does the consent screen show an unverified-app
   warning? Does the refresh token still work **after 8+ days** (the decisive test
   for the 7-day expiry — a calendar reminder, not a same-day check)?
3. Confirm whether a **Workspace admin** can restrict or block third-party app
   access to Gmail data org-wide (API controls → app access control), and whether
   Admizz / Mobilise admins have such a restriction in place today. An Internal app
   still answers to org policy.
4. Ask one non-Zunkiree tenant admin (Admizz is the realistic candidate) whether
   they would actually create a Cloud project and paste OAuth credentials into
   EdgeX. **This is the real feasibility gate.** If the answer is "no" or "who
   would do that", shape B dies on adoption regardless of what Google permits.

### [SONNET-SPIKE] — small, throwaway, no product code

5. Prove the per-tenant client works end-to-end: a local spike that runs the OAuth
   flow against a *second*, tenant-owned `client_id`/`client_secret` pair and calls
   `users.messages.list` with `gmail.readonly`. Answers "is per-tenant OAuth
   credential injection mechanically fine with `googleapis`" — expected yes, but
   confirm before designing around it.
6. Inventory what actually breaks if `client_id` becomes per-tenant: grep every
   construction site of the OAuth client (`createOAuth2Client`,
   `refreshAccessTokenIfNeeded`, the `inboxes/callback` route, `email-poll`) and
   list each place that reads a global `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
   Orient with the code graph first, then read only what it points at.

### [OPUS] — mine

7. Design the storage seam for per-tenant OAuth credentials (encryption at rest —
   reuse `token-crypto.ts`; RLS; who can read/write; rotation) and the
   reconnect/failure UX.
8. Design the two-lane routing rule: given a rep, which lane applies (Workspace
   mailbox with a tenant OAuth client → read lane; anything else → token/BCC lane),
   where that decision lives, and what the rep sees when their mailbox is not
   eligible. Two lanes is the permanent end state (§3), so the seam matters more
   than either lane.
9. Reconcile with the Phase-3 `MailboxAdapter` seam already recorded in
   `project_email_productionization` — the Internal lane should land as an adapter
   behind that seam, not as a parallel code path.

---

## 5. Decision criteria — what "go" requires

All four must hold:

1. Google permits `gmail.readonly` under Internal + In-production with **no**
   verification submission and **no** CASA (Q1 confirmed, screenshotted).
2. Refresh tokens survive past 7 days (Q2 confirmed on the calendar, not assumed).
3. At least one non-Zunkiree tenant admin says they would genuinely do the setup (Q4).
4. §4 Q8 shows a real capability gap — i.e. the current polling scope does *not*
   already give us enough to drop the Reply-To rewrite.

If (1) or (2) fails → **no-go**, token lanes are the destination, promote slice A
and close this out.
If (3) fails → **partial go at best**: build it for Zunkiree/dogfood only and keep
token lanes as the shipped product path. Weigh hard against the maintenance cost of
two lanes.
If (4) fails → **stop and reroute**: the win is available far cheaper. (Already
answered "no cheaper route exists" as of 2026-07-30 — see the settled note in §4 —
so treat this gate as passed unless the scope situation changes.)

### Cheaper prior step, from the parked spike plan

The parked memory already contains a ~1-session spike that answers gates 1 and 2
empirically rather than by reading docs: make/create an Internal project under
`zunkireelabs.com`, mint an Internal OAuth client with the stage redirect URI, point
stage at it on a **throwaway branch** that restores `gmail.readonly`, connect
`hardik@zunkireelabs.com`, un-gate `EMAIL_REPLY_SYNC_ENABLED`, then send → reply and
confirm the poller syncs it with **no Reply-To token**. Run that before designing
anything. Cost of the spike is one session; cost of being wrong about the exemption
is a multi-week build on a false premise.

---

## 6. Rough cost if we build it (for the go/no-go, not a plan)

- Per-tenant OAuth credential storage + encryption + RLS + admin UI to enter and
  rotate them.
- Every OAuth-client construction site becomes tenant-parameterized (Q6 output).
- A tenant-admin setup wizard, plus documentation good enough that a non-technical
  admin can create a Cloud project — realistically the largest single cost, and the
  one most likely to be underestimated.
- Reading Sent mail to attribute outbound automatically: dedup against
  EdgeX-authored sends (the same problem smoke test T4 is currently blocked on),
  plus backfill semantics.
- **Two lanes forever**, because of the consumer-Gmail finding in §3: per-tenant
  read lane for Workspace mailboxes, token/BCC lane for everyone else. Ongoing
  complexity, not a one-time build.

Against that: no CASA fee, no annual reassessment, real addresses in both
directions, and no rep training. The upside is genuinely large — the question is
whether §5's four gates hold.

---

## 7. Sequencing note

Items 1–3 of the post-smoke fix list (`SLICE-A-GUARD-REPLYTO-FIX-BRIEF.md`) proceed
**in parallel with this investigation** and do not depend on its outcome — the
sender-guard gap makes the dropbox unusable for every rep right now, and the
bridge has to work regardless of how long the bridge lasts. What **is** held on
this answer: smoke test T4, and the prod promotion of slice A + migration 192.
Promoting the dropbox to prod means teaching reps a BCC workflow; do not teach it
if it is weeks from being demoted to a fallback.
