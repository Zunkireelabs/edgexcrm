# Outreach Phase 0 — Email Send Spine + Compliance (DARK)

**Status:** briefed, not started
**Branch:** `feature/email-outbound-spine` (branch from the LATEST `origin/stage`)
**Next free migration number:** **211**
**Author:** Opus planning session, 2026-08-23
**Parent plan:** Outreach for `education_consultancy` — Phases 0–5 (see §11)

---

## §0 Rules of engagement — read before touching anything

1. **STOP AT REVIEW.** Build it, push the branch, open a **DRAFT** PR to `stage`. Do **NOT**
   merge. Do **NOT** self-approve. Do **NOT** promote to `main`. Report back and wait.
2. **Never touch the stage or prod database.** Migration 211 is applied to your **local Docker
   Supabase only** (`supabase start` → `./scripts/local-db-setup.sh`). Do not run
   `scripts/migrate-apply.sh`, do not connect to `dymeudcddasqpomfpjvt` or
   `pirhnklvtjjpuvbvibxf`. The migration rides the deploy pipeline when the PR merges — not before.
3. **This phase has NO VISIBLE SURFACE.** No page, no sidebar item, no dashboard change. Do not
   invent one. The verification for this phase is a real send to a safe test address plus a
   webhook replay (§9), not a screenshot of a UI.
4. **Do not refactor the existing transactional senders.** See §6.5 — this is the single most
   likely way to break production in this phase.
5. Rebase onto `origin/stage` again immediately before you report back.

---

## §1 What this is, and why it exists

EdgeX's Outreach feature does not send email. `markDraftSent`
(`src/industries/_shared/features/outreach/lib/engine.ts`) is log-only by design — a rep copies the
draft into their own inbox and clicks "mark sent". That worked for Zunkiree (it_agency, a handful of
reps, high-value B2B leads).

Admizz (`education_consultancy`) has **16,684 leads** and has decided to move their email campaigns
off Brevo into EdgeX. That requires two new surfaces — an email **blast** (Brevo parity) and an
**auto-sending drip** — and both need the same thing underneath: a real send path with a real
compliance layer.

**Phase 0 builds only that shared spine, dark.** No blast UI, no drip changes, no education
registration. Those are Phases 1–5 and each depends on this landing first.

### Why the compliance layer is not optional

There is currently **zero** email suppression anywhere in this codebase — no unsubscribe token, no
suppression table, no bounce handling, no Resend event webhook. I checked `src/lib/email/`,
`src/lib/inngest/` and every file in `supabase/migrations/`. Nothing.

Admizz's sending domain (`hello@admizz.com`) was DKIM-verified in Resend **eight days ago**
(2026-08-23, Tier 2 live on prod). Sending 16.7k marketing emails from a domain with that little
reputation history, with no unsubscribe header and no bounce suppression, is the textbook way to get
it blocklisted — and it would take their transactional mail down with it. The compliance work is not
paperwork bolted onto the send; it *is* the send.

### The reference implementation is SMS Phase 1/2

`src/lib/sms/` is the same problem solved once already, under review, with three HIGH-severity bugs
caught. **Read it before you write anything here** — specifically `flag.ts`, `env-guard.ts`,
`send.ts`, `suppression.ts`, `optout.ts`, and migrations `202`/`203`/`204`. This brief repeatedly
says "mirror the SMS shape"; that is a literal instruction, not a metaphor. §5 lists the three bugs
that build hit, restated as required regression tests for this one.

---

## §2 Scope

### In scope

- Migration **211** — `email_suppressions`, `email_unsubscribe_tokens`, `email_messages`, plus
  additive columns on the existing `tenant_email_settings`.
- `src/lib/email/outbound/` — the flag/sandbox gate, suppression, unsubscribe tokens, footer +
  header injection, and the single `sendQueuedEmailBatch()` orchestration path.
- `POST /api/webhooks/email/events` — Resend delivery/bounce/complaint webhook → suppression.
- Public one-click unsubscribe: `GET /e/u/[token]` (confirm page) + `POST` handler (the mutation).
- Tests, including the three mandated regression tests in §5.

