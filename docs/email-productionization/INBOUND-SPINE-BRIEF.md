# EdgeX Native Email — Inbound Spine (Phase 1) — Build Brief

**Author:** Opus (planning brain) · **Executor:** Sonnet (separate session, own branch)
**Date:** 2026-07-28 · **Branch:** `feature/edgex-native-email-inbound` (already created off `origin/stage` @ `550ba982`)
**Next free migration:** 191
**Status:** READY FOR SONNET

---

## 1. Why this exists

`PATH-B-CASA-BRIEF.md` (same folder) concludes that receiving email requires Google's Restricted
`gmail.readonly` scope, which forces a paid CASA Tier 2 assessment ($500–$4,500/yr, annual, no
self-scan option since 2025). **That conclusion is wrong about the general case.**

CASA buys exactly one thing: the right to read a user's *existing Gmail mailbox* through Google's
API. Receiving email is a different problem with free solutions. Zoho, HubSpot, Salesforce and
Pipedrive all ship three mechanisms — connected mailbox (paid/restricted), ESP-hosted inbound
(free), and BCC/forwarding dropboxes (free) — and the free two carry most of the real usage.

**The unlock:** EdgeX already sends via `gmail.send` and builds the RFC822 itself with MailComposer.
Setting `Reply-To: reply+<token>@inbound.edgex.zunkireelabs.com` sends the lead's reply to *EdgeX*
instead of the rep's Gmail. Full two-way threading, zero restricted scopes, zero CASA, no
re-consent, no user action.

**The finding that reframes the work:** EdgeX cannot receive email by *any* means today — no MX
consumer, no inbound webhook, no IMAP, no SMTP listener, no mail parser. `src/app/api/webhooks/`
contains only Meta and sandbox. So "Path B" was never a flag flip: even with CASA paid, this spine
would still have to be built, orphan inbound is silently dropped at `poll/lib.ts:177`, and the
result would be Gmail-only. Building this first makes CASA optional rather than blocking.

**Outcome:** a lead replies to any email a rep sent from EdgeX, and the reply appears in the lead's
timeline. Recurring cost $0 — Resend is already a dependency and includes inbound on all plans.

**This does not replace the Google OAuth verification work.** `gmail.send` is **Sensitive** tier
(not Restricted) and still needs its free verification to leave Testing mode. Hardik's open items
(logo, homepage URL, demo video, submit) stay live and unblocked.

### The target flow

```
 1. Rep opens the lead → Emails tab → "Compose Email"
    EdgeX creates the thread + mints a reply token BEFORE sending   ← ordering change
                          │
                          ▼
 2. Sent via the rep's connected Gmail  (gmail.send — ALREADY WORKS)
      From:      rep@zunkireelabs.com
      To:        hardik@zunkireelabs.com
      Reply-To:  reply+a7f3…@inbound.edgex.zunkireelabs.com          ← NEW, one header
              │                                    │
              ▼                                    ▼
     Rep's Gmail SENT ✅                  Lead's inbox ✅
                                                   │ 3. Lead hits Reply
                                                   ▼
 4. Reply → reply+a7f3…@inbound…  →  MX  →  Resend
    Resend POSTs email.received → /api/webhooks/email/inbound
    verify signature → token lookup → tenant + thread → fast-ack 200
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
 5a. EdgeX ✅                   5b. receiving.forward(passthrough)
     emails row direction=          → rep's Gmail, so they still
     'inbound' on the thread          see the reply where they expect
     + bell notification
```

**Accepted trade-off:** the reply reaches the rep's Gmail as a *forwarded copy*, not native
delivery. Removing that difference is exactly what CASA costs. Decided: live with it.

**Accepted gap:** if the rep replies from Gmail rather than EdgeX, that reply goes straight to the
lead and EdgeX never sees it. The Phase-2 `bcc+` dropbox closes this.

---

## 2. Decisions already taken — do NOT re-litigate

