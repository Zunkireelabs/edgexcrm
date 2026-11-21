# The forwarded copy must be replyable — `fwd+` token + relay

**For:** Sonnet executor session
**Written by:** Opus planner session, 2026-07-30
**Base:** latest `origin/stage` (PR #328 `53e38a28` merged)
**Found by:** live stage smoke, 2026-07-30 — first time the rep's return path was exercised.

Ship as **two PRs**, in order. Stage 1 is small and independently valuable; do not bundle it.

---

## The defect

When a lead replies, `process-inbound.ts:441-449` passthrough-forwards the message to the rep's
connected mailbox with `from: PLATFORM_EMAIL_ADDRESS` — `noreply@lead-crm.zunkireelabs.com`
(`src/lib/email/index.ts:20`).

**Gmail therefore addresses the rep's Reply to `noreply@…`, not to the lead.** That domain's MX
points at SES/Resend inbound, so the message is *accepted*, then:

- `resolveInboundRecipients` finds no `verb+token` candidate → `{matches: [], hadCandidateButNoMatch: false}` (`resolve.ts:49`)
- the webhook deliberately writes no event and no dead-letter for that case (`webhooks/email/inbound/route.ts:88-90`)
- response is `200 {received:true}`

**Net: the rep's reply is silently discarded.** The lead never receives it, EdgeX never records it,
nothing surfaces anywhere. Verified live on stage: the forward arrives from `noreply@`, and hitting
Reply pre-fills `noreply@lead-crm.zunkireelabs.com`.

---

## Stage 1 — stop the silent discard (PR 1, small)

A safety net that holds under every future architecture. `noreply@` is on every forward we have
ever sent, so mail will keep arriving there regardless of Stage 2.

In `src/app/(main)/api/webhooks/email/inbound/route.ts`, in the zero-matches branch: if any
envelope recipient's local-part is exactly the platform address's local-part (`noreply`) **and**
its domain is one of `getInboundDomains()`, write a dead-letter row with reason
`inbound_unroutable_platform_address`.

**Deliberately narrow.** Do NOT dead-letter every unmatched recipient — the existing comment's
reasoning is sound: arbitrary junk addressed to the domain would flood the table. Only the known
platform address, which is low-volume and always indicates a real user action we are losing.

**This does not weaken the anti-enumeration property.** That property is about the HTTP *response*
being identical whether or not a token matched. The response stays `200 {received:true}` byte for
byte; only internal logging changes. Say so in the code comment so a future reader does not
"restore" the old behaviour.

Test: an inbound payload addressed to `noreply@<inbound domain>` produces exactly one dead-letter
row and no event; an inbound payload addressed to `randomjunk@<inbound domain>` produces neither.

---

## Stage 2 — make the forward replyable (PR 2)

### Why not "just set Reply-To"

`ForwardReceivingEmailOptions` is `{emailId, to, from}` plus `passthrough` — **there is no
`replyTo` field**, and `forwardPassthrough()` POSTs to `/emails` with only
`from, to, subject, text, html, attachments`. Confirmed in `node_modules/resend/dist/index.d.mts`
and `index.mjs`. Do not waste time trying; the SDK cannot carry a Reply-To on a forward.

`from` **is** settable, and `parseInboundAddress` (`tokens.ts`) already accepts `fwd` as a valid
verb alongside `reply` and `bcc`. Use that.

### The change

**a. Mint a `fwd` token bound to the thread.** Same shape as the existing thread-bound `reply`
token (`kind='thread'`, `verb='fwd'`, `thread_id` set). Reuse an existing active one for that
thread if present; mint on demand otherwise. No migration — `inbound_addresses` already models
this.

**b. Forward from it.** Change the `forwardReceivingEmail` call to:

```ts
from: `${leadDisplayName} <fwd+${marker}${token}${checksum}@${getInboundDomains()[0]}>`
```

Build the address with `buildInboundAddress("fwd", token)` — do not hand-roll it. Sanitize the
display name for CRLF and quotes exactly as the Reply-To label fix does; fall back to the lead's
email local-part, then to a bare address, if no name resolves. The rep must still see at a glance
who the mail is from.

`lead-crm.zunkireelabs.com` is already a verified Resend sending domain (we send `noreply@` from
it today), so no DNS work.

**c. Handle the `fwd` verb inbound.** New module `src/lib/email/inbound/fwd-route.ts`, structured
like `bcc-route.ts`. On a `fwd` match:

1. **Sender guard — reuse the bcc logic exactly.** Allowed senders = the token owner's login email
   *plus* every `connected_email_accounts.email` for that same `user_id`, via `scopedClient`. Fail
   closed to a dead-letter (`fwd_sender_mismatch`). This is the security core: without it, anyone
   holding a leaked `fwd+` address can both inject fake history **and cause EdgeX to send mail to a
   real lead from a real rep's mailbox**. That is strictly more dangerous than the bcc path — treat
   it accordingly.
2. **Resolve the thread from the token**, not from headers. The token is `kind='thread'`, so
   `thread_id` is authoritative; do not re-derive from References.
3. **Insert an `emails` row**: `direction='outbound'`, `provider='edgex_native'`,
   `inbound_route='fwd'`, `sender_user_id` = token owner, `sender_verdict` from
   `parseSenderVerdict`, dropbox/own-domain addresses stripped from persisted `to_emails`/
   `cc_emails` exactly as `bcc-route.ts` does.
4. **Relay to the lead** via `sendMessage()` on that user's connected account — the same primitive
   the composer uses, so the relayed message gets a fresh `reply+` token and the loop continues.
   Strip the quoted history if it is cheap to do so; do not block the slice on it.
5. **Do not forward, do not notify.** The rep authored this.

**d. Loop guards — get these right, this path can send mail.**

- Never `forwardReceivingEmail()` a message whose matched verb is `fwd`.
- Ignore any inbound whose `From` is the platform address. Precedent exists at
  `process-inbound.ts:239` (`isFromPlatform`) — reuse it, do not invent a second check.
- If the relay send fails, dead-letter with the error; never retry in a way that could double-send
  to the lead. `provider_message_id` is UNIQUE — lean on it.

### Ordering constraint

The `emails` row must be inserted **before** the relay send, so a crash between the two leaves a
recorded-but-unsent message (visible, recoverable) rather than a sent-but-unrecorded one
(invisible, and indistinguishable from the bug we are fixing).

---

## Tests

Stage 1: two cases above.

Stage 2, in `src/lib/email/inbound/fwd-route.test.ts`, mirroring `bcc-route.test.ts`'s harness:

1. Happy path → one `emails` row (`direction='outbound'`, `inbound_route='fwd'`) on the token's
   thread, and `sendMessage()` called once with the lead as recipient. **Must fail before the change.**
2. Sender mismatch → dead-letter, zero `emails` rows, **`sendMessage()` not called**. Assert the
   negative explicitly; this is the one that matters.
3. A connected mailbox belonging to a *different* user does not authorize the token.
4. Revoked token → dead-letter, no relay.
5. `From` = platform address → ignored, no relay, no dead-letter.
6. Relay send failure → dead-letter, `emails` row still present.

---

## Gates + report

Four gates, full output pasted: `npm run build` · `npx tsc --noEmit` · `npx eslint --max-warnings 50`
(repo-wide, not scoped — baseline is 46 warnings / 0 errors) · `npm run test` (baseline
1027 tests / 100 files). Paste the pre-change failure of Stage 2 test 1.

Branch `fix/replyable-forward` off the latest `origin/stage`. **Two PRs against `stage`, both
unmerged.** Do not merge, do not touch the DB, leave unrelated working-tree changes alone.

---

## After this merges (not yours)

- Live stage smoke: lead replies → rep hits Reply on the forwarded copy in Gmail → expect the
  message to **reach the lead** and appear on the thread as outbound. Wait for the
  `email.inbound_received` event AND a row-or-dead-letter; inbound lags ~2 min.
- Only then does slice A's prod promotion get reconsidered.

## Deliberately out of scope

Reading the rep's mailbox (the native lane) — that is the strategic track and would retire this
forward entirely for readable mailboxes. This slice makes the fallback lane correct, and the
fallback lane persists permanently for consumer-Gmail reps regardless of how the native lane lands.
