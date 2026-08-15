# BRIEF — SMS Phase 1 / NEW-1: match provider results by phone, not by array index

**For:** Sonnet executor session
**From:** Opus planning session, 2026-08-15
**Branch:** `feature/sms-phase1-core` (the **existing** branch — this updates PR #390, it does not
open a new one)
**Worktree:** `/Users/sadinshrestha/Projects/edgeXcrm-sms-phase1` (already checked out)
**Source:** `docs/SMS-PHASE1-REVIEW.md` §NEW-1

**There is no UI surface in this fix** — it is one function in `src/lib/sms/send.ts` plus tests.
Sadin will open localhost and see nothing new. Saying so up front because the standing rule is that
a phase without a screenshot must declare that it has no visible surface.

---

## 0. Before you touch anything

1. `git -C /Users/sadinshrestha/Projects/edgeXcrm-sms-phase1 pull --ff-only origin feature/sms-phase1-core`
   first — two documentation commits (`e2997e74`, `a092e10f`) landed on the branch after your last
   push, and one of them is the review this brief implements.
2. **Do not touch the `demo/cre-capital-local` worktree.** Sadin has WIP there. Do not stash,
   commit, or discard anything in it.
3. **No migration.** Nothing in this fix is schema work. Do not create migration 204 — that belongs
   to Phase 2, and creating it here would collide.
4. **Stop at the push.** Do not merge #390, do not apply 202/203 anywhere, do not enable a flag.

---

## 1. The bug

`sendQueuedBatch` in `src/lib/sms/send.ts` writes provider results back to `sms_messages` rows by
array index:

```ts
const byIndex = outcome.result.valid;
for (let i = 0; i < groupMessages.length; i++) {
  const msg = groupMessages[i];
  const providerResult = byIndex[i] ?? byIndex[byIndex.length - 1];
```

Aakash returns `valid[]` and `invalid[]` as **two separate arrays**, and `outcome.result.invalid` is
never read anywhere in the file. So a recipient that fails validation is simply absent from
`valid[]`, and every entry after it shifts down by one.

On a 100-recipient batch where recipient #3 is invalid:

- recipients #4..#100 are each written **another recipient's** `provider_message_id`,
  `provider_credit` and `provider_network`;
- recipient #100 runs off the end of `valid[]` and the `?? byIndex[byIndex.length - 1]` fallback
  hands it a **duplicate** of #99's row;
- the invalid recipient is written `status: 'submitted'` with someone else's message id — nobody is
  ever marked `failed`, because `invalid[]` is unread;
- `totalCreditsCharged` counts a charge for a message that was never sent, so the settle
  over-reports and the tenant's balance drifts against the provider.

At the 3% invalid rate the mock provider itself simulates, a 4,000-recipient blast mismarks roughly
120 students as texted and corrupts the provider-id mapping for nearly the whole blast after the
first failure.

There is no downstream repair path for this. Preflight established that the `api-report` row `id`
(`107644461`) has **no relationship** to the send response `id` (`"13421_178679570267557"`), so
Phase 4 must reconcile on recipient + body + timestamp. If `to_phone` and `provider_message_id`
disagree on the same row, that reconciliation has nothing to anchor to.

**Why the code looks the way it does:** the existing comment explains that sandbox sends are
redirected to `SMS_TEST_RECIPIENTS`, so they cannot line up 1:1 with intended recipients. That
reasoning is correct — *for sandbox*. The defect is that the accommodation was applied
unconditionally instead of being confined to the case that needs it.

---

## 2. The fix

### 2a. Extract the attribution logic as a pure function

Put it in a new `src/lib/sms/attribute.ts` (not inline in `sendQueuedBatch`) so it can be unit
tested without a database. This matters: `sendQueuedBatch` needs `scopedClientForTenant`, so an
end-to-end test of it can only run where local Supabase is up, and CI's Test job has no database. A
pure function gets the regression covered on every CI run instead of only on your laptop.

```ts
export interface AttributionInput {
  messages: { id: string; to_phone: string }[];
  result: SmsSendResult;      // { valid: SmsSendResultValid[]; invalid: SmsSendResultInvalid[] }
  sandboxed: boolean;
}

export type Attribution =
  | { messageId: string; outcome: "submitted"; providerMessageId: string; credit: number;
      network: string; providerStatus: string }
  | { messageId: string; outcome: "failed"; errorCode: string; errorMessage: string };

export interface AttributionResult {
  attributions: Attribution[];
  totalCreditsCharged: number;
  unmatched: string[];          // message ids found in neither array
}

export function attributeProviderResults(input: AttributionInput): AttributionResult
```

**Rules, in order:**