| # | Decision | Why |
|---|---|---|
| 1 | **Inbound lands in `email_threads`/`emails`, NOT the Unified Inbox's `messages`** | `messages` has no subject, no HTML body, no from/to/cc arrays, no `rfc_message_id`/`in_reply_to`/`references`. Worse, `conversations` is `UNIQUE (channel_id, external_contact_id)` = one conversation per *person*, but one lead routinely has several concurrent subject threads. Threading fidelity can't be recovered once flattened. Unified Inbox gets a read-only projection in Phase 5. |
| 2 | **EdgeX-owned inbound domain** `inbound.edgex.zunkireelabs.com` | One MX record we control, works day one, zero tenant DNS. Per-tenant white-label is a Phase 4 upgrade on the same spine. |
| 3 | **Stored random tokens + checksum, NOT HMAC-derived tokens** | An HMAC-derived address is baked into every email already sitting in leads' mailboxes forever — rotating the secret breaks every historical reply address, and one leaked address can't be revoked without killing all of them. A stored 144-bit random token is individually revocable, carries `tenant_id` on the row, and survives rotation. The 6-char checksum suffix is only a cheap pre-DB reject for probing traffic. |
| 4 | **Single-address `Reply-To`** + `receiving.forward(passthrough)` to the rep | Multi-address `Reply-To` is honored inconsistently (Outlook takes the first, some clients ignore it) — replies would reach EdgeX at random. |
| 5 | **Nothing is ever silently dropped** | Every path ends in an `emails` row or an `inbound_email_dead_letter` row. Closes the `poll/lib.ts:177` gap. Lead auto-create from unknown senders is Phase 2 and opt-in. |
| 6 | **Per-tenant gate `tenant_email_settings.inbound_enabled`, default false** | Closes the rollout-safety gap `PATH-B-CASA-BRIEF.md` §5.3 raised, using the `tenants.ai_enabled` precedent. No tenant is silently opted in. |

---

## 3. Verified findings that shape the build

Confirmed directly against the code. Trust these, but re-read the named files before changing them.

1. **`resend@6.10.0` already ships everything needed** — `webhooks.verify()` (svix 1.88.0 bundled),
   `emails.receiving.get()` returning **already-parsed html/text/headers**,
   `emails.receiving.forward({passthrough})`, `emails.receiving.attachments`, `domains.create/verify`.
   **No `mailparser`, no new dependency.**
2. **Three schema blockers.** `025_email_send_foundation.sql` is unmodified since (only 028 added
   `read_at`): `email_threads.connected_email_account_id NOT NULL` (:76),
   `email_threads.gmail_thread_id NOT NULL` (:77), `emails.connected_email_account_id NOT NULL` (:118),
   `emails.gmail_message_id NOT NULL` (:128), plus unique indexes at :88 and :139.
   **Not one Resend-inbound row can be written today.**
3. **Ordering bug blocks the Reply-To change.** In `send/route.ts`, `sendMessage()` is at :165 but the
   `email_threads` insert is at :206 (it needs `result.gmail_thread_id`). At compose time there is no
   thread to mint a token from. Must invert. Only legal once 191 makes `gmail_thread_id` nullable.
   **This is the riskiest change in the phase** — it moves a DB write across a network call.
4. **`matchInboundToThread` is account-scoped, not tenant-scoped** (`poll/lib.ts:32,44,59`).
   Resend-inbound rows have no account, so promoting it requires re-scoping to `tenant_id`.
5. **`GET /api/v1/email/threads` would hide every new thread.** Hard-requires `lead_id`/`contact_id`
   (:22), and for counselors filters `.in("connected_email_account_id", ownAccountIds)` (:55) — a
   NULL-account thread disappears. **Fix both or inbound lands in the DB and is invisible.**
6. **`connected_email_accounts.provider` is `VARCHAR(50)` with no CHECK** — `'microsoft'`, `'imap'`,
   `'edgex_native'` are already storable. Phase 3 needs zero DDL.
7. **`resolveTenantSender()` already returns a `replyTo`** (`sender.ts:44`, used at
   `email-forward.ts:93` / `form-autoresponder.ts:71`). **This phase touches only the Gmail 1:1 lane
   in `send/route.ts` — do not change the automation lane.** Phase 4 unifies them.
8. **`vitest` IS configured** — `vitest.config.ts`, `npm run test` → `vitest run` (853 tests / 84
   files baseline). CLAUDE.md's "No test runner is configured" is stale; correct it.
