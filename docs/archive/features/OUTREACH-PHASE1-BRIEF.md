# Outreach Phase 1 — Email Blast (the Brevo replacement)

**Status:** briefed, not started
**Branch:** `feature/email-blast` (branch from the LATEST `origin/stage`, **after #434 merges**)
**Next free migration number:** **212**
**Author:** Opus planning session, 2026-08-23
**Depends on:** Phase 0 (PR #434, migration 211) — this brief assumes `src/lib/email/outbound/` exists

---

## §0 Rules of engagement

1. **STOP AT REVIEW.** Build, push, open a **DRAFT** PR to `stage`. No merge, no self-approve, no
   promotion to `main`. Report back and wait.
2. **Never touch the stage or prod database.** Migration 212 goes to your **local** Docker Supabase
   only. Verify stage/prod ledger state via `git ls-tree origin/stage supabase/migrations/` — the way
   Phase 0 did it — not by connecting.
3. **Do not start until #434 is merged to `stage`.** This phase builds directly on
   `sendQueuedEmailBatch`, `email_messages` and the suppression module. Branching before that lands
   means rebasing a large PR onto a moving spine.
4. **This phase HAS a visible surface.** Your report must include screenshots from local `npm run dev`
   of the composer, the recipient preview, and the send-confirm dialog. A phase with UI that reports
   only green tests will be sent back.
5. Rebase onto `origin/stage` again immediately before reporting.

---

## §1 What this is

Admizz runs their email campaigns in Brevo today and has decided to move them into EdgeX. A campaign
is a **blast**: one message, one audience, one shot. That is a different product from Outreach's drip
cadence, and this phase builds it.

Phase 0 gave us a send pipe with compliance. Phase 1 gives that pipe an audience and a UI.

**The reference implementation is the SMS blast surface**, which is the same product for the other
channel, already shipped and already through review: `sms_blasts` (migration 203),
`src/lib/sms/audience.ts`, `src/app/(main)/api/v1/sms/blasts/*`,
`src/lib/inngest/functions/sms-blast-send.ts`, and the UI in
`src/industries/_shared/features/sms/ui/`. Read all of it before writing anything. Where this brief
says "mirror the SMS shape", that is literal.

---

## §2 Scope

### In scope

- Migration **212** — `email_blasts`.
- **Extract** the channel-neutral core of `src/lib/sms/audience.ts` into `src/lib/outbound/audience.ts`
  with a per-channel adapter (§4). SMS behaviour must not change.
- API routes under `/api/v1/email-blasts/*` mirroring the SMS blast routes.
- Inngest function `email-blast-send` — the only thing that ever calls `sendQueuedEmailBatch` for a blast.
- A new shared feature `src/industries/_shared/features/email-campaigns/` registered for
  `education_consultancy`, with composer / recipient preview / send-confirm / blast detail UI.
- The daily-cap decision, implemented (§6). This is the part most likely to be skipped; it is not optional.

### Out of scope

- Any change to `markDraftSent` or the sequence engine — **Phase 2**.
- `channel = 'sms'` on sequence steps — **Phase 3**.
- Registering `outreach` (the drip) for education — **Phase 4**. This phase registers
  `email-campaigns` only; the two are deliberately decoupled so Admizz gets campaigns without
  waiting for the drip.
- Folding `/sms` into a unified surface — **Phase 5**. Leave the SMS sidebar item exactly where it is.
- Open/click tracking, A/B testing, drip-from-blast.
- **Do not rename or touch the existing education `/campaigns` feature** (referral/leaderboard). See §7.3.

---

## §3 Migration 212 — `email_blasts`

Mirror `sms_blasts` (migration 203, lines 16-38), minus everything credit-related, plus the fields
email needs. Additive, transactional, rollback block, before/after counts, RLS + the standard three
policies.

```
id, tenant_id
name                     TEXT NOT NULL          -- internal label, never sent
subject_template         TEXT NOT NULL          -- raw {{merge}}, no footer
body_template            TEXT NOT NULL          -- raw {{merge}}, no footer
from_name_override       TEXT                   -- NULL => resolveTenantSender's default
audience_filter          JSONB                  -- encoded FilterTree (src/lib/filters)
audience_snapshot_count  INT
status                   TEXT NOT NULL DEFAULT 'draft' CHECK (status IN
                           ('draft','scheduled','queued','sending','throttled','sent',
                            'partially_failed','failed','cancelled'))
scheduled_for            TIMESTAMPTZ
recipients_total         INT NOT NULL DEFAULT 0
recipients_sent          INT NOT NULL DEFAULT 0
recipients_failed        INT NOT NULL DEFAULT 0
recipients_suppressed    INT NOT NULL DEFAULT 0
created_by, started_at, completed_at, created_at, updated_at (+ update_updated_at trigger)
```

`'throttled'` is the one status `sms_blasts` does not have. It exists because of §6 — read that before
deciding it is redundant.

**No change to `email_messages`.** Phase 0 deliberately gave it a generic `source` / `source_id`
pair instead of a `blast_id` FK. A blast sets `source = 'blast'`, `source_id = <blast id>`, and the
`uq_email_message_source_lead` unique index (amended in Phase 0 to be non-partial precisely so this
phase can use it) is the idempotency backbone.

---

## §4 The audience refactor — `src/lib/outbound/audience.ts`

`src/lib/sms/audience.ts` is the highest-risk module in the SMS feature — its own header comment
says it is "the module where a mistake texts the wrong people". Its core is channel-neutral:

- compile the `FilterTree` through `planFilter` / `compileFilter`
- resolve leads through the caller's **own visibility** (`visibleLeadsBase`, the uncapped
  `leads_visible_to_user` RPC path) — never a hand-rolled `.eq("tenant_id", ...)`
- `deleted_at IS NULL`
- deterministic sort, then collapse duplicates
- batched suppression lookup

Only the *contactability* part is channel-specific: which lead column, how it normalizes, what counts
as invalid, and the exclusion taxonomy.

**Extract, do not copy.** Move the shared core to `src/lib/outbound/audience.ts` parameterized by a
channel adapter:

```ts
interface ChannelAdapter<T> {
  contactOf(lead: LeadRow): string | null;      // leads.phone | leads.email
  normalize(raw: string): T | null;             // E.164 | lowercased address
  suppressionKey(v: T): string;
  classify(raw: string): "ok" | ExclusionReason;
}
```

Email's exclusions: `noEmail`, `malformed`, `suppressed`, `duplicateEmail`. It has no analogue of
`foreignNumber`; do not invent one.

**Copy-pasting this module into an email twin is the wrong answer** and will be sent back. Two
divergent copies of the visibility logic is exactly the "four drifted predicate mirrors" problem the
advanced-filters work exists to collapse.

### The hard constraint on this refactor

**SMS audience behaviour must be byte-for-byte unchanged.** `src/lib/sms/audience.test.ts` and the
three `blast-composer.*.test.ts` files are your regression gate — they must pass **untouched**. If you
find yourself editing an SMS audience test to accommodate the refactor, stop: you have changed
behaviour, and SMS is live for Admizz.

Report explicitly, in your own words, what you did to convince yourself SMS is unaffected.

### Scale

Admizz has 16,684 leads. `resolveAudience` currently loads full lead rows into memory to resolve
`{{merge}}` tokens. Verify what a full-tenant email audience actually does at that size — time it and
report the number. If it is bad, say so rather than shipping it; a fix may be its own follow-up, but
an unmeasured 16.7k path is not acceptable.

Also inherit Phase 0's lesson: chunk every `.in()` at 250. A 16,684-element PostgREST filter blows the
URL length limit — a bug this repo has hit before.

---

## §5 Routes and the send path

Mirror the SMS routes one-for-one under `/api/v1/email-blasts/`:
`route.ts` (list/create), `[id]/route.ts`, `[id]/audience-count`, `[id]/audience-preview`,
`[id]/preview`, `[id]/messages`, `[id]/send`, `[id]/cancel`.

Every route: `authenticateRequest()` → `getFeatureAccess(auth.industryId, FEATURES.EMAIL_CAMPAIGNS)`
→ `apiForbidden()`, plus `isBulkEmailEnabledForTenant()` on the mutating ones, plus `scopedClient(auth)`.

### `/send` — the ordering that makes this safe

Mirror `sms-blast-send.ts`. The route materializes and enqueues; the Inngest function sends. There is
exactly **one** send path.

1. Re-resolve the audience (never trust the snapshot count from compose time).
2. **Materialize every recipient row up front**, in chunks, via
   `.upsert(chunk, { onConflict: "source_id,lead_id", ignoreDuplicates: true })`. This is what makes a
   re-run safe, and it only works because of the Phase 0 amendment.
3. Materialize suppressed recipients too, as `status = 'suppressed'` rows — auditable, never silently
   dropped. Mirror SMS.
4. Flip the blast to `queued`, emit `email/blast.send`.
5. The Inngest function loads batches as memoized `step.run`s and calls `sendQueuedEmailBatch` per
   batch, then finalizes counters and status.

`/cancel` must cancel remaining `queued` rows and be safe to race against the worker — read
`finalizeBlast`'s F-1 comment in `sms-blast-send.ts`: a blast the user already cancelled must never be
transitioned out of `cancelled`, and "cancelled" is counted separately from "failed" because
`recipients_failed` means *we tried and it failed*, not *we never got to it*.

---

## §6 The daily cap — the decision this phase must make

`tenant_email_settings.daily_send_cap` defaults to **2000**. A full Admizz blast is **16,684**.
A single campaign is over eight times the default cap.

The failure mode to design out: a blast sends 2000, stops, and reports success. Two thousand students
get an email, 14,684 do not, and the UI says "sent".

**Required behaviour:**

- At compose time, when the resolved audience exceeds the tenant's **remaining** cap for today, the UI
  says so plainly, with the numbers, before the send button is reachable. Not a toast — a visible
  statement of what will actually happen.
- The worker treats hitting the cap as a first-class state: remaining rows stay `queued`, the blast
  goes to **`throttled`** (not `sent`, not `failed`), and it re-emits itself for the next window so it
  resumes automatically.
- A `throttled` blast displays as in-progress with a resume time, never as complete.

Whether Admizz's cap gets raised instead is Sadin's call, not yours — but the throttle path must
exist regardless, because a cap that can only be respected by being large enough is not a cap.

Also respect Resend's per-second limits. Phase 0's bounded concurrency handles burst; this handles volume.

---

## §7 Feature registration and UI

### 7.1 Registry + manifest

- Add `EMAIL_CAMPAIGNS: "email-campaigns"` to `FEATURES` in `src/industries/_registry.ts`.
- New shared feature folder `src/industries/_shared/features/email-campaigns/` with `meta.ts`:
  `industries: [INDUSTRIES.EDUCATION_CONSULTANCY]`. Shared folder, education-only registration —
  exactly the precedent `sms/meta.ts` sets, and for the same reason (other tenants buy this later;
  promoting after the fact is what the architecture doc tells us to avoid).
- Register in `education-consultancy/manifest.ts`: `{ meta: emailCampaignsMeta }` plus a sidebar entry
  in the Marketing section with `minRoles: ["owner","admin"]`.
- Page shell at `src/app/(main)/(dashboard)/email-campaigns/page.tsx` — thin, calls `getFeatureAccess`
  → `notFound()`, delegates to the UI component.
- **Sidebar icons are string names**, not `LucideIcon` imports — the manifest crosses the Server →
  Client boundary and a component reference crashes the dashboard. Register the name in
  `INDUSTRY_ICONS` in `src/components/dashboard/shell.tsx` if it is not already there.

### 7.2 Gating asymmetry — read this before wiring it

The SMS sidebar entry uses `entitlement: "sms_enabled"`, which resolves through
`resolveEntitlements()` against the `tenants.entitlement_overrides` JSONB. Phase 0's
`bulk_email_enabled` is a **column on `tenant_email_settings`**, not an entitlements key. They are
different mechanisms.

Do **not** wire `entitlement: "bulk_email_enabled"` in the manifest — it will silently never match.
Gate the sidebar on feature access + `minRoles`, and gate the **API** on
`isBulkEmailEnabledForTenant()`. Note the asymmetry in your report; unifying the two is a real cleanup
but not this phase's job.

### 7.3 Naming — provisional, and Sadin owns the final call

Education already has a `/campaigns` sidebar item: the **referral/leaderboard** feature, unrelated to
marketing. Two items called some flavour of "Campaigns" in one Marketing section will confuse Admizz
daily.

For now: route `/email-campaigns`, sidebar label **"Email Campaigns"**. **Do not rename, move, or
otherwise touch the existing referral feature** — that decision is Sadin's and is tracked separately.
Flag the collision in your report so it does not get lost.

### 7.4 UI

Model on `sms/ui/`: `blast-composer.tsx`, `recipients-preview-dialog.tsx`, `send-confirm-dialog.tsx`,
`blast-detail.tsx`, `blast-workspace.tsx`.

Email-specific: a subject line field, an HTML body editor, a from-name override, and a **preview
rendered against a real lead** so merge tokens are visibly resolved before sending. The send-confirm
dialog states the recipient count, the suppressed count, the from address as
`resolveTenantSender` will actually produce it, and any cap warning from §6.

Reuse existing shadcn components. Do not introduce a new editor dependency without saying why.

---

## §8 Tests

Beyond ordinary coverage:

1. **SMS parity** — the existing SMS audience and blast-composer tests pass untouched after the refactor.
2. **Idempotent materialization** — running `/send` twice over the same blast produces exactly one row
   per lead and one provider call per row. This is Phase 0's §5.1 at blast scale.
3. **Suppressed materialization** — a suppressed lead yields a `status='suppressed'` row, not a silent drop.
4. **Cap throttle** — an audience over the remaining cap sends up to the cap, leaves the rest `queued`,
   sets `throttled`, and resumes. Assert it never reports `sent`.
5. **Cancel race** — a blast cancelled mid-flight is never transitioned out of `cancelled`, and
   cancelled rows are counted separately from failed.
6. **Visibility scoping** — a counselor-scoped user's audience contains only leads they can see.
   Non-negotiable: this is the "blast the wrong people" failure, and it is a tenant-isolation-class bug.

Note which of these are DB-backed and therefore **skip in CI** (CI has no local Supabase — Phase 0
found 19 such skips). State the local vs CI counts explicitly in your report, as Phase 0 did.

---

## §9 Verification

Gates: `npm run build`, `npx eslint --max-warnings 50`, `npm run test`, `npx tsc --noEmit`,
migration 212 applied locally with before/after counts, rollback verified.

Live, on local `npm run dev`, with `EMAIL_OUTBOUND_SANDBOX=true`:

- **Screenshots** of the composer, recipient preview, send-confirm dialog, and a completed blast detail.
- A real blast to a **3-lead** local audience: all three arrive at the sandbox recipient, each with the
  footer link and `List-Unsubscribe` headers **verified on the received message**.
- Re-run the same blast's `/send`: assert no second delivery.
- One blast against an audience larger than a deliberately-lowered `daily_send_cap`, showing the
  `throttled` state and the resume.
- One cancel mid-flight.

Report actual outputs and numbers, not "verified".

---

## §10 Report (§10 of Phase 0 applies verbatim)

File-by-file summary; the §8 test results with local vs CI counts; the audience-refactor
SMS-safety argument in your own words; the 16.7k audience-resolution timing from §4; migration 212
before/after counts plus git-based confirmation that stage and prod ledgers are untouched; screenshots;
and anything this brief got wrong. Phase 0's executor found two real brief errors and a production
middleware bug by not routing around them quietly — same standard here.

Then stop.

---

## §11 Phase map

| Phase | What | Migration | State |
|---|---|---|---|
| 0 | Email send spine + compliance, dark | 211 | PR #434, draft, green, awaiting approval |
| **1** | **Email blast — this brief** | **212** | **briefed** |
| 2 | Drip learns to send + auto-send on `due_at` | 213 | not briefed |
| 3 | Channel per step | 214 | not briefed |
| 4 | Register `outreach` for education + bulk enroll | — | not briefed |
| 5 | `/sms` collapses into Outreach | — | not briefed |

Open business items, none blocking the build: consent basis for emailing Admizz's 16,684 leads
(blocks the first real send, not the code); Resend plan limits at 16.7k; the `/campaigns` naming
collision (§7.3).
