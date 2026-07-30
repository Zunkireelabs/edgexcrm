# BCC dropbox step-5 dedup is defeated by Gmail rewriting Message-IDs

**For:** Sonnet executor session
**Written by:** Opus planner session, 2026-07-30
**Base:** latest `origin/stage` (PR #326 `8184c797` + PR #327 `ac4c20b3` both merged)
**Migrations:** none. Do not write one.
**Found by:** live stage smoke T4, 2026-07-30 — the first time this path could be run at all.

## The defect

`src/lib/email/inbound/bcc-route.ts` step 5 skips a BCC'd copy of a message EdgeX itself
sent, by matching the incoming `Message-ID` against a stored `emails.rfc_message_id`:

```ts
  const messageId = getHeader(headers, "message-id") ?? null;
  if (messageId) {
    const { data: existing } = await db.from("emails").select("id")
      .eq("rfc_message_id", messageId).limit(1).maybeSingle<{ id: string }>();
    if (existing) return;
  }
```

`gmail-client.ts:188` invents `<${randomUUID()}@edgex-crm.com>`, passes it to MailComposer,
and `sendMessage()` returns that same invented value, which the send route persists as
`rfc_message_id`. **Gmail discards it and assigns its own.** Proven on stage — the raw source
of the delivered message (`temp_ss/GUARDFIX-3-BCC.eml`) shows:

```
Message-ID: <CAOOo9VNrtM=sQdf84eTBP-bCwaN2K3C41Y2=WKSouOAnnuUY_A@mail.gmail.com>
```

while the `emails` row for that same send stores `<ccdd4ecb-6888-4dcb-b1a5-5ed2e0dc8d5e@edgex-crm.com>`.

**The two can never be equal, so the dedup can never fire.** Live consequence on stage — one
message, two rows, two threads:

| id | provider | inbound_route | rfc_message_id | thread |
|---|---|---|---|---|
| `65d60c47` | `gmail` | — | `<ccdd4ecb-…@edgex-crm.com>` | `846c3ecd` |
| `271b7313` | `edgex_native` | `bcc` | `<CAOOo9VNrtM=…@mail.gmail.com>` | `21cef31c` |

A rep who BCCs their dropbox on an EdgeX-sent message gets the message duplicated in the
lead's timeline, on a second thread. **This blocks slice A's prod promotion.**

## The fix — recognise our own Reply-To token

Do **not** "fix" this by fetching the real Message-ID from Gmail after send. That works but
costs an extra `messages.get` API call on every send, and it still fails for any provider that
rewrites IDs. There is a stronger signal already in hand.

**Every EdgeX-sent message carries a Reply-To token that only EdgeX could have minted.** The
delivered copy above has:

```
Reply-To: Zunkiree Labs <reply+s86e62d5a8c56f5cbcdfa8eebf0801a9cf16c1953d2@lead-crm.zunkireelabs.com>
```

and that token is a row in `inbound_addresses`. Nothing else in the world carries it. So step 5
becomes: **if the incoming message's `Reply-To` parses to one of our own reply tokens, this is
our own send — skip.** No API call, no new storage, and immune to Message-ID rewriting.

### Step 0 — verify the header is actually available (do this first)

The 2026-07-28 spike enumerated the header keys `receiving.get()` returns and `reply-to` was
**not** among them — but that spike's test message had no Reply-To to carry. **Confirm
`getHeader(headers, "reply-to")` is populated for a real EdgeX-sent message** before building
on it. If Resend does not surface it, **stop and report** — the fallback is the
`messages.get` approach and that is a planner decision, not yours to pick.

### The change

In `bcc-route.ts` step 5, check the token first, then keep the existing Message-ID check as a
fallback (it still covers sends made while inbound was disabled, which carry no token):

```ts
  // ── 5. Skip an EdgeX-sent copy — the rep BCC'd a message EdgeX itself sent ─
  //
  // Primary signal: our own Reply-To token. Gmail REWRITES the Message-ID we
  // stamp at gmail-client.ts:188 (proven on stage 2026-07-30 — the delivered
  // copy carried <...@mail.gmail.com>, the emails row stored
  // <...@edgex-crm.com>), so rfc_message_id equality can never match for a
  // Gmail-sent message. The reply token can only have been minted by us.
  const replyToHeader = getHeader(headers, "reply-to");
  if (replyToHeader) {
    const parsed = parseInboundAddress(replyToHeader);
    if (parsed?.verb === "reply") {
      // Match on token existence regardless of status — a REVOKED token still
      // proves we authored the message, and revocation must not resurrect the
      // duplicate this guard exists to prevent. scopedClient scopes to tenant.
      const { data: ours } = await db
        .from("inbound_addresses")
        .select("id")
        .eq("token", parsed.token)
        .limit(1)
        .maybeSingle<{ id: string }>();
      if (ours) return; // our own send — not an error, not a dead-letter
    }
  }

  // Fallback: Message-ID equality. Still correct for any sender that preserves
  // the ID we stamped, and for sends made with inbound disabled (no token).
  const messageId = getHeader(headers, "message-id") ?? null;
  ...existing block unchanged...
```

`parseInboundAddress` (`src/lib/email/inbound/tokens.ts:148`) already handles the
`Name <addr>` form, lowercasing, the env marker, and checksum verification, and never throws —
reuse it, do not hand-roll parsing.

### Invariants that must hold

- A token belonging to **another tenant** must NOT cause a skip. `scopedClient` enforces this
  — do not use `db.raw()` here.
- A **revoked** token still causes a skip (match on existence, not `status='active'`).
- A `bcc` -verb token in Reply-To (shouldn't happen) must NOT skip — only `verb === "reply"`.
- No Reply-To, or an unparseable one → fall through to the Message-ID check, then proceed
  normally. Never dead-letter on this path; a skip is silent by design.

## Tests (`src/lib/email/inbound/bcc-route.test.ts` — extend, don't rewrite)

1. Reply-To carries a token that exists in `inbound_addresses` → **skip**: zero `emails`
   inserts, zero dead-letters. **Must fail before your change** — verify and paste it.
2. Reply-To carries a *well-formed but unknown* token → proceeds and inserts.
3. Reply-To in `"Name" <reply+…>` display-name form → still skipped (proves `parseInboundAddress` reuse).
4. Revoked token (`status='revoked'`) → still **skipped**.
5. No Reply-To but `rfc_message_id` matches → skipped (existing behavior preserved).
6. Neither → inserts exactly one row (the happy path stays intact).

## Gates + report

Four gates, full output pasted. State whether step 0 confirmed `reply-to` is present in
`receiving.get()` headers, and paste the pre-change failure of test 1.

Branch `fix/bcc-dedup-reply-token` off the latest `origin/stage`. PR against `stage`,
**unmerged**. Do not merge; do not touch the DB; leave any unrelated uncommitted working-tree
changes alone.

## After this merges (not yours)

- **Sadin re-runs T4** on stage: EdgeX-compose to a lead with the dropbox in Bcc → expect
  **no** new `inbound_route='bcc'` row and no new thread.
- **Stage cleanup owed:** the duplicate row `271b7313` and its orphan thread `21cef31c`, plus
  the earlier smoke artifacts already tracked in `project_email_productionization`.
- Slice A's prod promotion stays held until T4 passes.

## Deferred, deliberately not in this brief

Persisting the **real** Gmail Message-ID (via `messages.get` after send) would also fix
`rfc_message_id` being fictional for every EdgeX-sent message — which matters for
References-based thread matching if a reply ever arrives by a path other than the reply token.
Not needed for this defect; log it, don't build it.