9. **The inbound UI is already fully built.** `email-thread-card.tsx` was written two-way from the
   start: `isInbound = email.direction === "inbound"` (:70) drives left-alignment (outbound uses
   `flex-row-reverse`), blue avatar (`bg-blue-100`) and blue bubble (`bg-blue-50`) vs gray;
   sender label falls back to `from_name ?? from_email`; `hasInbound`/`hasUnreadInbound` (:122-123)
   exist; and the thread badge at :158 is `hasInbound ? "⬅ Reply" : "✉ Sent"` — it flips itself the
   moment an inbound row lands. **Zero UI work. This is a pure backend/plumbing job.**

---

## 4. Migration `supabase/migrations/191_inbound_email_spine.sql`

Additive, idempotent, `BEGIN`/`COMMIT`, self-recording in `schema_migrations` per `_TEMPLATE.sql`.
Rollback line + before/after counts required.

- `emails`: drop NOT NULL on `gmail_message_id` and `connected_email_account_id`; add
  `provider TEXT NOT NULL DEFAULT 'gmail'`, `provider_message_id TEXT`, `inbound_route TEXT`,
  `attachments JSONB NOT NULL DEFAULT '[]'`, `sender_verdict JSONB` (parsed SPF/DKIM/DMARC).
- New partial unique `idx_emails_provider_dedup ON emails (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL` — the webhook-redelivery idempotency anchor, mirroring
  `044:139`.
- `email_threads`: drop NOT NULL on `connected_email_account_id` and `gmail_thread_id`; add
  `provider TEXT NOT NULL DEFAULT 'gmail'`.
- **Recreate `idx_email_threads_account_gmail_thread` as a partial unique**
  `WHERE connected_email_account_id IS NOT NULL AND gmail_thread_id IS NOT NULL`. Without this the
  nullable columns silently disable the constraint for rows that still need it.
- New `inbound_addresses(id, tenant_id NOT NULL → tenants, kind CHECK IN ('thread','user','tenant'),
  verb CHECK IN ('reply','bcc','fwd'), token TEXT NOT NULL UNIQUE, thread_id UUID → email_threads
  CASCADE, user_id UUID → auth.users CASCADE, status CHECK IN ('active','revoked') DEFAULT 'active',
  created_at, last_used_at)`. Standard 3-policy RLS (`get_user_tenant_ids()` SELECT,
  `is_tenant_admin()` mutate, service-role).
- New `inbound_email_dead_letter(id, tenant_id UUID NULL, provider_message_id TEXT UNIQUE,
  from_address, to_addresses TEXT[], subject, reason TEXT, raw_event JSONB, created_at)`.
  `tenant_id` nullable **by design** — unrouted mail has no tenant. Service-role-only RLS.
- `tenant_email_settings`: add `inbound_enabled BOOLEAN NOT NULL DEFAULT false`.

> ⚠️ **Write the file and STOP. Do NOT apply it to any database.** Migrations ride the deploy
> pipelines (`scripts/migrate-apply.sh`). Flag in your handoff that 191 is written-but-unapplied.

---

## 5. Files to create

| Path | Purpose |
|---|---|
| `src/lib/email/inbound/tokens.ts` | `mintToken()`, `parseInboundAddress()`, `verifyChecksum()`. Pure, unit-testable. |
| `src/lib/email/inbound/resolve.ts` | `to`/`cc`/`bcc` → matched `inbound_addresses` rows. **The only tenant-resolution path.** |
| `src/lib/email/inbound/match-thread.ts` | Promoted + tenant-scoped `matchInboundToThread`, extracted from `poll/lib.ts:21-72`. Both lanes import it. |
| `src/lib/email/inbound/resend-client.ts` | Wrapper over `resend.emails.receiving.*`, built on the existing `getResendClient()` in `src/lib/email/index.ts`. |
| `src/lib/email/process-inbound.ts` | Async processor. Structural clone of `src/lib/inbox/process-inbound.ts` (pending `events` → per-event try/catch → `attempts`/`status`, retry-to-failed at 3). |
| `src/app/api/webhooks/email/inbound/route.ts` | Public POST. Sibling of `src/app/api/webhooks/meta/[provider]/route.ts`. |
| `src/lib/inngest/functions/email-inbound-process.ts` | `id: "ops-email-inbound-process"`, cron `*/2 * * * *`. **Inngest, never a GH-Actions `schedule:`** (CLAUDE.md rule). |
| `src/app/api/internal/email/inbound/process/route.ts` | Manual drain guarded by `INTERNAL_CRON_SECRET`; copy the shape of `src/app/api/internal/inbox/process/route.ts`. |

