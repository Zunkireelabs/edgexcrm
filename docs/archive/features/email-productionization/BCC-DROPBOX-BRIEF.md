# EdgeX Native Email — BCC Dropbox (Phase 2, slice A) — Build Brief

**Branch:** `feature/email-bcc-dropbox` (off `origin/stage`@`3a819941`).
**Migration:** `192` — **one index, nothing else.** Confirm it is still the next free number before writing.

---

## 1. What this closes

Phase 1 gave us two-way email **for threads EdgeX started**. It does not see this:

> A rep opens their own Gmail, emails a lead directly, and the lead replies to them there.
> EdgeX is blind to the entire exchange.

That is the single biggest remaining hole, and it is the one thing Phase 1 explicitly punted
(`INBOUND-SPINE-BRIEF.md` §1: *"The Phase-2 `bcc+` dropbox closes this"*).

**The mechanism:** each rep gets one stable, personal, revocable address —
`bcc+s<token><checksum>@lead-crm.zunkireelabs.com`. They save it as a Gmail contact and BCC it on
mail they send from their own client. EdgeX logs that message against the right lead and thread as
a first-class **outbound** email. Zero OAuth, zero restricted scopes, zero CASA.

---

## 2. Spike results — VERIFIED LIVE ON STAGE 2026-07-28. Do NOT re-derive; do NOT design around guesses.

A real Gmail message was sent with a minted `bcc+` address in **BCC** and the full path inspected.
**This slice was not buildable-by-assumption — the following facts decided its design.**

| # | Question | Verified answer |
|---|---|---|
| 1 | Does a BCC'd token resolve at all? | **Yes.** Resend put the dropbox address in **both** webhook `to` **and** `bcc`. `resolveInboundRecipients` matched it, `kind='user'`, `verb='bcc'`, correct `tenant_id` + `user_id`. **No change needed to `resolve.ts`, `tokens.ts`, or the webhook route.** |
| 2 | Is webhook `envelope.to` the `To:` header? | **NO — it is the SMTP envelope recipient.** It contained *only* the dropbox address. The lead's address was **absent**. **Never lead-match off `envelope.to`.** |
| 3 | Then where is the lead's address? | `receiving.get(id)` → `headers.to` = `sadinshrestha001@gmail.com`. |
| 4 | Shape of `headers`? | A **flat object**, lowercase keys (`return-path, received, from, date, message-id, subject, to, content-type, bcc, x-ses-spam-verdict, …`). The existing `getHeader(headers, name)` (`process-inbound.ts:109`) already handles it case-insensitively — **reuse it**. |
| 5 | Can we dedup against an EdgeX-sent copy? | **Yes.** `headers["message-id"]` is the original Gmail Message-ID (`<CAOOo9VM…@mail.gmail.com>`). |
| 6 | Is the envelope recipient exposed explicitly? | **Yes** — top-level `received_for: [...]` on the `receiving.get()` response. |
| 7 | Spam/virus signal? | `x-ses-spam-verdict` / `x-ses-virus-verdict` headers are present, and **`emails.sender_verdict JSONB` already exists**. |

**One trap:** Gmail *did* include a `Bcc:` header in the delivered copy in this test. **Do not depend
on that** — it is client-specific and not guaranteed. Rely on the token resolving out of the
webhook's `to`/`bcc` (fact 1), which is envelope-derived and reliable.

---

## 3. Schema — Phase 1 already built the rails

Verified against the stage DB. **Do not add columns for these:**

- `inbound_addresses` already permits `kind IN ('thread','user','tenant')`, `verb IN ('reply','bcc','fwd')`,
  a nullable `user_id → auth.users`, and `status IN ('active','revoked')`. A dropbox is
  `kind='user'`, `verb='bcc'`, `user_id=<rep>`, `thread_id=NULL`. **Zero DDL.**
- `emails.direction` CHECK already allows `'outbound'`.
- `emails.inbound_route` already stores the verb (`process-inbound.ts:311` writes `p.verb`).
- `emails.provider_message_id` is UNIQUE (`idx_emails_provider_dedup`) → Resend redelivery is a
  no-op for free.
- `emails.sender_user_id` is nullable and is the attribution field.

### Migration `192_inbound_user_bcc_unique.sql` — the whole thing

```sql
-- One ACTIVE dropbox per (tenant, user, verb). Revoked rows stay for history.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_addresses_user_verb_active
  ON inbound_addresses (tenant_id, user_id, verb)
  WHERE kind = 'user' AND status = 'active';
```

Additive, idempotent, self-recording per `_TEMPLATE.sql`. Rollback line = `DROP INDEX`.
**Apply to stage only. Do not touch prod.**

---

## 4. Files

**New**
- `src/lib/email/inbound/bcc-route.ts` — the processing logic in §5.
- `src/app/(main)/api/v1/email/bcc-address/route.ts` — `GET` (return the caller's active dropbox,
  minting on first call) and `POST` (regenerate: revoke old + mint new, one txn).

**Modify**
- `src/lib/email/process-inbound.ts` — branch on `p.verb`: `'reply'` → the existing path untouched;
  `'bcc'` → `processBccDropbox()`. **Do not refactor the reply path.**
- The Connected Inboxes settings UI — a "Your BCC address" panel: the address, a copy button, a
  one-line explanation, and a Regenerate action with a confirm ("old address stops working").

---

## 5. Processing algorithm (`verb === 'bcc'`)

