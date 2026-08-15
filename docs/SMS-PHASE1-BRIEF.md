# BRIEF — SMS Phase 1: sending core + credit ledger (dark, no UI)

**For:** Sonnet executor session
**From:** Opus planning session, 2026-08-15
**Plan of record:** the approved SMS plan (preflight + Phases 1–6)
**Status:** executed → PR #390 → reviewed in `docs/SMS-PHASE1-REVIEW.md`

> **Provenance note.** This file was **reconstructed on 2026-08-15** from the approved plan and
> from the merged content of branch `feature/sms-phase1-core` @ `9dc79879`, after the original was
> lost before it was ever committed. Every provider fact in §2 was re-derived from the preflight
> captures recorded in that branch's code and commit messages, not from memory. §3 onward describes
> what was actually built rather than what was originally asked for — where the two diverged, the
> divergence is called out inline. Treat §2 as authoritative; treat the rest as an accurate record
> of the shipped shape.

---

## 1. Why this phase exists, and why it isn't the UI

EdgeX has never sent an outbound message. Outreach looks like it does, but `markDraftSent`
(`src/industries/_shared/features/outreach/lib/engine.ts:294`) is log-only — it writes
`sent_via: 'manual_copy'` and the rep pastes the draft into their own inbox by hand.

SMS is therefore **EdgeX's first real send**: real money leaving a real prepaid pool, real
compliance exposure, real partial-failure states, and a worst case of texting 17,334 real Admizz
students by accident. The deliverable of this phase is consequently the **sending core**, not a
screen. Nothing in Phase 1 is reachable from the app — no page, no sidebar entry, no API route, no
Inngest function. Sadin will open localhost and see nothing new, and that is the expected outcome.

Everything ships behind `SMS_ENABLED=false`.

---

## 2. Provider facts — live-verified, authoritative

**These override every earlier research note, the vendor PDF, and the plan's own pre-preflight
assumptions.** Each line below was observed against the live API from inside the `leads-crm`
container on the production box during preflight, or captured in the send responses from the test
sends. Where a plan-stage guess turned out wrong, the wrong version is shown struck through so the
dead end isn't re-explored.

### Account & token

| Fact | Value |
|---|---|
| Base URL | `https://sms.aakashsms.com` |
| Token | id **4366**, ACTIVE, Follow-IP-rule **YES** |
| Allowed IP | **`94.136.189.213`** (the Zunkiree VPS) |
| Token lives in | **prod `.env.local` only** — deliberately *not* stage |
| Credits at token creation | 100,000 |
| Credits after preflight sends | 99,996 |
| DNS | `sms.aakashsms.com` has **no AAAA record** — IPv4 only |

**The token is IP-bound, and this is the single most operationally important fact in the
integration.** Nothing sends from local dev, from CI, or from any box other than the prod VPS.
That is why the mock provider is the default rather than the exception. It also means a redeploy
onto a new host silently breaks SMS with `invalid_token` — an `availableCredit()` probe belongs on
the heartbeat (deferred to Phase 4).

Confirmed en route: the container's egress is IPv4 `94.136.189.213`, and since the host has no
AAAA record to reach, the box's default IPv6 egress can never be used against it.

**The token is not on stage, and must not be put there.** Stage shares the prod IP, so a token
there would actually send — against a database holding real, un-anonymized Admizz student PII.

### Send — `POST /sms/v3/send`

Form-urlencoded. Fields: `auth_token`, `to` (**comma-separated bare 10-digit MSISDNs — not
`+977…`**, which v3 rejects), `text`.

Success response `data.valid[]` rows carry, per recipient:

| Field | Observed | Note |
|---|---|---|
| `id` | `"13421_178679570267557"` | **A string, not a number.** Underscore-joined. |
| `mobile` | bare 10-digit | |
| `credit` | integer | **Ground truth for billing** — settle against this, never our estimate |
| `network` | `ntc` \| `ncell` | |
| `status` | e.g. `queued` | |
| `shortcode` | `"AT_Alert"` | The sender ID the message actually went out under |

Failures come back as `data.invalid[]` rows alongside valid ones. **Partial success is the normal
case, not an edge case** — per-recipient rows are the unit of truth and there is no meaningful
"the batch failed" state.

### The error convention that will bite anyone who forgets it

**v3 returns HTTP 200 even on total failure.** The only reliable signal is `error: true` in the
JSON body. `res.ok` is worthless on this endpoint — never branch on it.

Observed error strings, and the codes they map to:

| Message | Code | Retryable |
|---|---|---|
| `Not enough balance.` | `insufficient_balance` | no |
| `The provided Auth Token is not valid.` (v3) | `invalid_token` | no |
| `Authentication token is invalid or expired.` (v4) | `invalid_token` | no |
| `No valid recipients.` | `no_valid_recipients` | no |
| `All messages encountered errors.` | `all_failed` | no |

Only transport-level failures (fetch rejection, HTTP ≥ 500) are retryable.

### Read endpoints — v4, and v4 *does* use real HTTP status codes

Unlike v3, the v4 endpoints return honest status codes (a bad token gives a real `401`). Both take
the token as an **`auth-token` header**, not a body field.

- `GET /sms/v4/available-credit` → `{"available_credit": 100000, "response_code": 200}`.
  The balance field is **`available_credit`** — ~~`credit`~~, ~~`balance`~~.
  Note the sibling endpoint `/sms/v4/credit` returns **HTTP 202** on success — never test
  `status === 200` against it.
- `POST /sms/v4/api-report` (form fields `start_date`, `end_date`) → rows nested at
  **`data.result.data`** — ~~top-level `data`~~. This is the delivery-report path; there is **no
  webhook**, so delivery status is poll-only (Phase 4).
  **The report's `id` (e.g. `107644461`) has no relationship whatsoever to the send response's `id`
  (`"13421_178679570267557"`).** There is no join key. Phase 4 must reconcile on
  recipient + body + timestamp instead — this is the single most consequential finding for that
  phase and it invalidates the obvious design. Also in the report rows: `credit` comes back as a
  **string**, and `updated_at` can be the MySQL zero date `"0000-00-00 00:00:00"`.
- v4's send path is **`/sms/v4/send`** — ~~`/sms/v4/send-user`~~ was a plan-stage guess and is
  wrong (it 500s with an HTML page). Irrelevant to this phase since v3 ships, but recorded so it
  isn't rediscovered.
- **Malformed requests return HTML, not JSON.** Always guard `JSON.parse` / `res.json()` — the
  `aakash.ts` client does, and any new call site must too.

### Credits, encoding, and the cost nobody expects

GSM-7: 160 chars = 1 credit, 153/segment when concatenated.
**Unicode/Devanagari: 70 chars = 1 credit, 67/segment.**

Confirmed empirically during preflight: an 80-codepoint Devanagari message was charged **2
credits**, so the 70-per-credit rule is real and not a documentation artifact. A 200-character
Nepali message costs **3 credits, not 2** — Devanagari burns the pool roughly 2.3× faster than
users intuit. One Devanagari character anywhere forces the *entire* message to Unicode
segmentation. The GSM-7 extension characters `^ { } \ [ ] ~ | €` each cost **2** characters, which
is the single most commonly botched part of every SMS counter ever written.

### Two hard constraints on product design

1. **Sender ID is account-level, not an API parameter.** Every tenant shares one until EdgeX
   registers more with NTC/Ncell. Consequence: **every message must self-identify in its body**
   (`"Admizz: "`). Currently that ID is `AT_Alert`, which reads as spam; a branded ID needs
   NTC/Ncell registration (3–11 alphanumeric, ~5–10 business days). No code depends on it — the
   first real blast does.
2. **There is no free-form inbound.** Only a rented keyword-on-shortcode would give us that.
   We therefore **cannot honour "Reply STOP", so we must never print it.** Opt-out is a link
   (Phase 2). Nepal also has **no DND registry**, so we own the suppression list entirely.

Rate limits and max-recipients-per-call are undocumented; we self-impose 100 per call.

---

## 3. Scope

Two migrations, one new `src/lib/sms/` module tree, one CLI script, `.env.example`. No UI, no API
routes, no Inngest, no `src/industries/` changes, no `lead_activities` changes, no real network
calls from local or CI.

### 3a. Migration `202_sms_settings_and_credits.sql`

- **`tenant_sms_settings`** — structural clone of `tenant_email_settings` (mig 045), PK
  `tenant_id`: `sender_label`, `quiet_hours_start/end/enabled` (defaults 8/20/true), `timezone`
  (NULL ⇒ fall back to `tenants.timezone`), `optout_footer`, `max_recipients_per_blast`
  (default **500**), `low_credit_threshold` (default 200).