## 6. Files to modify

- **`src/industries/_shared/features/email/lib/gmail-client.ts`** — add `replyTo?: string` to
  `sendMessage` args, pass to MailComposer (~:193). MailComposer supports it natively; two lines.
- **`src/app/(main)/api/v1/email/send/route.ts`** — invert the ordering (finding 3): resolve/create
  thread → mint `inbound_addresses` row → build `replyTo` → `sendMessage(..., {replyTo})` → patch
  `gmail_thread_id`. **Delete the provisional thread on send failure.** Gate the whole Reply-To
  behavior on `EDGEX_INBOUND_ENABLED === "true" && tenant_email_settings.inbound_enabled`; when off,
  behave **exactly** as today (no Reply-To, original ordering semantics preserved).
- **`src/app/(main)/api/v1/email/threads/route.ts`** — fix both blindness bugs (finding 5).
- **`src/app/api/inngest/route.ts`** — register the new function in the `functions` array.
- **`email-thread-card.tsx`** — **nothing required** (finding 9). *Optional polish only:* a small
  shield badge when `sender_verdict` shows DMARC/DKIM failure. Do not touch otherwise.

---

## 7. Webhook contract (fast-ack, verify-first)

1. `Buffer.from(await request.arrayBuffer())` **before any parse** — svix signs exact bytes.
2. `resend.webhooks.verify({payload, headers: {svix-id, svix-timestamp, svix-signature},
   webhookSecret: RESEND_INBOUND_WEBHOOK_SECRET})`. Throws → 403, log, **do not enqueue**.
   Svix covers HMAC *and* a ±5-min replay window.
3. Non-`email.received` type → `200 {received:true}`.
4. Resolve tenant (§8). Enqueue one `events` row per matched address:
   `type:'email.inbound_received'`, `entity_type:'inbound_address'`, `entity_id: <inbound_addresses.id>`,
   `tenant_id` from the matched row, `status:'pending'`, payload carries `resend_email_id` + envelope.
5. Always `200 {received:true}` — identical response matched or not, so there is no
   token-enumeration oracle.
6. **Never** call `receiving.get()` in the webhook. Body fetch happens in the Inngest processor.

## 8. Tenant resolution — the security core

- **Tenant comes from the recipient token and nothing else.** Never `From:`, never a header, never
  the body — SMTP `MAIL FROM`/`From:` are attacker-controlled.
- Candidates = `to ∪ cc ∪ bcc`. Lowercase, strip display name, require
  `domain === INBOUND_EMAIL_DOMAIN` **exactly** (not `endsWith` —
  `inbound.edgex.zunkireelabs.com.evil.com` must not match). Checksum-reject before touching the DB.
- `inbound_addresses WHERE token = $1 AND status = 'active'` — `token` is UNIQUE, one index probe,
  and **the row is the authorization**: it carries `tenant_id`, `thread_id`, `user_id`.
- **Multi-tenant CC:** enqueue one independent event per matched address, each pinned to its own
  `tenant_id`. **Invariant for review:** *tenant A's token may never look up a thread whose
  `tenant_id ≠ A`* — `match-thread.ts` takes `tenantId` as a **required** parameter and filters on it
  in every query, including the `In-Reply-To`/`References` fallbacks.
- Zero matches → dead-letter with `tenant_id = NULL`, reason `no_token`. Fast-ack 200.
- Token leakage (a lead forwards your email onward) → blast radius is *append one message to one
  thread in one tenant*, same as replying to the original. Bound with
  `checkRateLimit('inbound_addr:' + token, …)` using the existing helper in `src/lib/api/rate-limit.ts`.
- Spoofed `From:` → parse `Authentication-Results` into `emails.sender_verdict`. Use `From:` for
  display and lead matching **only**. **Hard rule: inbound mail never writes a lead's identity
  fields** (email/phone/name).
- `scopedClient(auth)` does not apply — there is no `AuthContext`. Use `createServiceClient()` for the
  token lookup, then **`scopedClientForTenant(tenantId)`** (`src/lib/supabase/scoped.ts:101`) for all
  post-resolution writes, so the tenant filter is structural rather than remembered.
