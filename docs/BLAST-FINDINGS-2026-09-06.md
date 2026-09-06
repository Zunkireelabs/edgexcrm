# Blast (SMS + Email) — Findings & Fix Plan
**Date:** 2026-09-06 · **Source:** local blast-scale test run (16,000-lead fixture) + code review
**Status:** findings open, nothing fixed yet · **Owner:** Hardik (exec), Opus (review)

## TL;DR

The blast feature works at demo scale and breaks at Admizz scale (~16,684). Five findings
below. Two can burn real money or real credits and are in prod today. None of them block
the pending stage→main promotion of migs 224–227 — **promote that separately and now.**

Root cause of "why was this missed": the local test bed was ~100 migrations stale, so the
23 DB-backed tests in `src/lib/sms/*` and `src/lib/email/outbound/*` skipped in CI and
failed locally. A feature whose entire risk lives in 16,000-row behaviour was validated by
tests that could not reach a database. That gap is now closed (PR #508).

---

## F1 — Cap bypass: rows materialized before the cap is enforced  [P0]

**Where:** `src/app/(main)/api/v1/sms/blasts/[id]/send/route.ts` (~L160–185)

Order of operations is:
1. compose every row
2. `materializeInChunks` → INSERT all rows into `sms_messages` as `queued`
3. **then** check `max_recipients_per_blast` → return 422

The 422 does not roll back the INSERT. An over-cap blast is rejected by the API *and*
leaves its full audience sitting in `sms_messages` as `queued`.

**Impact:** reported (UNVERIFIED — see below) that the dispatcher selects on
`sms_messages.status` alone, not gated on `sms_blasts.status`. If so, a rejected blast can
still be dispatched, spending real Aakash credits on a send the API explicitly refused.
Reported reachable via retry-after-shrink: reject at 16k → admin shrinks audience → retry
passes the cap → the original 16k rows are still queued and counted as
`alreadyMaterialized`, so the shrunk retry sends everything.

**Blocker before fixing:** the verbatim dispatcher query has never been seen by review. It
was reported secondhand across a session boundary and could not be re-produced. Get it
first — grep `src/lib/inngest/functions/` and `src/lib/sms/` for `"queued"`.

**Fix:** enforce `max_recipients_per_blast` *before* compose and materialize. It only needs
`audience.sendable.length`, which is known well before any row is written. Moving the check
up is a few lines. Add a regression test asserting zero `sms_messages` rows exist after a
422.

---

## F2 — 32,000 PostgREST round trips per blast exhausts the connection pool  [P1]

**Where:** `src/lib/sms/optout.ts:28-60`, `src/lib/sms/compose.ts:58`,
`send/route.ts:157` (`COMPOSE_CONCURRENCY = 25`)

`getOrCreateOptOutToken` does an upsert + a select-back **per recipient**. At 16,000
recipients that is 32,000 sequential HTTP round trips, run 25-wide (~50 concurrent calls
into PostgREST).

**Observed:** local run failed after ~2 min with `PGRST003 Timed out acquiring connection
from connection pool` — PostgREST's default internal pool is 10.

**Not a local artifact.** `src/lib/sms/concurrency.ts`'s own header records that this
fan-out took down local Supabase at **249 recipients** during Phase 3B, and that Admizz's
audience is ~16,000. The response then was to cap concurrency at 25 rather than remove the
round trips. This is the same defect at 64× scale. On Supabase hosted we do not control
PostgREST's pool and it is shared app-wide — so a large blast can starve unrelated requests
and brown out the dashboard for every tenant. The prod failure mode is worse than the local
one, not milder.

**Fix:** bulk-mint tokens. Tokens are keyed `(tenant, phone)` so they cannot be shared, but
they can be minted in bulk: one `INSERT … ON CONFLICT DO NOTHING` per ~1,000 phones, then
one paginated `SELECT token, phone_e164` into a `Map<phone, token>`. `composeRecipientMessage`
then becomes pure and synchronous. 32,000 round trips → ~32. `COMPOSE_CONCURRENCY` stops
mattering, which is the point — do not "fix" this by raising the pool or the knob.

---

## F3 — Production sending domain is hardcoded; the sandbox flag is not a safety net  [P0]

**Where:** `src/lib/email/index.ts:20-24`, `src/lib/email/sender.ts:44`,
`src/lib/email/outbound/env-guard.ts:29-40`

```ts
const address = data?.domain_verified && customAddr ? customAddr : PLATFORM_EMAIL_ADDRESS;
```

A tenant's `from_address` is used only when `domain_verified` is true. Every local/test
tenant therefore sends as `noreply@edgex.zunkireelabs.com` — the live production domain —
with no env override anywhere in the path. `EMAIL_OUTBOUND_SANDBOX=true` does **not**
suppress sending; it only rewrites the `To:` and prefixes the subject. The real Resend API
call still happens.

**Impact:** any developer running email locally with a `RESEND_API_KEY` in `.env.local`
sends from the production domain on production credentials and consumes the real plan quota.
This is what happened during tonight's run.

**Also invalidates a prior diagnosis:** the first Section-4 attempt's 3–12% bounces were
attributed to `test@local.test` not being Resend-verified, and "fixed" by repointing the
fixture. But `test@local.test` was never used as the from-address — `sender.ts` falls back
to the platform address when `domain_verified` is false. **That bounce cause is still
unexplained and was closed out on a wrong explanation.**

**Fix:** an env-scoped sender identity plus a transport seam below `sender.ts` —
`EMAIL_TRANSPORT=stub` records calls and returns synthetic ids; local defaults to it. Rename
or re-document `EMAIL_OUTBOUND_SANDBOX` so it cannot be read as "no real sends."

---

## F4 — No email quota model: one tenant can consume the whole platform's month  [P1]

Resend plan is **Pro, 50,000/month** across every tenant (2,820 used as of 2026-09-06,
renews Sep 30; daily limit currently **Unlimited**). The blast fixture tenant was seeded
`max_recipients_per_blast = 20,000`; Admizz's real audience is ~16,684.

**So one Admizz email blast consumes ~⅓ of the platform's monthly email capacity in a
single click.** Three blasts and all transactional email — invites, password resets, lead
notifications, the inbound reply pipeline — stops for every tenant. Nothing in the send path
knows the plan exists; tenant caps were never sized against the provider quota.

**Immediate mitigation (dashboard, 5 min, no code):** set a Resend **Daily limit** (~2,000).
Converts "one click silently burns the month" into "a blast fails loudly at a safe boundary."

**Real fix (later):** per-tenant monthly email budget + a platform-level pre-send check,
mirroring how SMS credits are already reserved/settled.

---

## F5 — Blast finalized as terminal with 12,100 rows still queued  [P2, unexplained]

First Section-4 attempt finalized at 3,900/16,000 with 12,100 rows orphaned as permanently
`queued`. Attributed to local Inngest SQLite desync — but that explains why the *run* died,
not why the *blast was marked terminal* while queued rows remained. Abandoned/failed Inngest
runs are normal in prod. The executor then hand-built almost exactly this state as its
Section-5 reaper fixture, which suggests the "corruption" reproduced a genuine prod scenario
for free.

**Action:** find what marks a blast terminal; determine whether it can conclude while queued
rows remain. Investigate before fixing.

---

## What is NOT affected

- **Section 5 (credit reaper) is proven.** Reserve → settle ledger rows correct, 1,500-row
  fixture deliberately over the 1,000 PostgREST cap, `{ actual: 1500, diff: 0 }`, reserved
  released to 0, balance reconciled. Accepted.
- **Migs 224–227 promotion is unrelated to all of the above.** Do not let these findings
  block it.
- **PR #508** (mig 180/223 replayability) is unrelated; awaiting Anish.

---

## Sequencing — do these in this order

| # | Work | Blocks prod? | Notes |
|---|------|---|---|
| 0 | Set Resend **Daily limit** ~2,000 | — | Sadin, dashboard, now. 5 minutes. |
| 1 | Get the **verbatim dispatcher query** | gates F1 | Read-only grep. Needed before F1 is designed. |
| 2 | **Batch F1 + F2** on one branch → PR to stage | yes | Same file, same test surface. One PR, one review. Per prior guidance: fix together, verify together, push once. |
| 3 | **F3** transport seam → separate PR | yes | Small, self-contained, unblocks safe local email testing. |
| 4 | Re-run blast-scale **Sections 3 + 4** against the stub | — | Proves F1/F2/F3 at 16k without touching Resend. |
| 5 | **F5** investigation | no | After the above. |
| 6 | **F4** quota model | no | Daily limit holds the line until then. |

**Run the 224–227 promotion in parallel with step 2.** It is independent, it is already
owed, and holding it behind this work is how two separate things both end up late.

## Policy debt logged

Schema migrations must not hard-seed or assert on tenant-specific data via literal UUIDs or
slugs (migs 180, 223 — cost the entire local-replay chain). Tenant data belongs in a
separate, ledger-free ETL script. To be added to `DEV-WORKFLOW-AND-DEPLOYMENT.md` and the
migration `_TEMPLATE`.
