# Slice A follow-up — sender-guard gap + Reply-To display name + doc fix

**For:** Sonnet executor session
**Written by:** Opus planner session, 2026-07-30
**Base:** `origin/stage` (currently `2c4e13b7`, slice A merged as `0c6e9035` via PR #314)
**Migrations:** none. Do not write one. Do not apply anything to any DB.

## Why this exists

PR #314 shipped the BCC dropbox to stage and the live smoke passed every case that
was testable. Post-smoke review found **two defects in the original spec** (not
Sonnet defects — the spec was wrong) plus one stale doc. All three are small and
land in one PR.

### Scope boundary — read this first

- **In scope:** changes 1, 2, 3 below, their tests, and the four gates.
- **Explicitly OUT of scope:** re-running smoke test T4 (the EdgeX-sent-copy dedup
  case), the prod promotion of slice A, migration 192, anything touching the
  reply-path loop guard, and anything touching `parseSenderVerdict`.
- **Stop at review.** Open the PR against `stage`, leave it unmerged, and report.
  Do not merge. Do not apply DB changes. Do not promote to `main`.

---

## Change 1 — sender-authenticity guard must accept the rep's connected mailboxes

**File:** `src/lib/email/inbound/bcc-route.ts`, step 2 (currently lines 71–93).

**The bug.** The guard requires the BCC'd mail's `From` to equal the token owner's
`auth.users.email`. But a rep's **login** address is routinely not the **mailbox
they send from**. Sadin logs in as `sadin@zunkireelabs.com` and sends from
`shrestha.sadin007@gmail.com`, so his own dropbox rejects his own mail. This is
not an edge case — it is the normal configuration, which makes the feature
unusable for essentially every rep.

Live reproduction already on stage: `inbound_email_dead_letter` row with
`reason = 'bcc_sender_mismatch'` at `2026-07-29 17:16:03 UTC`.

**The fix.** Accept the `From` if it matches **either** the token owner's login
email **or** any `connected_email_accounts.email` row belonging to that same user.
Those rows are OAuth-verified mailboxes — the user proved control of them by
completing Google's consent flow — so they are *stronger* evidence of mailbox
control than the login address, which nobody verifies.

Replace step 2 with roughly this shape:

```ts
  // ── 2. Sender-authenticity guard — the security core of this slice ──────
  // Without this, anyone holding a leaked dropbox address could inject
  // fabricated "outbound" emails into a tenant's lead timeline — forged
  // history that looks first-party. The token alone is an addressing
  // secret, not proof of authorship.
  //
  // A rep's LOGIN address is routinely NOT the mailbox they send from
  // (sadin@zunkireelabs.com logs in; shrestha.sadin007@gmail.com sends), so
  // matching only auth.users.email rejected every real rep. Every
  // connected_email_accounts row for this user is an OAuth-verified mailbox
  // — stronger proof of mailbox control than the unverified login address —
  // so those count too. Scoped to THIS user, and (via scopedClient) THIS
  // tenant: a teammate's connected mailbox must never authorize a write
  // against another rep's dropbox token.
  const allowedSenders = new Set<string>();
  if (p.userId) {
    const { data: userRes } = await db.raw().auth.admin.getUserById(p.userId);
    const loginEmail = normalizeEmail(userRes?.user?.email ?? null);
    if (loginEmail) allowedSenders.add(loginEmail);

    const { data: accounts } = await db
      .from("connected_email_accounts")
      .select("email")
      .eq("user_id", p.userId);
    for (const acct of (accounts ?? []) as { email: string }[]) {
      const normalized = normalizeEmail(acct.email);
      if (normalized) allowedSenders.add(normalized);
    }
  }

  const fromEmail = fromParsed ? normalizeEmail(fromParsed.email) : null;
  if (!fromEmail || !allowedSenders.has(fromEmail)) {
    await writeDeadLetter({
      tenantId: p.tenantId,
      providerMessageId: p.resendEmailId,
      fromAddress: fromHeaderRaw ?? null,
      toAddresses: toRaw,
      subject: receiving.subject ?? null,
      reason: "bcc_sender_mismatch",
      rawEvent: { headers, allowed_sender_count: allowedSenders.size },
    });
    return;
  }
```

Then use `fromEmail` (already normalized) instead of re-normalizing further down;
leave `fromParsed.name` usage as-is for `from_name`.

**Invariants that must not regress:**

- `p.userId === null` → `allowedSenders` is empty → dead-letter. Fail-closed. Keep it.
- `From` matching a **different user's** connected account → still dead-letter.
  The `.eq("user_id", p.userId)` filter is what enforces this; do not drop it.
- `From` matching a connected account in a **different tenant** → still dead-letter
  (scopedClient injects `tenant_id`). Do not use `db.raw()` for this query.
- Log the **count** of allowed senders in `rawEvent`, never the addresses
  themselves — that turns a debug row into an address dump.
- `connected_email_accounts` has no status/revoked column (checked migrations 018
  and 025), so no additional filter. If you find one, filter on it.

**Known residual, do not try to fix here:** a rep sending via a Gmail *send-as
alias* still won't match, because the alias never appears in
`connected_email_accounts`. That dead-letters with a clear reason, which is the
correct fail-closed behavior. A user-managed "additional verified send addresses"
list is a separate slice.

**Tests** (`src/lib/email/inbound/bcc-route.test.ts` — extend, don't rewrite):

1. `From` = login email, no connected accounts → accepted (existing behavior holds).
2. `From` = a connected account email that differs from the login email → **accepted**
   (this is the regression test for the bug; it must fail before your fix).
3. `From` = a connected account belonging to a *different* `user_id` → dead-letter.
4. `p.userId === null` → dead-letter, zero `emails` writes.
5. Case/whitespace variation on `From` (`  SADIN@Zunkireelabs.COM `) → accepted.

---

## Change 2 — Reply-To needs a display name

**File:** `src/app/(main)/api/v1/email/send/route.ts`, line ~250 (`replyTo = minted.address;`).

**The problem.** Leads replying to EdgeX-sent mail see
`reply+s<40 hex chars>@lead-crm.zunkireelabs.com` in their To: chip. It reads as
phishing. Cause: `replyTo` is a bare address with no display name, and Gmail
renders the address when there is no name to render.

**Hard constraint — do not touch the token.** Do not shorten it, do not add a
readable alias, do not make it guessable. The reply path has **no sender guard**
(unlike the BCC path), so the 144-bit token is the only thing preventing an
attacker from injecting forged inbound history into a lead's timeline. The fix is
presentational only.

**The fix.** Wrap the minted address in a display name, exactly the way
`gmail-client.ts` already does for `from`:

```ts
        replyTo = label ? `"${label}" <${minted.address}>` : minted.address;
```

`MailComposer` (nodemailer) parses and re-encodes this form — the same shape is
already used for `from` at `gmail-client.ts:194`.

**Resolving `label`** — first usable value wins:

1. `account.display_name`, **but only if it does not contain `@`**. Today the
   OAuth callback sets `display_name: email` (`inboxes/callback/route.ts:137`), so
   this is almost always email-shaped and must be skipped. A display name that is
   an email address *different from* the actual address is precisely the shape
   anti-spoofing heuristics flag — that would be worse than the raw token.
2. The sending user's name: `auth.admin.getUserById(auth.userId)` →
   `user_metadata.name ?? user_metadata.full_name`. This is the canonical name
   source in this codebase (see `api/v1/team/route.ts:82`).
3. The tenant's name: `db.raw().from("tenants").select("name").eq("id", auth.tenantId)`.
   Use `raw()` — `scopedClient` injects `.eq("tenant_id", ...)` on every table and
   `tenants` has no such column, so the scoped path would error.
4. Nothing usable → `minted.address` bare, i.e. today's behavior.

Put the resolution in a small helper and **call it inside the existing
`try { ... } catch` block** at lines 200–261. That block already swallows failures
and falls back to `replyTo = undefined`, so a name-lookup hiccup can never break
an outbound send. Do not add I/O outside it.

**Sanitize the label.** It is user-controllable (`user_metadata`), so it is a
header-injection vector:

```ts
export function sanitizeDisplayName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/[\r\n"\\<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
  return cleaned.length > 0 ? cleaned : null;
}
```

Strip CR/LF, quotes, backslashes, angle brackets; collapse whitespace; cap length.
Unit-test the sanitizer directly, including a CRLF payload
(`"Rep\r\nBcc: attacker@evil.com"`) and an all-punctuation input that reduces to
empty (must return `null`, not `""`).

**Tests** (`src/app/(main)/api/v1/email/send/route.test.ts`):

1. `display_name` email-shaped + `user_metadata.name` present → `replyTo` is
   `"Sadin Shrestha" <reply+s…@…>` and the token is byte-identical to `minted.address`.
2. No name anywhere → `replyTo === minted.address` (unchanged).
3. Name lookup throws → `replyTo` still gets set from the mint (the label is
   optional; a name failure must not null out `replyTo` or trip the
   cleanup/rollback path).
4. `EDGEX_INBOUND_ENABLED !== "true"` → `replyTo` undefined, no lookups at all.

---

## Change 3 — CLAUDE.md dashboard login is dead on both environments

`admin@zunkireelabs.com` was renamed to `sadin@zunkireelabs.com` on **both** stage
and prod (user_id `d23c24e2-8242-42b6-9a6f-bcab8c0cfb18`, done via the Supabase
Admin API so `auth.users` and `auth.identities.identity_data` stayed in sync). Zero
rows remain on the old address, so the documented credential now fails everywhere.

Fix **both** occurrences:

- `CLAUDE.md:497` — `- Email: \`admin@zunkireelabs.com\`` → `sadin@zunkireelabs.com`.
- `CLAUDE.md:513` — the stage-clone line's example address.

Do **not** mass-rewrite the ~9 hits under `docs/` — those are historical briefs and
session-log entries that were accurate when written. `CLAUDE.md` only.

---

## Gates — all four, paste the output

```bash
npm run build            # clean
npx tsc --noEmit         # clean
npx eslint --max-warnings 50 <changed files>   # clean
npm run test             # full suite green, including your new cases
```

Then **hands-on local** (`npm run dev`):

- Log in as `sadin@zunkireelabs.com` / `edgexdev123`. **Note:** local Supabase still
  has the OLD `admin@zunkireelabs.com` — the rename was applied to stage and prod
  only. Run `supabase start` first; if login fails, that rename is still pending on
  local and you should say so in your report rather than working around it.
- Send an email from a lead detail view with `EDGEX_INBOUND_ENABLED=true` and
  inspect the composed message: `Reply-To` must render as `"Name" <reply+l…@…>`
  with the token intact.
- Confirm a send still succeeds with `EDGEX_INBOUND_ENABLED` unset.

## Report format

Diff summary, the exact commands and their full output (these get re-run
independently — self-reports are not trusted), the new test names and what each
one pins down, and the local hands-on notes: what you clicked, the literal
`Reply-To` value you observed, and whether the local rename was pending. Flag any
deviation from this spec and why.

Branch `feature/email-slice-a-guard-replyto` off the latest `origin/stage`, PR
against `stage`, **unmerged**.

Also `git add` these two currently-untracked planner docs so they land with your PR
instead of sitting in a dirty working tree:

- `docs/email-productionization/SLICE-A-GUARD-REPLYTO-FIX-BRIEF.md` (this file)
- `docs/email-productionization/BYO-OAUTH-INTERNAL-LANE-INVESTIGATION.md`
