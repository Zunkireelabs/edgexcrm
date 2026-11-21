# BRIEF — SMS Phase 2: compliance primitives (suppression, opt-out, quiet hours)

**For:** Sonnet executor session
**From:** Opus planning session, 2026-08-15
**Prerequisite:** PR #390 (Phase 1) merged to `stage`. Branch from `origin/stage` *after* it lands.
**Related:** `docs/SMS-PHASE1-BRIEF.md` (provider facts — §2's verified block is authoritative),
`docs/SMS-PHASE1-REVIEW.md` (the LOW findings carried forward below).

---

## 0. Before you touch anything

**STOP conditions:**
1. PR #390 is not yet merged to `stage` — this phase builds directly on `src/lib/sms/` and
   migration 202/203. Wait for it.
2. The working tree has uncommitted WIP (Sadin keeps `demo/cre-capital-local` work in progress).
   **Do not stash, commit, or discard it.** Use a separate worktree, as you did for Phase 1.
3. Migration number 204 is already taken (`ls supabase/migrations | sort` — verify immediately
   before writing).

**Unlike Phase 1, this phase HAS a user-visible surface** — a public opt-out page. A screenshot of
it rendering on local dev is part of the deliverable, not optional.

**Do NOT do any of these** (later phases):
- No blast composer, no `/sms` dashboard, no sidebar entry, no manifest registration.
- No authenticated API routes (the only new route is the *public* opt-out one).
- No Inngest function.
- No `src/industries/` changes at all.
- No real Aakash network calls.

---

## 1. Why this phase exists

Aakash gives us **no free-form inbound**. We cannot receive "STOP". That single fact drives
everything here:

- We can never print "Reply STOP" in a message — it would be a promise we cannot keep, to students.
  Opt-out has to be a **link**.
- **Nepal has no DND registry** (unlike India's TRAI system), so there is no external suppression
  list to check against. We must own ours entirely.
- Quiet hours cannot be enforced by the provider, so we enforce them ourselves before dispatch.

Phase 3 (the blast UI) must not be built until these exist, because the moment a UI can select
4,000 students there has to already be a mechanism that says "not this one, and not at 2am".

---

## 2. Scope

One migration, three new `src/lib/sms/` modules, one public route + page, tests. Plus the small
Phase 1 cleanup in §7.

### 2a. Migration `204_sms_suppressions_and_optout.sql`

Follow `_TEMPLATE.sql`: `BEGIN`/`COMMIT`, idempotent, rollback line, before/after counts, and the
`INSERT INTO public.schema_migrations (version)` self-record.

**`sms_suppressions`** — the do-not-contact list:
```
id UUID PK, tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
phone_e164 TEXT NOT NULL,          -- normalized '+9779800000000' — the join key
reason TEXT NOT NULL CHECK (reason IN ('opt_out','manual','hard_bounce','complaint','invalid')),
source TEXT,                       -- 'optout_link' | 'admin' | 'import' | 'provider'
lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
```
`CREATE UNIQUE INDEX uq_sms_suppression_tenant_phone ON sms_suppressions (tenant_id, phone_e164);`

**Note the storage format differs from Phase 1's `to_phone`.** `sms_messages.to_phone` holds the
bare 10-digit form the v3 API wants; suppression keys on **normalized E.164** (`+977…`) because it
must survive matching against `leads.phone`, form submissions, and manual admin entry, which arrive
in the five different shapes documented in migration 158. Put a comment on the column saying so —
this asymmetry will otherwise look like a bug.

**`sms_optout_tokens`** — one **stable, reusable** token per (tenant, phone):
```
token TEXT PRIMARY KEY,            -- base62, 10 chars, CSPRNG
tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
phone_e164 TEXT NOT NULL,
lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
```
`CREATE UNIQUE INDEX uq_sms_optout_tenant_phone ON sms_optout_tokens (tenant_id, phone_e164);`

**Why one stable token per person, not per message:** it keeps the footer short (every character
is billed), and it means someone can opt out from a message we sent them three months ago. `used_at`
is a record, not a gate — the link must keep working after use, or a person who taps it twice sees
a broken page and concludes we ignored them.

RLS on both: SELECT via `tenant_id IN (SELECT get_user_tenant_ids())`;
`is_tenant_admin(tenant_id)` FOR ALL on `sms_suppressions` (reps manage the DNC list);
service_role FOR ALL on both. `sms_optout_tokens` gets **no** user-facing INSERT policy — tokens are
minted server-side only.

### 2b. `src/lib/sms/optout.ts`

```ts
export function generateOptOutToken(): string            // 10 chars base62, crypto.randomBytes
export async function getOrCreateOptOutToken(
  db: ScopedClient, tenantId: string, phoneE164: string, leadId: string | null
): Promise<string>
export function optOutUrl(token: string): string         // `${base}/u/${token}`
```
`optOutUrl` reads `SMS_OPTOUT_BASE_URL`, falling back to `NEXT_PUBLIC_APP_URL`. Add
`SMS_OPTOUT_BASE_URL=` to `.env.example` with a comment explaining the economics: the footer
`Opt out: edgex.zunkireelabs.com/u/aB3dEf9k` is ~44 characters — **28% of a 160-char English
credit, and well over half a 70-char Nepali one**. A short domain is a real cost saving, not
cosmetics. (Registering one is Sadin's call; the env var makes it a config change.)

`getOrCreateOptOutToken` must be **race-safe** — concurrent blast rendering will call it for the
same number simultaneously. Use `INSERT ... ON CONFLICT (tenant_id, phone_e164) DO NOTHING`, then
`SELECT` the winning row. Do not pre-check-then-insert.

### 2c. `src/lib/sms/suppression.ts`

```ts
export async function loadSuppressedPhones(
  db: ScopedClient, tenantId: string, phonesE164: string[]
): Promise<Set<string>>
export async function suppressPhone(
  db: ScopedClient, tenantId: string,
  params: { phoneE164: string; reason: string; source: string; leadId?: string | null;
            createdBy?: string | null; note?: string | null }
): Promise<void>                                          // idempotent: ON CONFLICT DO NOTHING
```
`loadSuppressedPhones` takes the batch and returns the intersection — **one query per batch, never
one per recipient.** A blast to 4,000 people must not issue 4,000 suppression lookups.

### 2d. Enforcement — two layers, deliberately

Phase 3 will filter suppressed numbers at audience materialization (writing rows with
`status='suppressed'`, so the blast has an auditable record of who was *not* texted). That is the
product behavior.

**This phase adds the safety net:** a final suppression check inside `sendQueuedBatch`
(`src/lib/sms/send.ts`), immediately before `applyEnvGuard`. Any recipient found suppressed there is
dropped, its row set to `status='suppressed'`, and a **warning logged** via `src/lib/logger`.

Yes, this is redundant with Phase 3. That is the point. The materialization filter is the one a
future refactor might accidentally bypass; this one sits on the single line of code that every send
in the system passes through. It should never fire — and if it does, we want to know loudly rather
than find out from a student.

### 2e. `src/lib/sms/quiet-hours.ts`

```ts
export function resolveSendWindow(
  now: Date, timezone: string, startHour: number, endHour: number
): { allowed: true } | { allowed: false; deferUntil: Date }
```
Resolution order for the timezone: `tenant_sms_settings.timezone` → `tenants.timezone` →
`'Asia/Kathmandu'`.

**Asia/Kathmandu is UTC+05:45.** The 45-minute offset breaks every naive `getHours() + offset`
approach. Use `Intl.DateTimeFormat` with `timeZone` and read the formatted parts — do not do
arithmetic on UTC hours. `deferUntil` must land exactly on `startHour:00` local, converted back to
UTC (so 08:00 NPT = 02:15 UTC).

Required test cases — this is where bugs hide:
- `2026-08-15T14:20:00Z` = 20:05 NPT → **outside** an 8–20 window (proves the 45 min matters; a
  UTC+6 approximation would wrongly allow it).
- `2026-08-15T02:16:00Z` = 08:01 NPT → allowed.
- `2026-08-15T02:14:00Z` = 07:59 NPT → deferred to `02:15:00Z` exactly.
- A late-night time deferring to the **next** morning, not the same day's past morning.
- `quiet_hours_enabled = false` → always allowed.

Phase 2 ships the pure function plus tests. **Do not wire the deferral release** — that needs
Inngest's `step.sleepUntil`, which is Phase 3. Writing `status='deferred'` + `deferred_until` is
also Phase 3.

### 2f. Footer integration in `render.ts`

Extend the Phase 1 `renderMessage` so the opt-out footer is composed in, and **verify the credit
count is computed on the FINAL string** — prefix + body + footer — not on the raw body. If Phase 1
counts segments before the footer is appended, every cost estimate in Phase 3 is wrong and
under-reports. Check this explicitly and state the finding in your report either way.

Default footer text: `Opt out: {url}`. **Never emit "Reply STOP", "Send STOP", or any variant** —
add a unit test asserting the rendered body does not match `/reply\s+stop/i`. That test is not
paranoia; it is the one mistake in this feature that would be visible to thousands of students and
impossible to retract.

### 2g. The public opt-out surface

**Route:** `src/app/api/public/sms/opt-out/[token]/route.ts`
**Page:** `src/app/(widget)/u/[token]/page.tsx`

Copy the unauthenticated-token pattern from the existing consent flow
(`src/app/api/public/consent/[token]/route.ts`, `src/app/(widget)/consent/[token]/page.tsx`).

**The single most important rule in this phase: GET must NOT opt anyone out.**

Link-preview crawlers, carrier link-scanners, and antivirus proxies fetch every URL in an SMS
before the human sees it. A GET-triggered opt-out would silently unsubscribe people who never
touched the link, and we would have no way to know it happened. So:
- `GET` renders a confirmation page: "Stop receiving SMS from {tenant}?" + a button. It reads the
  token and shows the masked phone (`98•••••434`), nothing more.
- `POST` performs the suppression, then renders confirmation.
- An unknown/expired token renders a neutral "This link is no longer valid" page — **never a 404
  and never an error trace**, and never reveals whether the token existed.
- The page is `force-dynamic`, has no auth, and must not leak the tenant's full lead data — the
  masked phone and the tenant's display name only.

Use `scopedClientForTenant` / service client deliberately here (the caller is anonymous), and scope
every query by the token's `tenant_id`.

---

## 3. Tests

- `quiet-hours.test.ts` — the five cases in §2e. Non-negotiable.
- `optout.test.ts` — token format/charset, `optOutUrl` composition, and concurrent
  `getOrCreateOptOutToken` returning the same token (hit the real local DB, as
  `credits-idempotency.test.ts` does).
- `render.test.ts` — footer composition, segment count computed on the final string, and the
  `/reply\s+stop/i` assertion.
- `suppression.test.ts` — batch lookup returns the right intersection; `suppressPhone` is
  idempotent.
- A `send.ts` test proving the §2d safety net drops a suppressed recipient **and** that the
  remaining recipients still send.

DB-touching tests follow Phase 1's precedent: skip cleanly when the local Supabase stack is down,
since CI's Test job has no database.

## 4. Verification before the PR

1. Migration 204 applies cleanly on local; re-applying it is a no-op.
2. `npm run build`, `npx eslint --max-warnings 50 .`, `npm run test`, `tsc --noEmit` — all clean.
3. **Screenshot of the opt-out page** at `/u/<token>` on local dev, in both the confirm and
   confirmed states. Phase 1 had no surface; this one does, and the standing rule is that a UI
   phase is not verified without a screenshot.
4. Manual proof of the GET/POST split: `curl` the page URL and show in psql that **no** suppression
   row was created; then POST and show the row appear.

## 5. PR

Branch from the latest `origin/stage` (after #390 lands), rebase before merge, target **`stage`**.
Title: `feat(sms): Phase 2 — suppression, opt-out link, quiet hours`.

State in the body that SMS remains dark (`SMS_ENABLED=false`) and that migration 204 is local-only.

**Stop at the PR.** Do not merge, do not apply migrations to stage or prod, do not enable flags.

## 6. Report back with

- What you built, and anything in this brief that was wrong or impossible.
- The `render.ts` segment-counting finding from §2f (was the footer already included or not?).
- The opt-out page screenshots.
- The GET-doesn't-suppress proof.
- Output of all four verification commands.

---

## 7. Carried-forward cleanup from the Phase 1 review

Do these in the same PR — all small, all in files you are already touching.

- **L-1 (do this one properly, it is not cosmetic):** `sms_credits_settle` hardcodes
  `ref_type = 'sms_blast'` in its ledger inserts while `sms_credits_reserve` takes `p_ref_type` as a
  parameter. Phase 5's 1:1 sends (`ref_type = 'sms_message'`) would write mislabeled ledger rows.
  Add a `p_ref_type TEXT` parameter to `sms_credits_settle` and pass it through. **Migration 202 is
  merged by now, so this needs a new `ALTER`/`CREATE OR REPLACE` in migration 204**, not an in-place
  edit. Changing the function signature means `DROP FUNCTION` + recreate — do it in the same
  transaction, and update the caller in `src/lib/sms/send.ts`.
- **L-2:** `AakashSendResponseValid.id` is typed `number`; the live value is a string
  (`"13421_178679570267557"`). Fix the type.
- **L-3:** persist the `shortcode` field from the send response (observed `"AT_Alert"`) onto
  `sms_messages` — add the column in migration 204. It is the only record of which sender ID a
  message actually went out under, and that value changes the moment a branded sender ID is
  registered with NTC/Ncell (in progress).
- **L-4:** attach the repo's `update_updated_at()` trigger to `tenant_sms_settings`,
  `sms_credit_accounts`, `sms_blasts`, and `sms_messages` — the convention every other table
  follows (see migration 176). Without it `updated_at` never moves.
- **L-5:** add a comment on `applyEnvGuard` noting that the `[SANDBOX intended: …]` prefix inflates
  the body and can push it over a segment boundary, so sandbox credit totals are not a reliable
  production cost estimate.