- New env: `RESEND_INBOUND_WEBHOOK_SECRET`, `INBOUND_EMAIL_DOMAIN`, `INBOUND_TOKEN_SECRET`,
  `EDGEX_INBOUND_ENABLED`. **Fail-closed on missing secret.** Add all four to `.env.example`
  (which is also currently missing `INBOX_TOKEN_ENC_KEY`, `EMAIL_REPLY_SYNC_ENABLED`,
  `INTERNAL_CRON_SECRET`, `NEXTAUTH_SECRET` — add those too).

## 9. Threading algorithm (exact order, in `processOneEvent` after `receiving.get()`)

1. **Loop/auto guard FIRST, before any write.** Dead-letter (`auto_submitted`) if:
   `Auto-Submitted` ≠ `no`; `Precedence ∈ {bulk, auto_reply, list}`; `X-Autoreply`/`X-Autorespond`
   present; `List-Id` present; or `From` normalizes to `PLATFORM_EMAIL_ADDRESS`, any
   `@INBOUND_EMAIL_DOMAIN` address, or any tenant's `from_address`.
2. **`verb === 'reply'` with a `thread_id`** → that thread, full stop. Assert
   `thread.tenant_id === event.tenant_id` (defense in depth). This is the authoritative path.
3. **`In-Reply-To`** → `emails.rfc_message_id = $1 AND tenant_id = $tenant` → `thread_id`.
4. **`References`**, reversed (most specific first), same tenant filter.
5. **No thread** → create `email_threads` with `provider='edgex_native'`, NULL
   `gmail_thread_id`/`connected_email_account_id`, de-prefixed subject. Link `lead_id` by normalizing
   `From:` against the tenant's leads — reuse the email branch of `resolveLeadIdentity()`
   (`src/lib/leads/dedup.ts:38`), **single match only**, same discipline as
   `src/lib/inbox/process-inbound.ts:245`. Zero or multiple → `lead_id = NULL`.
6. **No subject-similarity fallback.** It is the classic cause of silently merging unrelated threads.

Insert `emails` with `direction='inbound'`, `provider='edgex_native'`,
`provider_message_id = resend_email_id`, attachments as **metadata JSONB only** (no download in
Phase 1). On `23505` → already processed, return (idempotent, as `process-inbound.ts:189`). Then
bump `message_count`/`last_message_at`, `emitEvent({type:'email.received'})`, and
`upsertThreadNotification(NotificationTypes.EMAIL_RECEIVED)` — all three already exist at
`poll/lib.ts:215-268`; **reuse verbatim, do not reimplement.**

Finally, if the thread has a `connected_email_account_id`:
`resend.emails.receiving.forward({emailId, to: account.email, from: PLATFORM_EMAIL_ADDRESS,
passthrough: true})` so the rep still sees the reply in Gmail.

---

## 10. Suggested build order within the branch

Each step should leave the branch green. Commit per step.

1. Migration 191 (write only, do not apply).
2. `tokens.ts` + tests. Pure, no dependencies — proves the codec before anything uses it.
3. `resolve.ts` + `match-thread.ts` (extract from `poll/lib.ts`, re-scope to tenant) + tests.
   Keep the existing poller working against the extracted function.
4. `resend-client.ts` + `process-inbound.ts` + tests with a stubbed `receiving.get`.
5. Webhook route + Inngest fn + internal drain route.
6. `gmail-client.ts` `replyTo` arg (two lines) + a test asserting the header lands in the built RFC822.
7. `send/route.ts` ordering inversion — **last, and most carefully.** Include the failure-path test.
8. `threads/route.ts` blindness fixes.
9. Docs: `FEATURE-CATALOG.md` row, correct the stale "Gmail auto-forward" label (it is purely
   outbound), correct CLAUDE.md's "No test runner is configured", `.env.example` additions.

## 11. Gates — run all four before stopping

```bash
npm run test                          # 853 tests / 84 files baseline, + your new ones
npx eslint --max-warnings 50          # exact command, no src/ arg → 46 warnings, 0 errors baseline
npx tsc --noEmit                      # 0
npm run build                         # exit 0
```

Opus re-runs all four independently and does not accept a self-report.

## 12. What can be verified locally vs what needs a real MX record

**Local (no network):**
- `tokens.ts` round-trip incl. hostile inputs (`…evil.com`, missing verb, bad checksum).
- `resolve.ts`: zero-match, multi-tenant CC, revoked token, exact-domain enforcement.
- `match-thread.ts` decision table **including the cross-tenant negative case**.
- Whole `process-inbound.ts` against a fixture `email.received` payload with `receiving.get` stubbed
  — this is the bulk of the logic.