### Explicitly OUT of scope — do not build these

- Any UI at all. No page, no component, no sidebar entry, no settings form.
- `email_blasts`, audience picker, recipient preview — that is **Phase 1**, migration 212.
- Changes to `markDraftSent` or the sequence engine — that is **Phase 2**.
- `channel = 'sms'` on sequence steps — that is **Phase 3**.
- Registering `outreach` for `education_consultancy` — that is **Phase 4**.
- Open/click tracking. We are not building an analytics pixel in this phase.
- Batching multiple recipients into one Resend API call. See §5.3 — this is a deliberate non-goal.

---

## §3 Migration 211

Additive only, wrapped in `BEGIN`/`COMMIT`, with a rollback block and before/after row counts in the
header comment. Follow `supabase/migrations/_TEMPLATE.sql` and match the commenting style of
migration 204 — that file explains *why* each design decision was made, and this one should too.

All three new tables get `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`, RLS
enabled, and the standard three policies (`get_user_tenant_ids()` for SELECT,
`is_tenant_admin(tenant_id)` for mutations, `auth.role() = 'service_role'` for full access) — copy
them from migration 204.

### 3.1 `email_suppressions`

The do-not-contact list. Direct analogue of `sms_suppressions`.

- `email TEXT NOT NULL` — **stored lowercased and trimmed**. Normalize on write in one helper, and
  say so in a `COMMENT ON COLUMN`. Do not rely on callers.
- `reason TEXT NOT NULL CHECK (reason IN ('unsubscribe','hard_bounce','complaint','manual','invalid'))`
- `source TEXT`, `lead_id UUID REFERENCES leads(id) ON DELETE SET NULL`,
  `created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL`, `note TEXT`, `created_at`
- `CREATE UNIQUE INDEX uq_email_suppression_tenant_email ON email_suppressions (tenant_id, email)`

**Suppression is per-tenant, not global.** Unsubscribing from Admizz must not silence the address for
Zunkiree. The unique index encodes that; do not "improve" it to a global index.

### 3.2 `email_unsubscribe_tokens`

- `token TEXT PRIMARY KEY`, `tenant_id`, `email TEXT NOT NULL`, `lead_id`, `used_at TIMESTAMPTZ`,
  `created_at`
- `CREATE UNIQUE INDEX uq_email_unsub_tenant_email ON email_unsubscribe_tokens (tenant_id, email)`

One **stable** token per (tenant, email) — not per message — exactly like `sms_optout_tokens`, and
for the same reason: someone must be able to unsubscribe from an email we sent them six months ago.
`used_at` is a record, **not a gate**: the link keeps working after it is used, or a second tap looks
like we ignored them.

Generate tokens with `randomBytes` the way `generateOptOutToken()` does. Get-or-create must be
race-safe via `INSERT ... ON CONFLICT DO NOTHING` then `SELECT` the winner — copy
`getOrCreateOptOutToken()`. Never pre-check-then-insert; a blast renders thousands of rows
concurrently.

### 3.3 `email_messages` — the idempotency backbone

The materialized per-recipient row. This is the table that makes a retried job safe, and it is the
most important object in the phase.

- `id`, `tenant_id`, `lead_id UUID REFERENCES leads(id) ON DELETE SET NULL`
- `source TEXT NOT NULL CHECK (source IN ('blast','sequence','manual'))`
- `source_id UUID` — nullable. The blast id (Phase 1) or enrollment/draft id (Phase 2).
- `to_email TEXT NOT NULL` (normalized), `to_email_stored TEXT` (the original `leads.email` value, for audit)
- `subject TEXT NOT NULL`, `body_html TEXT NOT NULL`, `body_text TEXT`
- `status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','delivered','failed','suppressed','bounced','complained','cancelled'))`
- `provider TEXT NOT NULL DEFAULT 'resend'`, `provider_message_id TEXT`
- `error_code TEXT`, `error_message TEXT`, `attempt_count SMALLINT NOT NULL DEFAULT 0`
- `sending_started_at TIMESTAMPTZ` — required by the reclaim rule in §5.2
- `sent_at`, `delivered_at`, `bounced_at`, `created_at`, `updated_at` + the `update_updated_at()` trigger

