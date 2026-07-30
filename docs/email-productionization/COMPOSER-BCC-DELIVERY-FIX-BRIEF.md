# Composer Bcc delivers to nobody — fix + the leak it activates

**For:** Sonnet executor session
**Written by:** Opus planner session, 2026-07-30
**Base:** latest `origin/stage` (slice A + the guard fix are merged; `8184c797`)
**Migrations:** none. Do not write one.
**Found by:** post-merge stage smoke of slice A — smoke step T4 could not run because the
BCC never arrived. Root cause is older than all inbound work.

## The bug

`src/industries/_shared/features/email/lib/gmail-client.ts:193-208` builds the message with
`new MailComposer({ ..., bcc: args.bcc?.join(", ") })` and then `await mail.compile().build()`.

`node_modules/nodemailer/lib/mime-node/index.js:581-586`:

```js
case 'Bcc':
    if (!this.keepBcc) {
        // skip BCC values
        return;
    }
    break;
```

`keepBcc` defaults to false. Nodemailer's json/stream/sendmail transports set it explicitly;
`MailComposer.compile()` never passes it, and it is **not** reachable through mail options —
`compile()` constructs its `MimeNode` with only `{ newline }`.

Gmail's `users.messages.send` with `raw` has **no separate SMTP envelope** — recipients come
only from the headers. So the `Bcc` header is stripped at build time and the address is
delivered to nobody.

**Net effect: the composer's Bcc field silently does nothing.** No delivery, no error, and
`src/app/(main)/api/v1/email/send/route.ts` still persists the address into
`emails.bcc_emails`, so the UI reports it as sent. Live proof on stage: an EdgeX send with a
BCC dropbox address produced an `emails` row carrying that address in `bcc_emails`, and
**zero** `email.inbound_received` events over 6+ minutes.

## Scope

Two changes, one PR:

1. Make Bcc actually deliver.
2. Stop persisting our own inbound-domain addresses in `bcc_emails` — change 1 *activates* a
   leak that is currently harmless only because nothing is transmitted.

**Out of scope:** smoke test T4, the prod promotion of slice A, anything in
`src/lib/email/inbound/`, and the `display_name`/Reply-To label work. **Stop at review** — PR
against `stage`, unmerged, and see the hard gate in change 1 before it can merge at all.

---

## Change 1 — set `keepBcc` on the compiled node

`keepBcc` is read at build time, so assigning it post-construction works:

```ts
  const compiled = mail.compile();
  // nodemailer strips Bcc from built messages unless keepBcc is set
  // (mime-node/index.js: `case 'Bcc': if (!this.keepBcc) return;`). Gmail's
  // messages.send({raw}) has no SMTP envelope — recipients come only from
  // headers — so without this the Bcc address is delivered to NOBODY, silently.
  compiled.keepBcc = true;
  const raw = await compiled.build();
```

If `compiled` is typed such that assigning `keepBcc` fails `tsc`, do **not** reach for `any` —
narrow it (e.g. a local `interface MimeNodeWithBcc { keepBcc: boolean }` intersection) and say
in your report what you had to do.

### 🔴 HARD GATE — this cannot merge on tests alone

`keepBcc` puts the `Bcc` header **into the raw MIME**. The reason nodemailer strips it by
default is that any recipient who receives that header learns who was BCC'd. Gmail is
*expected* to remove it when delivering to To/Cc recipients — **this is unverified, and if it
is wrong the "fix" converts a silent no-op into a privacy leak.**

The verification needs two mailboxes and therefore belongs to **Sadin, not you**:

> Send from EdgeX with **To:** mailbox A and **Bcc:** mailbox B (both Sadin-controlled).
> In **A's** copy: Gmail → ⋮ → *Show original*. Confirm there is **no `Bcc:` header**.
> Then confirm B actually received it.

Write the code and the tests, open the PR, and state plainly in the PR body that it **must not
be merged until that check passes**. Do not merge it yourself under any circumstance.