1. `receiving.get(p.resend_email_id)` → parsed body + `headers`.
2. **Sender-authenticity guard — the security core of this slice.** Normalize the address out of
   `getHeader(headers,"from")` and require it to equal the **token owner's** email
   (`inbound_addresses.user_id` → `auth.users.email`). Mismatch → dead-letter
   `reason='bcc_sender_mismatch'`, write nothing else.
   *Why this is not optional:* without it, anyone holding a leaked dropbox address can inject
   fabricated "outbound" emails into a tenant's lead timeline — forged history that looks
   first-party. The token alone is an addressing secret, not proof of authorship.
3. **Recipients.** Parse `getHeader(headers,"to")` and `"cc"` into addresses (reuse the existing
   `parseAddress`, `process-inbound.ts:118`; both headers may hold comma-separated lists).
   **Discard any address whose domain is in `getInboundDomains()`** — never match a lead against our
   own dropbox address.
4. **Lead match.** `normalizeEmail` each remaining recipient, then `resolveLeadIdentity` within
   `p.tenant_id`. Take the first match in header order (deterministic). No match → dead-letter
   `reason='bcc_no_lead_match'`. **Lead auto-create is a later, opt-in slice — do not create leads here.**
5. **Skip an EdgeX-sent copy.** If an `emails` row already exists in this tenant with
   `rfc_message_id = getHeader(headers,"message-id")`, the rep BCC'd a message EdgeX itself sent.
   Return "skipped" — not an error, not a dead-letter, no second row.
6. **Thread.** `matchInboundToThread(supabase, { tenantId, inReplyTo, references })` — pass **no**
   `accountId`/`gmailThreadId` (Resend-inbound callers never do; `match-thread.ts:44-47`). On no
   match, create a thread with `connected_email_account_id=NULL`, `gmail_thread_id=NULL`,
   `provider='edgex_native'`, `lead_id=<matched>`, `subject=<header subject>`.
7. **Insert the email** — `direction='outbound'` (the rep sent it), `sender_user_id=p.user_id`,
   `provider='edgex_native'`, `provider_message_id=p.resend_email_id`, `inbound_route='bcc'`,
   `rfc_message_id=headers["message-id"]`, `sent_at=headers.date`, `received_at=NULL`,
   `from_email`/`from_name` from the `from` header, `to_emails` from the `to` header.
8. **Do NOT forward.** The Phase-1 reply path calls `forwardReceivingEmail()` to give the rep their
   copy. For `bcc` that is wrong — **the rep is the author and already has the message**; forwarding
   mails them their own email. Skip it, and say so in a comment so nobody "fixes" it later.
9. **Do NOT notify.** No `upsertThreadNotification` for `bcc` — the rep knows; a bell for your own
   sent mail is noise.

**Counselor scoping is already handled:** the thread carries `lead_id`, so the existing
`shouldLeadBeVisibleToAssignee` gate on `GET /api/v1/email/threads` applies unchanged. Do **not**
pre-fetch a visible-lead-id list into a PostgREST `.in(...)` — that is the exact pattern behind the
300-id cap and undici 16KB URL-overflow incidents.

---

## 6. The address endpoint

- `authenticateRequest()` → `getFeatureAccess(auth.industryId, FEATURES.EMAIL)` → `apiForbidden()`.
- **A caller may only mint/read/regenerate their OWN dropbox** (`user_id = auth.userId`), regardless
  of role. The table's RLS insert policy is `is_tenant_admin`, but this route runs through a
  service-backed client, so **RLS will not save you — enforce it in code.**
- Gate on `EDGEX_INBOUND_ENABLED` **and** `tenant_email_settings.inbound_enabled`, same double gate
  as the send path. Off → 404/403, and the UI panel does not render.
- Mint with `mintToken("bcc")` — already supported, no codec change.
- Rate-limit the regenerate action.

---

## 7. Tests

1. Sender guard: `from` ≠ token owner → dead-letter `bcc_sender_mismatch`, no `emails` row.
2. Own-domain filter: a dropbox address in `to` is never lead-matched.
3. No lead match → dead-letter `bcc_no_lead_match`, no thread created.
4. Happy path → one `direction='outbound'` row, `sender_user_id` = token owner, `inbound_route='bcc'`.
5. EdgeX-sent copy (existing `rfc_message_id`) → skipped, exactly one row total.
6. `forwardReceivingEmail` is **not** called for `verb='bcc'` (assert on the mock).
7. Reply path regression: an existing `verb='reply'` fixture behaves identically to today.

---

## 8. Gates — run all four, exactly these

```
npm run test                    # 961+ baseline (95 files) after PR #310, plus yours
npx eslint --max-warnings 50    # 46 warnings / 0 errors is the accepted baseline — no src/ arg
npx tsc --noEmit                # 0
npm run build                   # exit 0
```

Report the **actual** numbers from the **exact** commands.

---

## 9. Out of scope — do not build

`fwd+` address · unrouted-queue UI · lead auto-create from unknown senders · attachment storage ·
retention purge · per-tenant inbound domains (Phase 4) · any Unified-Inbox projection (Phase 5).

---

## 10. Definition of done

- [ ] Four gates green, real numbers.
- [ ] Mig 192 applied to **stage only**, with before/after counts; prod untouched.
- [ ] Live stage smoke: mint a dropbox, BCC it from a real Gmail on a mail addressed to a **real
      stage lead's** email → one outbound row on that lead's thread, attributed to the rep, and the
      rep receives **no** forwarded copy.
- [ ] Sender-mismatch smoke: BCC from a *different* Gmail → dead-letter row, nothing in `emails`.
- [ ] `inbound_email_dead_letter` contains only the rows you deliberately caused.
- [ ] Phase-1 reply flow still works end-to-end (regression).

**Stop at PR.** Open to `stage`, request `ani-shh`. **Do not merge. Do not touch `main`. Do not
apply anything to the production database.**
