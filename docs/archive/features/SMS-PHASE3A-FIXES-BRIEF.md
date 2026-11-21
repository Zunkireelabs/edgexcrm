# BRIEF — SMS Phase 3A review fixes (F-1..F-3), on PR #392

**For:** Sonnet executor session
**From:** Opus planning session, 2026-08-15
**Branch:** `feature/sms-phase3a-send-spine` — the **existing** branch. Pushing updates PR #392;
do not open a new one.
**Source:** Opus review of #392.

Phase 3A is good work — audience scoping, the Inngest shape, the idempotency diagnosis and both §8
carried-forward fixes are all correct, and you flagged the cancel gap honestly instead of hiding it.
Three things to fix before merge. Two are credit/state correctness; one is the test gap you named.

**No UI surface. No migration.** Same as 3A itself.

---

## F-1 (must fix) — `finalizeBlast` erases a user's cancellation and reports it as a failure

`src/lib/inngest/functions/sms-blast-send.ts:80`:

```ts
const finalStatus = failed === 0 ? "sent" : sent === 0 ? "failed" : "partially_failed";
```

`failed` counts rows with `status IN ('failed','cancelled')` (line 77). So when a user cancels a
blast, every remaining row is `cancelled`, giving `sent = 0`, `failed = N` → the run wakes up,
finalizes, and stamps the blast **`failed`**. The user's own cancellation is overwritten and
reported back to them as a system failure. `recipients_failed` is also inflated by rows that were
deliberately cancelled, never attempted.

**Fix:**
- Re-read the blast's current status inside `finalizeBlast`. **If it is already `cancelled`, leave
  it `cancelled`** — still write the counters, `actual_credits` and `completed_at`, but never
  transition out of a terminal user-chosen state.
- Count `cancelled` separately from `failed`. `recipients_failed` must mean "we tried and it
  failed". Add the cancelled count to the returned outcome; there is no column for it, so don't
  invent one — reporting it in the function's return value and the log line is enough for 3A.

## F-2 (must fix) — `/cancel` doesn't settle, so reserved credits sit held

`src/app/(main)/api/v1/sms/blasts/[id]/cancel/route.ts` marks rows and the blast `cancelled` but
never calls `sms_credits_settle`. You confirmed this live (16 credits still in `reserved`).

Your report treats this as unrecoverable; it is actually *delayed* in most cases — the Inngest run
always reaches `finalize`, which settles, so a cancelled `queued` blast does get refunded once the
run completes. But two real holes remain: a blast cancelled while the run is parked in
`step.sleepUntil` for a scheduled send holds credits until that wake-up (possibly days), and a blast
whose event was never delivered holds them **forever**, with no path back except manual SQL.

**Fix:** settle inside the cancel route, immediately.

```ts
// actual = what the provider has ALREADY charged for this blast, not 0 —
// settling at 0 after some messages went out would refund credits we really spent.
const actual = sum(provider_credit) over sms_messages
               WHERE blast_id = id AND status IN ('submitted','delivered')
await db.rpc("sms_credits_settle", { p_ref_id: id, p_reserved: blast.reserved_credits ?? 0,
                                     p_actual: actual, p_ref_type: "sms_blast" })
```

`p_tenant_id` is force-injected by `scopedClient.rpc()` — do not pass it.

This is safe against the run finalizing later: `sms_credits_settle` is idempotent on `ref_id`, so
whichever settles first wins and the second is a no-op. That is exactly why the ordering above
matters — settle with the credits actually spent, not zero.

## F-3 — the route/Inngest tests you skipped

You covered `audience.ts` well (the counselor-scope test is the right assertion and it passes). The
gap you named is real, and the highest-value ones are cheap now that the code exists. Add:

- **Re-POST to `/send` is idempotent** — no duplicate `sms_messages` rows. This is the one that
  matters most: you *changed* the idempotency mechanism from a DB upsert to an app-layer check, and
  that new mechanism currently has no test at all.
- **Reserve failure blocks the send** — `sms_credits_reserve` returning `ok:false` returns the
  shortfall and emits **no** Inngest event.
- **`max_recipients_per_blast` rejects rather than truncates.**
- **F-1 regression:** a cancelled blast stays `cancelled` after `finalizeBlast` runs.

Mock at whatever layer is cheapest — you don't need real HTTP. Follow the DB-touching precedent from
Phase 1/2 (skip cleanly when local Supabase is down) for anything that needs Postgres.

## F-4 (do this one only if it is genuinely small) — graceful concurrent-insert handling

Your PostgREST `42P10` diagnosis is correct and the app-layer check is the right workaround. It is a
check-then-insert, so two concurrent `/send` calls can both pass the check; the DB's partial unique
index still prevents the double-send (good — that is the guarantee that matters), but the loser gets
a `23505` and your code returns a 500. Catch `23505` on that insert and treat it as "already
materialized", so a concurrent retry is a graceful no-op instead of an error. Skip it if it turns
awkward — the safety property already holds.

---

## Verification

`npm run build`, `npx eslint --max-warnings 50 .`, `npm run test`, `npx tsc --noEmit`.

Plus one live check, since F-1 and F-2 are both about state you can only see in the database: create
a blast, send it, cancel it mid-flight, and show in psql that the blast row reads **`cancelled`**
(not `failed`), that `reserved` returns to 0, and that the ledger has exactly one `settle` row for
that `ref_id`. Paste that output.

## Report back with

The diff, the four gate outputs, the psql transcript above, and confirmation that no migration was
added and nothing was merged. Push to `feature/sms-phase3a-send-spine`; #392 updates itself.