- **`sms_credit_accounts`** (PK `tenant_id`): `balance`, `reserved`, `lifetime_granted`,
  `lifetime_consumed`.
  **No `CHECK (balance >= 0)`** — and this is deliberate enough to warrant a SQL comment. Settle
  may legitimately push the balance negative when the provider charges more than we reserved. That
  is a rare bounded overage we want *visible in the ledger*, not a constraint violation that aborts
  the settle transaction and strands the reserved credits forever. Non-negativity is enforced on
  the debit side, in `sms_credits_reserve`, which is the only path that can move balance down from
  a healthy state.
- **`sms_credit_ledger`** — append-only; never UPDATE or DELETE a row. `delta`, `reason`,
  `balance_after`, `ref_type`, `ref_id`, `actor_user_id`, `notes`.
- **Two `SECURITY DEFINER` RPCs — the only writers of `sms_credit_accounts`**, both taking
  `SELECT … FOR UPDATE` on the account row so concurrent callers serialize:
  - `sms_credits_reserve(tenant, amount, ref_type, ref_id) → {ok, balance, reserved, shortfall}`
  - `sms_credits_settle(tenant, ref_id, reserved, actual)` — reconciles against the provider's
    returned `credit`.

**This pair is the answer to the reserve-vs-actual race:** reserve our estimate up front, settle
against ground truth afterwards. Refund is the common case (invalid numbers); overage is bounded.

> The idempotency design of these two RPCs was **wrong as first shipped** and is the subject of
> HIGH-1/HIGH-2 in the review. The corrected shape — ledger row written *first*, account mutation
> gated on whether that insert actually inserted, with a partial unique index on
> `(tenant_id, ref_type, ref_id, reason)` making a replay a no-op — is what is in the branch now.
> See `docs/SMS-PHASE1-REVIEW.md` §HIGH.

RLS: SELECT via `get_user_tenant_ids()`; ledger/account mutations `service_role` only;
`tenant_sms_settings` ALL via `is_tenant_admin(tenant_id)`.

### 3b. Migration `203_sms_messages_and_blasts.sql`

- **`sms_blasts`**: `name`, `body` (raw `{{merge}}` template, no prefix/footer), `audience_filter
  JSONB` (an encoded `FilterTree`), `status`
  (`draft|scheduled|queued|sending|sent|partially_failed|failed|cancelled`), `scheduled_for`,
  `estimated/reserved/actual_credits`, recipient counters.
- **`sms_messages`**: `blast_id` (NULL for 1:1/sequence), `lead_id`, `source`
  (`blast|manual|sequence`), `to_phone` (as sent: bare 10-digit), `to_phone_stored` (original, for
  audit), `body` (fully rendered), `encoding`, `segments`, `status`
  (`queued|deferred|sending|submitted|delivered|failed|suppressed|cancelled`), `deferred_until`,
  and the provider-truth columns `provider_message_id`, `provider_credit`, `provider_network`,
  `provider_status`.
- **`UNIQUE (blast_id, lead_id) WHERE blast_id IS NOT NULL`** — the idempotency backbone. Recipient
  rows are **materialized up front** in `queued`, so a re-run job re-INSERTs the same pairs, hits
  `ON CONFLICT DO NOTHING`, and can never double-send a lead.

**Deliberately not touching `lead_activities`.** Its `activity_type` is a PG ENUM
(`call|email|meeting`), and `sms_messages` holds richer fields (segments, credit, network, delivery
status) that wouldn't fit it anyway. Merge into the lead timeline at read time — no enum change.

### 3c. `src/lib/sms/`