- Svix verification, signing a fixture with the vendored `svix`.
- Reply-To presence: `new MailComposer({...}).compile().build()`, assert on the RFC822 string.

**Needs the MX record (Sadin, §13):** DNS, Resend inbound provisioning + webhook registration,
whether Gmail/Outlook honor Reply-To in practice, delivery latency.

**Middle ground:** once MX points at a staging subdomain, `resend.emails.receiving.list()` pulls real
captured payloads that can be replayed into the local processor — converts most "needs MX" items into
repeatable local tests.

## 13. Runs in PARALLEL — Sadin, not Sonnet

Not a code task, but end-to-end verification is blocked until it's done:

1. Add MX for `inbound.edgex.zunkireelabs.com` per Resend's inbound setup. **Use a subdomain** —
   the apex MX must stay untouched so company Workspace mail is unaffected. Verify apex MX unchanged
   after the edit.
2. Enable receiving on that domain in the Resend dashboard; register the webhook endpoint
   (`https://dev-lead-crm.zunkireelabs.com/api/webhooks/email/inbound` for stage) and capture the
   signing secret → `RESEND_INBOUND_WEBHOOK_SECRET`.
3. Set `INBOUND_EMAIL_DOMAIN`, `INBOUND_TOKEN_SECRET` (32-byte hex), `EDGEX_INBOUND_ENABLED=true`
   on stage.
4. Flip `tenant_email_settings.inbound_enabled = true` for **one tenant only** for the smoke.

## 14. Stage smoke (after merge + deploy)

Enable for one tenant only. Send from a connected inbox to a real address you control; reply; then
confirm all four:
- the reply appears on the lead's timeline as a **blue left-aligned bubble**, badge flips to `⬅ Reply`;
- the bell notification fires;
- the rep receives the forwarded copy in Gmail;
- **a second identical webhook delivery does not duplicate the row** (idempotency).

## 15. Definition of done (for Opus review)

- [ ] `191_inbound_email_spine.sql` written (**NOT applied**), RLS correct, partial unique recreated.
- [ ] Token codec is stored-random + checksum (not HMAC-derived), with hostile-input tests.
- [ ] Tenant resolution reads **only** the recipient token; exact-domain match; cross-tenant negative test passes.
- [ ] Every inbound path terminates in an `emails` row or a dead-letter row — nothing silently dropped.
- [ ] Loop guard runs before any write.
- [ ] `send/route.ts` inverted with a provisional-thread-cleanup-on-failure test; flag-off path behaves exactly as today.
- [ ] `threads/route.ts` blindness bugs fixed.
- [ ] Inngest fn registered; **no GitHub-Actions `schedule:` added anywhere**.
- [ ] `email-thread-card.tsx` untouched (or shield badge only).
- [ ] All four gates green.
- [ ] Stopped at review — nothing merged, nothing applied, nothing pushed to a shared branch.

---

## 16. Sonnet handoff prompt

> Build the EdgeX native email inbound spine per `docs/email-productionization/INBOUND-SPINE-BRIEF.md`.
> The branch `feature/edgex-native-email-inbound` already exists off `origin/stage` — work on it, do
> not create another. Follow the build order in §10 and commit per step. Honor every decision in §2
> and every rule in §8 and §9 — especially: tenant comes **only** from the recipient token; exact
> domain match, never `endsWith`; `match-thread.ts` takes `tenantId` as a required param and filters
> on it in every query including the In-Reply-To/References fallbacks; nothing is ever silently
> dropped. Reuse `emitEvent`, `upsertThreadNotification` and `resolveLeadIdentity` rather than
> reimplementing them. **Write migration 191 but do NOT apply it to any database.** Do not touch the
> automation email lane (`email-forward.ts` / `form-autoresponder.ts` / `sender.ts`). Do not add a
> GitHub-Actions `schedule:` trigger — background work is an Inngest function. `email-thread-card.tsx`
> already renders inbound correctly; leave it alone. Run all four gates in §11 before you stop.
> **Stop at review — do not merge to stage, do not apply the migration, do not push to any shared
> branch.** Report: files changed, gate output, which items in §15 are done, and confirmation that
> 191 is written-but-unapplied.