Indexes:

```sql
-- Idempotency backbone. Recipient rows are materialized UP FRONT; a retried or
-- re-run job re-INSERTs the same (source_id, lead_id) pairs and relies on
-- ON CONFLICT DO NOTHING here to guarantee we can never double-send a lead.
CREATE UNIQUE INDEX uq_email_message_source_lead
  ON email_messages (source_id, lead_id) WHERE source_id IS NOT NULL;

CREATE INDEX idx_email_messages_pending
  ON email_messages (tenant_id, status) WHERE status IN ('queued','sending');

CREATE INDEX idx_email_messages_lead ON email_messages (lead_id, created_at DESC);

-- The webhook's only lookup key. Without this every Resend event is a seq scan.
CREATE INDEX idx_email_messages_provider_id
  ON email_messages (provider_message_id) WHERE provider_message_id IS NOT NULL;
```

**A design tradeoff you should understand rather than "fix":** `source_id` is a generic nullable UUID
with no foreign key, where `sms_messages` uses a real `blast_id` FK. That is deliberate —
`email_blasts` does not exist until Phase 1, and a forward FK would either block this phase or force
us to build the blast table before the spine that sends it. We trade referential integrity for the
ability to land and test idempotency now. Note the tradeoff in the migration comment. If Phase 1
wants the FK back, it can add a `blast_id` column alongside.

### 3.4 `tenant_email_settings` — additive columns

Reuse the existing table (migration 045); do not create a new settings table.

- `bulk_email_enabled BOOLEAN NOT NULL DEFAULT false` — per-tenant grant for the bulk lane.
- `daily_send_cap INT NOT NULL DEFAULT 2000` — enforced by the spine (§4.6). A blown cap should
  throttle, never silently drop.

---

## §4 `src/lib/email/outbound/`

New folder. Do not scatter these into the existing flat `src/lib/email/`, which is already 17 files
of mixed transactional concerns.

### 4.1 `flag.ts`

Mirror `src/lib/sms/flag.ts` exactly, including its comments about *why* the polarity is what it is.

```ts
// Environment kill switch. Default OFF.
export function isEmailOutboundEnabled(): boolean {
  return process.env.EMAIL_OUTBOUND_ENABLED === "true";
}

// INVERTED on purpose, exactly like isSmsSandbox(): the safe state must be the
// DEFAULT, because the failure mode of getting this wrong is mailing 16,684
// real students. Any env that does not explicitly set EMAIL_OUTBOUND_SANDBOX=false
// stays sandboxed.
export function isEmailOutboundSandbox(): boolean {
  return process.env.EMAIL_OUTBOUND_SANDBOX !== "false";
}
```

Plus `isBulkEmailEnabledForTenant(tenantId)`, layered on the env switch. Read
`tenant_email_settings.bulk_email_enabled` (§3.4) — this one is a real column, not an
`entitlement_overrides` key, because the settings table already exists and is where every other
sending decision for a tenant lives.

### 4.2 `env-guard.ts`

Mirror `src/lib/sms/env-guard.ts`. Called from `sendQueuedEmailBatch()` **immediately before the
provider call**, so no code path exists between "recipients resolved from the DB" and
"resend.emails.send() invoked" that can skip it.

- Sandbox on → redirect every recipient to `EMAIL_TEST_RECIPIENTS` (comma-separated) and prefix the
  **subject** with `[SANDBOX intended: <original>]`.
- Sandbox on with `EMAIL_TEST_RECIPIENTS` empty → **throw**. Never fall through to the real
  recipient. The SMS version does exactly this; copy the error message shape.

### 4.3 `suppression.ts`

Mirror `src/lib/sms/suppression.ts` — `loadSuppressedEmails(db, tenantId, emails): Promise<Set<string>>`
and `suppressEmail(db, tenantId, params)`.

