# REVIEW — SMS Phase 1 (PR #390, `feature/sms-phase1-core`)

**Reviewer:** Opus planning session
**Original review:** 2026-08-15, against `d6279bca`
**Fixes verified:** 2026-08-15, against `9dc79879`
**Reconstructed + re-run:** 2026-08-15 (see provenance note)
**Verdict:** approve for merge to `stage` once §NEW-1 is resolved. Migrations 202/203 remain
local-only; nothing applied to stage or prod.

> **Provenance note.** This file was reconstructed on 2026-08-15 after the original was lost before
> being committed. HIGH-1/2 and M-1..M-4 are restated from the fix commit `9dc79879` and its
> regression tests, which record them precisely; L-1..L-5 are restated verbatim from
> `docs/SMS-PHASE2-BRIEF.md` §7, where they were carried forward at the time. §NEW-1 is a **new
> finding from the reconstruction pass** — it was not in the original review and had not been
> reported before this document. It is not backdated.

---

## What was verified independently

Not taken from the executor's report — re-checked directly:

- **PR state.** #390 `OPEN`, `mergedAt: null`, base `stage`, head `9dc79879`, `mergeable:
  MERGEABLE`, `mergeStateStatus: BLOCKED`, **zero reviews recorded**. Blocked solely on the
  required human approval; stage needs 1 and admin bypass is off.
- **CI.** All 8 checks green — Lint, Type Check, Test, Build, Migration Guard, Promotion Source
  Guard, Destructive Script Guard, CodeRabbit (skipped by config).
- **Databases untouched.** `public.schema_migrations` tops out at
  `201_leads_tags_other_partial_index.sql` on **both** stage (`dymeudcddasqpomfpjvt`) and prod
  (`pirhnklvtjjpuvbvibxf`). No `sms*` tables exist on stage. 202 and 203 have touched neither.
- **Scope.** The diff is 18 files, all additive: `src/lib/sms/`, two migrations, one script,
  `.env.example`. No `src/app/`, no `src/industries/`, no `src/lib/inngest/`, no `outreach/`
  changes. The claim of "no user-visible surface" holds.
- **The credit-RPC fixes**, re-run in psql against a fresh local apply — see below.

---

## HIGH — both found in the credit RPCs, both fixed

The two RPCs are the only writers of `sms_credit_accounts`, so a defect in either is a defect in
the money. Both original versions **mutated the account first and wrote the ledger row second**,
which made the partial unique index decorative rather than load-bearing.

### HIGH-1 — `sms_credits_reserve` silently double-debited on retry

A retried call with the same `ref_id` — precisely what a re-run Inngest step does, and Inngest
re-runs steps as a matter of course — debited the balance again. The ledger insert that was
supposed to stop it ran *after* the `UPDATE`, so `ON CONFLICT DO NOTHING` swallowed the duplicate
ledger row while the second debit had already landed. The failure is silent: no error, no anomaly
in the ledger, just a balance that is quietly too low and no record of why.

### HIGH-2 — `sms_credits_settle` threw on retry

Same inversion, different symptom. The original split the outcome into `refund` (diff > 0) and
`settle_overage` (diff < 0), which left **diff = 0 — the case where our estimate was exactly right,
i.e. the common one — writing no ledger row at all**. With no row, the unique index had nothing to
catch a replay against, and the retry re-applied the account mutation and then violated a CHECK.
A settle that throws leaves `reserved` credits stranded on the account permanently.

**The fix, in both:** write the ledger row **first**, `RETURNING id`, and gate the account mutation
on whether that insert actually inserted. If it didn't, the call is a replay: return current state
and mutate nothing. A `settle` reason was added covering diff > 0, diff < 0 and diff = 0 alike, so
every settle always writes exactly one row for the index to catch.

**Verified, not accepted on report:** I re-applied migration 202 from scratch on local, ran a
repeated reserve and a repeated diff=0 settle with the same `ref_id` in psql, and confirmed exactly
one debit and one ledger row each. I then re-pointed the regression test at the *old* RPC
definition and confirmed it **fails** — a regression test that has never been seen to fail is not
evidence of anything. `credits-idempotency.test.ts` carries both cases.

---

## MEDIUM — live-payload corrections (all fixed in `9dc79879`)

`aakash.ts` was originally written against guessed response shapes. The preflight captures
contradicted it in four places, each now covered by a named test:

- **M-1** — `availableCredit()` read `credit`/`balance`; the live field is **`available_credit`**.
- **M-2** — `report()` read rows from top-level `data`; they are nested at **`data.result.data`**.
- **M-3** — v4's `Authentication token is invalid or expired.` fell through to `unknown` instead of
  mapping to `invalid_token`, so a dead token on the v4 read path would have looked retryable.
- **M-4** — the v4 send path comment said `/sms/v4/send-user`; it is **`/sms/v4/send`**. Cosmetic
  for Phase 1 (v3 ships) but recorded so the dead end isn't re-walked.

Migration 202 was edited in place, which is correct here and only here: it is unmerged and applied
nowhere but local. That stops being true the moment #390 lands.

---

## NEW-1 (HIGH) — `send.ts` matches provider results positionally, and invalid recipients shift the array

**This was not in the original review. It is a production correctness bug, and I would fix it
before merging rather than carry it into Phase 2.**

`sendQueuedBatch` writes provider results back to message rows by *index*:

```ts
const byIndex = outcome.result.valid;
for (let i = 0; i < groupMessages.length; i++) {
  const providerResult = byIndex[i] ?? byIndex[byIndex.length - 1];
```

`outcome.result.invalid` is never read anywhere in the function.

Aakash returns `valid[]` and `invalid[]` as **separate arrays**. Any recipient that fails validation
is absent from `valid[]`, so every subsequent entry shifts down by one and the positional match
silently misaligns. Concretely, on a 100-recipient batch where recipient #3 is invalid:

- recipients #4..#100 each receive **another recipient's** `provider_message_id`, `credit`, and
  `network`;
- recipient #100 falls off the end and is handed `byIndex[byIndex.length - 1]` by the fallback —
  a **duplicate** of #99's provider id;
- the invalid recipient is never marked `failed`; nobody is, because `invalid[]` is unread. It is
  written as `submitted` with someone else's message id;
- `totalCreditsCharged` counts a charge for a message that was never sent, so the settle
  over-reports and the balance drifts against the provider.

At the ~3% invalid rate the mock provider itself simulates, a 4,000-recipient blast would mark
roughly 120 people as successfully texted who were not, and corrupt the provider-id mapping for
essentially the entire blast after the first failure. It also breaks Phase 4 before it is written:
the delivery poller joins on `provider_message_id`, and duplicated ids across rows make that join
ambiguous.

**Fix:** match on `mobile`, which is returned on both `valid[]` and `invalid[]` rows. Build a map
from the response, look each message up by its `to_phone`, mark rows found in `invalid[]` as
`failed` with the provider's reason, and count credits only from matched `valid[]` rows. Keep the
positional fallback **only** for the sandbox path, where the redirect to `SMS_TEST_RECIPIENTS`
genuinely makes 1:1 matching impossible — and confine it there explicitly rather than letting it be
the general case.

The existing code comment describes the positional write-back as a deliberate accommodation for
sandbox redirection. That reasoning is sound for sandbox and does not hold outside it; the bug is
that the accommodation was applied unconditionally.

---

## LOW — carried into Phase 2 (`docs/SMS-PHASE2-BRIEF.md` §7)

- **L-1** *(not cosmetic)* — `sms_credits_settle` hardcodes `ref_type = 'sms_blast'` in its ledger
  inserts while `sms_credits_reserve` takes `p_ref_type` as a parameter. Phase 5's 1:1 sends
  (`ref_type = 'sms_message'`) would write mislabeled ledger rows against a real balance. Add
  `p_ref_type TEXT` and pass it through. **Once 202 is merged this needs a new
  `DROP FUNCTION` + recreate in migration 204**, in one transaction, with the caller in `send.ts`
  updated alongside.
- **L-2** — `AakashSendResponseValid.id` is typed `number`; the live value is the string
  `"13421_178679570267557"`. Runtime is safe (it is coerced with `String(v.id)` at the boundary),
  so this is a lying type rather than a live defect — but it is the kind of lie that gets believed
  by the next person to touch the mapper.
- **L-3** — persist the `shortcode` field from the send response (observed `"AT_Alert"`) onto
  `sms_messages`; add the column in migration 204. It is the only record of which sender ID a
  message actually went out under, and that value changes the moment a branded ID is registered.
- **L-4** — attach the repo's `update_updated_at()` trigger to `tenant_sms_settings`,
  `sms_credit_accounts`, `sms_blasts` and `sms_messages`. Every other table follows this convention
  (see mig 176); without it `updated_at` never moves off its default.
- **L-5** — comment `applyEnvGuard` to note that the `[SANDBOX intended: …]` prefix inflates the
  body and can push it across a segment boundary, so sandbox credit totals are **not** a reliable
  production cost estimate.

---

## What was right, and worth keeping

Recorded because these were judgement calls that could easily have gone the other way:

- **The no-`CHECK (balance >= 0)` decision, with its reasoning in a SQL comment.** A future reviewer
  will want to add that constraint; the comment is what will stop them.
- **`isSmsSandbox()` defaulting to true**, inverted against the AI flags. Getting a flag default
  backwards is normally a style nit; here it is the difference between a quiet no-op and texting
  17,334 students.
- **`env-guard` throwing on an empty `SMS_TEST_RECIPIENTS`** instead of falling through to the real
  recipients. Failing closed on a misconfiguration is exactly right.
- **The provider singleton falling back to mock rather than null.** Going live requires two
  independent positives (`SMS_PROVIDER=aakash` **and** a token), and the pipeline stays exercised
  everywhere else.
- **Materializing recipient rows up front** behind `uq_sms_message_blast_lead`, so idempotency is a
  database invariant rather than an application convention.
- **`segments.ts` as the single source of truth** imported by both the counter and the billing path.
  The counter and the charge now cannot disagree without a code change that breaks both.

---

## Merge conditions

1. Fix **NEW-1** (match by `mobile`; confine the positional fallback to sandbox; mark `invalid[]`
   rows `failed`; count credits only from matched valid rows), with a test covering a batch where
   one middle recipient is invalid.
2. Then one human approval — Sadin cannot self-approve; stage requires one review from someone else.
3. On merge, migrations 202/203 stay **local-only**. They ride the normal pipeline: stage first via
   the auto-migrate job, prod only at promotion behind the `production-db` gate.
4. L-1..L-5 land in Phase 2's migration 204 and PR, not here.
