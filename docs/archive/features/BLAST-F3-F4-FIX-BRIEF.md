# Brief: F3 (email sends from the production domain) + F4 (no email cap)

**DO NOT START THIS until the F1/F2 PR is open and reviewed.** These are email-path changes;
folding them into the F1/F2 branch makes that PR unreviewable. Separate branch off the
latest `origin/stage`.

Findings context: `docs/BLAST-FINDINGS-2026-09-06.md`.

---

## F3 — local/dev email must not reach the real Resend account

**Files:** `src/lib/email/index.ts`, `src/lib/email/sender.ts`,
`src/lib/email/outbound/env-guard.ts`, `src/lib/email/outbound/send.ts`

**Problem (verified in review):**
- `sender.ts:44` — `const address = data?.domain_verified && customAddr ? customAddr : PLATFORM_EMAIL_ADDRESS;`
  A tenant's configured `from_address` is used ONLY when `domain_verified` is true, so every
  local/test tenant silently sends as `noreply@edgex.zunkireelabs.com` (`index.ts:20-24`) —
  the live production domain, hardcoded, with no env override in the path.
- `env-guard.ts:29-40` — `EMAIL_OUTBOUND_SANDBOX=true` does NOT suppress sending. It rewrites
  the `To:` to `EMAIL_TEST_RECIPIENTS` and prefixes the subject. The real Resend API call
  still happens, on the real key, against the real quota.

Net effect: any developer with `RESEND_API_KEY` in `.env.local` sends from the production
domain on production credentials. This is what happened during the 2026-09-06 blast run
(1,521 messages transmitted that day per Resend's own daily counter).

**Also still open:** the first blast attempt produced 3-12% `provider_error` bounces that
were attributed to `test@local.test` being unverified. That diagnosis is wrong —
`test@local.test` was never used as the from-address, because `domain_verified` was false and
`sender.ts` fell back to the platform address. **The real cause of those bounces is unknown.**
While you are in this code, determine it and report; do not close it on the old explanation.

**Change:**
1. Add a transport seam below `sender.ts` — the single place the Resend client is invoked.
   `EMAIL_TRANSPORT=stub` records the call (to, from, subject, body hash) and returns a
   synthetic provider id; `EMAIL_TRANSPORT=resend` does the real send.
2. Default to `stub` when `NODE_ENV !== "production"` **and** no explicit opt-in. A developer
   must set `EMAIL_TRANSPORT=resend` deliberately to reach the provider. Fail closed.
3. Make the sender identity env-scoped: `PLATFORM_EMAIL_HOST` becomes overridable via env
   (e.g. `PLATFORM_EMAIL_HOST=local.test`) so non-prod never claims the prod domain even when
   a real send is deliberately enabled.
4. Rename / re-document `EMAIL_OUTBOUND_SANDBOX` so it cannot be read as "no real sends" —
   it is a recipient redirect, nothing more. Update `flag.ts` and `env-guard.ts` comments.

**Tests:** stub transport records and does not call Resend; explicit `EMAIL_TRANSPORT=resend`
does; non-prod default is stub; `PLATFORM_EMAIL_HOST` override is reflected in the from-address.

---

## F4 — per-tenant email blast cap (this does not exist today)

**Problem:** SMS has `max_recipients_per_blast` (per-tenant, admin-editable, 1-20,000,
default 500) enforced in the send route. **Email has no equivalent.** The only nearby
constant is `MAX_RECIPIENTS_PER_CALL = 100` in `src/lib/inngest/functions/email-blast-send.ts:14`,
which is the Inngest batch size, not a ceiling. An email blast to Admizz's ~16,684 audience
is unbounded, against a shared Resend plan of 50,000/month across ALL tenants — roughly a
third of platform capacity in one click.

**Change:** mirror the SMS pattern exactly; do not invent a new shape.
1. Migration: add a per-tenant email blast recipient cap column (next migration number —
   `ls supabase/migrations/ | sort` and take the next; one number, one file). Additive,
   transactional, with a rollback line and before/after counts. **Default 2,000**, not
   SMS's 500 and not the 20,000 ceiling — deliberately low so a first real Admizz blast
   fails loudly and gets a conscious decision. Raising it is one admin click.
   **Per repo policy: no tenant-specific data, no literal UUIDs or slugs in the migration.**
2. Enforce it in the email blast send route BEFORE any compose/materialize — same ordering
   lesson as F1. Reuse the `MAX_RECIPIENTS_EXCEEDED` 422 shape and payload (`count`, `max`)
   so the UI handling is identical.
3. Settings UI + API: mirror `src/app/(main)/api/v1/sms/settings/route.ts` validation and
   `sms-settings-form.tsx`'s input.
4. Composer UI: mirror `blast-composer.tsx:206,348-353` — a null cap (settings not loaded)
   must never block.

**Tests:** over-cap email blast → 422 AND zero rows materialized (the F1 regression, applied
to email); under-cap unchanged; null cap does not block.

---

## Verification before PR

- `npm run test` green.
- `npm run lint` (NOT `npx eslint`) — report errors + warning count.
- Local blast-scale **Section 4** at 16,000 against `EMAIL_TRANSPORT=stub`. This is the first
  time Section 4 can run safely; it must complete without touching Resend. Confirm Resend's
  daily counter does not move.
- State plainly in the report whether the unexplained bounce cause was found.

## PR

To `stage`, squash, 1 approval from ani-shh. Body must state: that local email could reach the
production domain and now cannot, the new default cap and why it is 2,000, and the Section 4
result with proof no provider calls occurred.

Stop at PR open.