**If the check fails** (A's copy shows the Bcc list): stop and report. Do not ship `keepBcc`.
The fallback options — a server-side second copy via Resend, or removing the composer's Bcc
field so it stops lying — are a design decision for the planner session, not something to pick
yourself.

### Tests (`gmail-client.test.ts` — the harness already decodes raw MIME via `decodeRaw()`)

1. `bcc` passed → decoded raw **contains** `Bcc: someone@example.com`. **This must fail before
   your change** — verify that and say so in your report.
2. No `bcc` passed → decoded raw has **no** `Bcc:` header (`/^Bcc:/im`).
3. Multiple bcc addresses → all present, comma-joined.
4. The two existing `replyTo` tests stay green — `keepBcc` must not perturb other headers.

### Blast radius

`sendMessage(account, {...})` from this module appears to have exactly one production caller,
`api/v1/email/send/route.ts:274`. The `sendMessage({...})` calls under
`api/v1/inbox/conversations/` look like a *different* single-argument function
(`src/lib/inbox/send-message.ts`). **Confirm that before you finish** — orient with the code
graph (`graphify explain "sendMessage"`) rather than grepping blind — and report what you
found. If the Gmail one has other callers, list them.

---

## Change 2 — stop persisting our own dropbox addresses in `bcc_emails`

Today a rep who BCCs their own dropbox through the EdgeX composer gets that token written into
`emails.bcc_emails`, where **any teammate who can see the thread can read it**. The dropbox is
a per-user addressing secret; the inbound path already strips own-domain addresses from
`to_emails`/`cc_emails` for exactly this reason (`bcc-route.ts` step 3, review follow-up fix 2
on PR #314). The outbound path never got the same treatment.

It is currently harmless only because nothing is transmitted. **Change 1 makes it live**, so
they ship together.

- **Send** the full bcc list — the rep asked for those recipients, including their dropbox.
- **Persist** a filtered list: drop any address whose domain is in `getInboundDomains()`
  (`src/lib/email/inbound/tokens.ts`). Reuse that helper; do not hardcode a domain.
- Apply it where the send route inserts the `emails` row. Leave `to_emails`/`cc_emails` alone
  in this change — an own-domain address there is a different (inbound) path already handled.
- `getInboundDomains()` throws when `INBOUND_EMAIL_DOMAINS` is unset. The outbound send path
  must keep working with inbound disabled, so **guard the call** — a throw here must not break
  a send. Fall back to persisting the list unfiltered rather than failing.

**Test:** send with `bcc: ["teammate@example.com", "bcc+s<token>@lead-crm.zunkireelabs.com"]`
→ the built MIME's `Bcc:` header contains **both**, and the persisted `bcc_emails` contains
**only** `teammate@example.com`. Plus: `INBOUND_EMAIL_DOMAINS` unset → send still succeeds.

---

## Gates — all four, paste the full output

```bash
npm run build
npx tsc --noEmit
npx eslint --max-warnings 50 <changed files>
npm run test
```

Local hands-on is **not** expected to complete for the delivery behavior — local has no
connected Gmail inbox and its schema is behind (`tenant_email_settings.inbound_enabled` is
missing, i.e. local lacks migration 191). Say so rather than working around it. The MIME-level
behavior is fully covered by the raw-decoding tests, which is the right instrument here anyway.

## Report

Diff summary; the four gates' exact commands and full output (re-run independently on review);
confirmation that test 1 fails pre-fix, with the failing output; what the `keepBcc` typing
required; the `sendMessage` caller inventory from change 1's blast-radius check; and any
deviation from this spec with reasoning.

Branch `fix/composer-bcc-delivery` off the latest `origin/stage`. PR against `stage`,
**unmerged**, with the hard gate stated in the PR body.

## What this unblocks

Smoke T4 (EdgeX-sent-copy dedup) — still an open unknown: whether Gmail preserves the
`<uuid@edgex-crm.com>` Message-ID stamped at `gmail-client.ts:188`, which step-5 dedup in
`bcc-route.ts` depends on. That re-test is Sadin's, after this merges. Slice A's prod promotion
stays held until it passes.