| Module | Contract |
|---|---|
| `flag.ts` | Two-layer gate copied from `src/lib/ai/flag.ts`: env kill-switch × per-tenant grant. The tenant leg reads `entitlement_overrides.sms_enabled` through the existing `resolveEntitlements()` — **no new `tenants` column**. `isSmsSandbox()` defaults **true**, inverted vs the AI flags, because here the safe state must be the default. |
| `segments.ts` | Pure, no I/O. GSM-7 basic + extension tables, Unicode path counts code points. The single source of truth for both the Phase 3 on-screen counter and the credits we bill — nothing outside this file may re-implement any part of it, or the counter and the charge will drift apart. |
| `phone.ts` | `toProviderRecipient()` on top of `parseStoredPhone`; requires `+977` + 10 digits starting 97/98; returns **bare 10 digits**. Do **not** use `formatPhoneForTel` — it emits `+977…`, which v3 rejects. Everything else is excluded with a typed reason (`missing`/`foreign`/`malformed`) so the Phase 3 preview can break the exclusions out by cause. |
| `render.ts` | `"{senderLabel}: {body}{\n footer}"` with `{{merge}}` token resolution. **Throws** if the footer matches `/reply\s+stop/i`. |
| `provider/types.ts` | `SmsProvider` = `send` / `availableCredit` / `report`, plus the `SmsErrorCode` union. |
| `provider/aakash.ts` | Raw fetch, patterned on `src/lib/inbox/adapters/whatsapp.ts:159-195`. 20s timeout, self-imposed 100-recipient cap. Maps the HTTP-200 error strings per the table in §2. |
| `provider/mock.ts` | Deterministic hash-based valid/invalid split, credits computed via the real `countSegments`, logs every rendered body to stdout, `SMS_MOCK_FAIL=<code>` injection so every error branch is reachable locally. |
| `provider/index.ts` | Lazy singleton per `src/lib/email/index.ts`, but **falls back to mock rather than null** — a null provider forces defensive branching everywhere, whereas a mock keeps the pipeline exercised in every environment. Going live requires **both** `SMS_PROVIDER=aakash` **and** a configured token. |
| `env-guard.ts` | When sandboxed, rewrites every `to` to `SMS_TEST_RECIPIENTS` and prefixes the intended recipients into the body. **Throws** if sandboxed with an empty test-recipient list rather than falling through. The highest-value safety mechanism in the feature. |
| `send.ts` | `sendQueuedBatch(tenantId, messageIds[])` — the one orchestration path blast/1:1/sequence all use. Groups identical rendered bodies into a single provider call, applies the env guard immediately before dispatch, writes back per-recipient provider truth. |

### 3d. `.env.example`

`SMS_ENABLED=false`, `SMS_PROVIDER=mock`, `SMS_SANDBOX=true`, `SMS_TEST_RECIPIENTS=`,
`AAKASH_SMS_TOKEN=`, `AAKASH_SMS_BASE_URL=`. All server-only → `.env.local` on the box. **No
`NEXT_PUBLIC_*`, no Dockerfile or build-arg change.**

### 3e. `scripts/grant-sms-credits.ts`

Modeled on `scripts/onboard-tenant.ts`: dry-run by default, `--apply` requires
`--yes-i-reviewed-the-dry-run`. `--list` shows every tenant's balance plus pool utilization.
**Pool guard:** refuses to over-allocate the shared 100k pool, checked against live
`available-credit` when reachable and `SMS_POOL_TOTAL` otherwise. Creates the account row, writes
the `grant` ledger entry, sets `entitlement_overrides.sms_enabled`.

---

## 4. Verification

`npm run test` covering `segments` (the full GSM-7 and Unicode boundary tables), `phone` (the real
stored-phone shapes from migration 158), and `aakash` (mocked fetch across all four error bodies,
including explicit proof that `res.ok === true` does not short-circuit a provider-level error).

**The test that matters most is psql, not vitest:** two concurrent `sms_credits_reserve` calls in
separate sessions against a balance of 1 — exactly one must succeed. Then grant credits to
Admizz-local, run a scratch send against the mock provider, and show in psql that the balance moved
with matching reserve+settle ledger rows and populated `provider_credit`/`provider_network`.

---

## 5. Risks this phase is specifically defending against

1. **Blasting 17,334 real students by accident.** Five independent layers: `SMS_SANDBOX=true`
   default, mock-provider default, `max_recipients_per_blast=500`, the type-the-count confirmation
   (Phase 3), and the credit balance itself. **The balance is the real backstop — grant Admizz
   2,000 credits to start, not 25,000.** Never grant more than you are willing to watch disappear
   in one mistake.
2. **IP binding.** Nothing sends from local; the token dies if the box's IP changes.
3. **Credit drift.** Settle handles the normal case. The uncovered case is a send that succeeds at
   Aakash but whose response we never see (timeout after dispatch) — we would refund credits they
   actually charged. Only the Phase 4 poller cures this; a small drift window is accepted until then.
4. **Personalization kills batching.** Aakash sends one shared `text` to a comma-separated `to`, so
   merge tags force one API call per recipient. 4,000 recipients at a 2s throttle is over two hours.
   Phase 3 decides the product answer; `send.ts` handles both shapes already.

---

## 6. Stop at the PR

Target `stage`. Do not merge, do not apply migrations to stage or prod, do not enable any flag.
Opus reviews first.

Report back with what was built, anything in this brief that turned out wrong or impossible, and
the output of the verification commands.