`loadSuppressedEmails` does **one query per batch, never one per recipient**. A 16k-recipient blast
must not issue 16k suppression lookups. Chunk the `.in()` — 16,684 emails in a single PostgREST `in`
filter will blow the URL length limit, which is a bug this codebase has already been bitten by twice
(see `project_counselor_empty_leads_undici_overflow`). Chunk at 500 and union the sets.

`suppressEmail` is idempotent via `upsert ... ignoreDuplicates`, so callers never pre-check.

### 4.4 `unsubscribe.ts`

- `getOrCreateUnsubscribeToken(db, tenantId, email, leadId)` — race-safe, per §3.2.
- `unsubscribeUrl(token)` → `${APP_URL}/e/u/${token}`.
- `injectUnsubscribe(bodyHtml, url)` — appends a visible footer link. **Every** message sent through
  this spine gets a visible link, regardless of the headers. Headers alone are not compliance; some
  clients never render them.

### 4.5 `headers.ts`

Every bulk message carries:

```
List-Unsubscribe: <https://APP_URL/e/u/TOKEN>, <mailto:unsubscribe@edgex.zunkireelabs.com>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

This is RFC 8058, and Gmail/Yahoo bulk-sender rules require it. Resend supports custom headers on
`emails.send`.

### 4.6 `send.ts` — `sendQueuedEmailBatch(tenantId, messageIds)`

The single orchestration path. Every future caller — Phase 1 blasts, Phase 2 sequence auto-send,
Phase 3 channel routing — goes through this function and only this function. Model it on
`sendQueuedBatch` in `src/lib/sms/send.ts`, which is the same function for the other channel.

Order of operations:

1. Load rows by id where `status IN ('queued','sending')`. (`'sending'` is included for the reclaim
   path — §5.2.)
2. **Suppression safety net.** One batched `loadSuppressedEmails` over the whole set. Anything
   suppressed → `status='suppressed'`, and `logger.warn` loudly. This should almost never fire
   because Phase 1's audience materialization is the product-facing filter — but it sits on the one
   line of code every send in the system passes through. Copy the comment from `sms/send.ts`
   explaining exactly that.
3. **Daily cap.** Count today's `sent` rows for the tenant against `daily_send_cap`. Over cap →
   leave the remainder `queued` and return a `throttled` count. Never drop, never silently succeed.
4. `resolveTenantSender(tenantId)` — already live, already returns `Admizz Education <hello@admizz.com>`
   for Admizz. Do not reimplement sender resolution.
5. Per row: get-or-create the unsubscribe token, inject the footer, build headers, flip to
   `'sending'` and stamp `sending_started_at`, apply the env guard, call Resend, write back
   `provider_message_id` + `status`.
6. Bounded concurrency (start at 5 in flight) so a 16k batch does not open 16k sockets. There is a
   concurrency helper at `src/lib/sms/concurrency.ts` — reuse it rather than writing a second one;
   promote it to a shared location if it is SMS-coupled.

Return `{ sent, failed, suppressed, throttled }`.

---

## §5 The three bug classes — mandated regression tests

SMS Phase 1 shipped three HIGH-severity bugs that review caught and the build did not self-report.
All three have an exact analogue here. **Each needs a test, and each test must be proved to FAIL
against the naive implementation before you accept it** — that is the standard the SMS credit-RPC
fix was held to, and it is the reason those bugs are not in production.

### 5.1 Double-send on retry (the SMS "non-idempotent reserve" analogue)

The SMS credit RPCs mutated the account *before* writing the ledger row, which made the unique index
decorative and double-debited on a retried Inngest step. The email analogue: materialize recipient
rows **before** any send, and let the unique index be the guarantee.

**Test:** materialize the same (source_id, lead_id) set twice; assert the row count is unchanged and
no row moved out of `queued`. Then run `sendQueuedEmailBatch` twice over the same ids and assert the
provider was called exactly once per row.

### 5.2 Stranded `sending` rows (the SMS "settle throws on retry" analogue)

If the process dies between `status='sending'` and the provider response, that row is stranded
forever — invisible to a `queued`-only query, never retried, never reported.

Required rule: a row in `'sending'` whose `sending_started_at` is older than **15 minutes** is
reclaimable, up to `attempt_count < 3`, after which it goes to `failed` with an explicit error code.

**Test:** insert a `sending` row with an old `sending_started_at`, assert it is picked up; insert one
with `attempt_count = 3`, assert it is not.

### 5.3 Attribution (the NEW-1 analogue)

In SMS, results were matched to rows **by array index**, and because Aakash returns `valid[]` and
`invalid[]` as separate arrays, one bad recipient shifted every later row onto another person's
message id — roughly 120 wrong rows per 4k blast, with no repair path.

**The structural fix here is to make the class unreachable: one row = one `resend.emails.send()`
call.** Never put more than one address in `to`, never use `cc`/`bcc`, and do not use Resend's batch
endpoint in this phase. Each call's response id belongs unambiguously to the row that made it.

**Test:** assert that a batch of N rows produces exactly N provider calls, each with exactly one
recipient, and that a failure on row 2 leaves rows 3..N correctly attributed.

If a later phase wants batching for throughput, it must attribute explicitly by recipient address and
carry its own regression test. Write that as a comment where the temptation will be.

---

## §6 Compliance rules

1. **GET must never unsubscribe.** `GET /e/u/[token]` renders a confirmation page; the mutation
   happens on `POST`. Mail scanners, link prefetchers and corporate security gateways follow every
   GET in an email — a mutating GET means people get silently unsubscribed by their own IT
   department. This is the same rule SMS Phase 2 encodes; mirror `src/app/(widget)/u/[token]/`,
   which already has the page + client-form split you need.
2. **RFC 8058 one-click is a POST** and must be honoured without a confirmation step. That is
   consistent with rule 1 — the mail client POSTs directly.
3. The unsubscribe page must work for an **unauthenticated stranger**, must not enumerate (an
   invalid token renders the same generic "link unavailable" page as an expired one), and must not
   leak the full email address — mask it the way the SMS page masks the phone.
4. **Suppression is checked twice**: at audience materialization (Phase 1's job) and again in
   `send.ts` (§4.6 step 2). Redundant on purpose.
5. **Do not route the existing transactional senders through this spine.** `send-invite.ts`,
   `send-consent.ts`, `send-lead-assigned.ts`, `form-autoresponder.ts` and `email-forward.ts` are
   transactional, are *correctly* exempt from unsubscribe, and must keep working exactly as they do
   today. Adding an unsubscribe footer to a password invite, or letting a marketing unsubscribe
   suppress a consent form, would be a production incident. If you find yourself editing any of
   those five files, stop — you have left the scope of this phase.

---

## §7 `POST /api/webhooks/email/events`

Model it on `src/app/api/webhooks/email/inbound/route.ts`, which already has the correct shape:
read raw bytes before any parse, svix-verify, fast-ack.

- **New, separate secret**: `RESEND_EVENTS_WEBHOOK_SECRET`. Do not reuse
  `RESEND_INBOUND_WEBHOOK_SECRET` — different Resend webhook, different signing key.
- Bad or missing signature → **403**, never process.
- Match the event to a row by `provider_message_id`. **Derive the tenant from that row**, never from
  the payload. The payload is attacker-controllable if the signature check is ever weakened.
- Handle: `email.sent`, `email.delivered` (stamp `delivered_at`), `email.bounced`,
  `email.complained` (→ `suppressEmail` with reason `complaint`, always, no threshold — a spam
  complaint is unambiguous). Ignore `email.opened` / `email.clicked` for now; no tracking this phase.
- **Bounce classification**: permanent/hard → suppress immediately with reason `hard_bounce`.
  Transient/soft → increment a counter, suppress only on the 3rd. If the payload's classification is
  ambiguous, **do not suppress**, and log loudly — wrongly suppressing permanently silences a real
  student, and that is worse than one extra retry.
- Unknown event type or unmatched message id → `200`, no-op. Never 500 on a webhook; Resend will
  retry and you will amplify your own problem.
- Always return an identical `200` body after verification, matched or not.

**Record the payload shapes you actually observe in an appendix to this file**, the way
`docs/SMS-PHASE1-BRIEF.md` §2 recorded the live-verified Aakash facts. Those observed facts are
authoritative over vendor documentation — the SMS build found the Aakash docs wrong on three
separate points.

### §7 appendix — observed bounce payload shape (2026-08-23)

Live-verified by sending a real message through the account's `RESEND_API_KEY` to AWS SES's public
bounce simulator address (`bounce@simulator.amazonses.com` — Resend sends over SES under the hood,
confirmed by `amazonses.com` in the DKIM/Received headers of every message this account sends), then
reading it back via `GET https://api.resend.com/emails/{id}`:

```json
{
  "last_event": "bounced",
  "bounce": {
    "message": "The recipient's email provider sent a hard bounce message, but didn't specify the reason for the hard bounce. We recommend removing the recipient's email address from your mailing list. Sending messages to addresses that produce hard bounces can have a negative impact on your reputation as a sender.",
    "type": "Permanent",
    "subType": "General",
    "diagnosticCode": ["smtp; 550 5.1.1 As requested: user unknown <bounce@simulator.amazonses.com>"]
  }
}
```

**Confirmed against this codebase's `classifyBounce()`**: `type: "Permanent"` matches the
`.includes("permanent")` (case-insensitive) check → `hard` → immediate suppression. This is the real
value, not an assumption from docs.

**Gap found**: `resend`'s shipped TS type (`node_modules/resend/dist/index.d.mts`, `EmailBounce`)
declares only `message`, `subType`, `type` — **`diagnosticCode` is not in the type but is present on
the real payload**. Harmless for this route (it isn't read), but don't trust the SDK's type as a
complete description of the payload if a future phase needs another bounce field.

**Not directly observed**: the *webhook event envelope* itself (`{type, created_at, data: {...,
bounce: {...}}}`) — no `email.bounced`-events webhook was registered on this Resend account (only the
existing `email.received` inbound webhook is, pointed at
`https://dev-lead-crm.zunkireelabs.com/api/webhooks/email/inbound`), and there is no way to receive a
real webhook call on an unreachable local dev box without standing up a public tunnel, which felt like
overreach for a phase that ships dark. The webhook replay in §9 below therefore wraps the REST-observed
`bounce` object (above) in the envelope shape from `resend`'s own `WebhookEventPayload` type
(`EmailBouncedEvent`), which is a reasonable inference — same SDK, same account, same event data
object reused for both the REST response and the webhook payload per Resend's docs — but is not itself
something this session watched arrive over the wire. Flagging this distinction explicitly rather than
letting "signed replay passed" read as "real webhook payload confirmed," since that's exactly the gap
this section warns against papering over.

---

## §8 Environment variables

New, all documented in whatever env reference this repo keeps:

| Var | Default | Meaning |
|---|---|---|
| `EMAIL_OUTBOUND_ENABLED` | `false` | Kill switch for the whole bulk lane |
| `EMAIL_OUTBOUND_SANDBOX` | **`true`** (anything but the literal `"false"`) | Redirect all recipients to the test list |
| `EMAIL_TEST_RECIPIENTS` | *(empty)* | Comma-separated sandbox redirect targets |
| `RESEND_EVENTS_WEBHOOK_SECRET` | *(empty)* | svix signing secret for the events webhook |

**Set none of these on stage or prod in this phase.** The feature ships dark. `RESEND_API_KEY`
already exists and is unchanged.

**`EMAIL_TEST_RECIPIENTS` must be supplied by Sadin.** Do not invent a test address, do not use any
address you find in the codebase, in a lead row, or in your own session context. Ask.

---

## §9 Gates — all must be green before you report back

- `npm run build` clean
- `npx eslint --max-warnings 50` clean (`npm run build` does not catch what CI's lint does — a
  build-clean branch has red-deployed here before)
- `npm run test` — full suite green, plus your new tests, including the three from §5
- `npx tsc --noEmit` clean
- Migration 211 applied to your **local** Supabase, with before/after counts recorded, and the
  rollback block verified to actually roll back
- **One real end-to-end send** with `EMAIL_OUTBOUND_SANDBOX=true` to the address Sadin gives you:
  confirm it arrives, the footer link is present, the `List-Unsubscribe` headers are on the received
  message (view source), clicking the footer link renders the confirm page **without** unsubscribing,
  and POSTing the form writes an `email_suppressions` row
- **One webhook replay**: feed a signed `email.bounced` payload at the events route and confirm the
  matching row flips and the suppression lands

Report the actual outputs. "Tests pass" is not a verification — green unit tests are not evidence the
feature works.

---

## §10 Deliverable

Push `feature/email-outbound-spine`, open a **DRAFT** PR to `stage`, and write a report covering:

- what shipped, file by file
- the three §5 tests, and **proof each one fails against the naive implementation**
- the observed Resend webhook payload shapes (§7 appendix)
- migration 211's before/after counts on local, and confirmation it is **local-only** — state
  explicitly that stage and prod ledgers are untouched
- anything you found that this brief got wrong. This brief was written from a read of the code, not
  from building it; if a decision here turns out to be unworkable, say so rather than quietly
  routing around it.

Then stop.

---

## §11 Where this sits

| Phase | What | Migration |
|---|---|---|
| **0** | **Email send spine + compliance (this brief, dark)** | **211** |
| 1 | Email blast — the Brevo replacement (audience, preview, send-confirm) | 212 |
| 2 | Drip learns to send + auto-send on `due_at` (Inngest, daily cap, kill switch, dry-run) | 213 |
| 3 | Channel per step — relax `email_sequence_steps.channel` beyond `'email'` | 214 |
| 4 | Register `outreach` for `education_consultancy` + bulk enroll from a Stage/filter | — |
| 5 | `/sms` collapses into Outreach as a channel view | — |

Open business items tracked separately, none blocking Phase 0: consent basis for emailing Admizz's
16,684 leads; Resend plan limits for a 16.7k blast; the `/campaigns` naming collision with education's
existing referral feature.

---

## §12 AMENDMENT 1 — 2026-08-23, after the Phase 0 checkpoint

**§3.3's partial unique index was wrong. Fix it in migration 211 before the PR opens.**

The executor correctly found that PostgREST's `on_conflict` cannot target a partial unique index
(it takes column names only, and Postgres cannot infer a partial index without its `WHERE`
predicate). The proposed response — defer to Phase 1 — is not acceptable, because the consequence is
worse than it first appears:

The §5.1 test proves the duplicate is rejected by **raising 23505**, not by being absorbed via
`ON CONFLICT DO NOTHING`. A chunked `.insert()` of an array is a single statement, so when Phase 1
materializes ~16,684 rows in chunks, **one duplicate aborts its entire chunk** — a re-run of a
partially-completed materialization inserts nothing rather than skipping what already exists. The
index is then decorative for its actual purpose, which is precisely the SMS Phase 1 bug class this
brief's §5 exists to prevent.

**Change:**

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_message_source_lead
  ON email_messages (source_id, lead_id);   -- was: WHERE source_id IS NOT NULL
```

Postgres defaults to NULLS DISTINCT, so rows with a NULL `source_id` still never conflict with one
another — behaviourally identical to the partial index for our purposes, while remaining targetable
by `.upsert(..., { onConflict: "source_id,lead_id", ignoreDuplicates: true })`.

Migration 211 is local-only and unapplied on stage and prod, so amend the file in place rather than
adding a 212 — but re-verify the idempotent re-run and the rollback afterwards.

**Extend the §5.1 test** to cover the case that actually matters: insert a chunk of N rows where one
(source_id, lead_id) pair already exists, via the same `.upsert()` call the real materialization path
will use, and assert the other N-1 rows land. Prove it fails against the partial index first.

**Also note in the migration comment:** `lead_id` is nullable (`ON DELETE SET NULL`), and a NULL
`lead_id` likewise never conflicts. Idempotency therefore holds only while `lead_id` is non-null,
which materialization always sets. Write that down so Phase 1 does not discover it the hard way.