1. **Normalize both sides before comparing.** Build the lookup keys with a small local helper that
   strips every non-digit and takes the **last 10 digits**. We send bare 10-digit MSISDNs and the
   observed response echoes them back in the same shape, but matching on a raw string equality
   against a provider-controlled field is exactly the kind of assumption that breaks silently in
   production six months from now.
2. **Build two maps** from the response — `mobile → valid row` and `mobile → invalid row`.
3. **For each message row**, look up its normalized `to_phone`:
   - hit in `valid` → `submitted`, carrying that row's `id`, `credit`, `network`, `status`;
   - hit in `invalid` → `failed`, with `errorCode: "provider_rejected"` and the provider's own
     message text as `errorMessage`;
   - **hit in neither** → `failed`, with `errorCode: "no_provider_result"`, and add the id to
     `unmatched`. This should be impossible; treat it as such rather than papering over it.
4. **Compute `totalCreditsCharged` by summing `credit` across `result.valid`** — not by accumulating
   inside the per-message loop. The provider's response is the ground truth for billing, and
   decoupling the total from the row-matching loop means an attribution bug can never also become a
   billing bug. It also handles two message rows sharing one phone number correctly: both rows get
   attributed, the credit is counted once.
5. **When `sandboxed` is true, keep the existing positional behaviour** — including the
   `?? last` fallback. Sandbox redirection makes 1:1 matching genuinely impossible, and sandbox
   accuracy does not matter. Branch on it explicitly at the top of the function.

### 2b. Wire it into `sendQueuedBatch`

`applyEnvGuard` already returns a `sandboxed` boolean on its result — pass `guarded.sandboxed`
straight through, don't re-derive it by calling `isSmsSandbox()` again.

Replace the index loop with a walk over `attributions`, writing `submitted` or `failed` rows as the
attribution says. Keep `sent` / `failed` counting **message rows** (unchanged semantics), and take
`totalCreditsCharged` from the returned total.

If `unmatched` is non-empty, log a **warning** via `logger.warn(...)` from `@/lib/logger` (the pino
instance — `send.ts` is not a request handler, so `createRequestLogger` doesn't apply), including
the tenant id, the
count, and the message ids. A recipient the provider acknowledged neither way is a provider-contract
violation and we want to hear about it loudly, the same way §2d of the Phase 2 brief treats the
suppression safety net.

### 2c. Update the stale comment

The block comment above the write-back currently documents the positional approach as intentional.
Rewrite it to say that attribution is by phone number, and that the positional path survives **only**
for sandbox, and why.

---

## 3. Tests — `src/lib/sms/attribute.test.ts`

Pure, no database, must run in CI. Cover:

1. **All valid, 3 recipients** → 3 `submitted`, each carrying **its own** provider id. Assert the
   exact phone→id pairing, not just the count.
2. **Middle recipient invalid** — the regression. 3 recipients, #2 in `invalid[]`. Assert #1 and #3
   get their *own* ids (this is what index-matching gets wrong), #2 is `failed` with the provider's
   message, and the credit total counts only the two valid rows.
3. **Last recipient invalid** → no duplicated provider id anywhere in the output. This is the
   `?? byIndex[byIndex.length - 1]` fallback specifically.
4. **A recipient in neither array** → `failed` with `no_provider_result`, and it appears in
   `unmatched`.
5. **Two message rows sharing one phone number** → both attributed `submitted` with the same
   provider id, and `totalCreditsCharged` counts that credit **once**.
6. **Format drift** — the response echoes `"977-9800000001"` or `" 9800000001"` while the row holds
   `"9800000001"`. Must still match.
7. **`sandboxed: true`** → positional behaviour retained, more message rows than provider results
   does not throw.

**Before you commit, prove case 2 fails against the current code.** Stash the fix, run the test,
watch it go red, restore. A regression test that has never been observed to fail is not evidence of
anything — same standard applied to the HIGH-1/2 credit-RPC fixes. State the observed failure output
in your report.

---

## 4. Verification

- `npm run build` — clean
- `npx eslint --max-warnings 50 .` — no new warnings
- `npm run test` — full suite green, new tests included
- `npx tsc --noEmit` — clean

Optional but valuable if local Supabase is already up: re-run the Phase 1 end-to-end mock scenario
from the PR body with one recipient forced invalid, and show in psql that the invalid row is
`failed` while the others carry distinct `provider_message_id`s. Skip cleanly if the stack is down;
don't spend time standing it up for this.

---

## 5. Report back with

- The diff summary and anything in this brief that was wrong or impossible.
- **The red-test output from §3** before the fix was applied.
- The four verification command outputs.
- Explicit confirmation that no migration was created and #390 was not merged.

Push onto `feature/sms-phase1-core`. The PR updates itself; do not open a second one.
