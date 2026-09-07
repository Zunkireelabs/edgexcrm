# Test plan: blast send at real (Admizz) scale, local only

Verifies the fixes on `fix/blast-materialize-resilience` against the volume
that actually broke prod (2026-09-06 incidents: a 3,118-row email blast and
an 828-row SMS blast both failed with "Failed to materialize recipient
rows"), plus five follow-on PostgREST-1000-row-cap bugs found in the same
send/finalize/reaper path. Runs entirely on the local Docker Supabase stack —
no stage or prod access, no real SMS/email delivery (sandbox mode redirects
sends; see `docs/reference/` outbound briefs for `SMS_SANDBOX` /
`EMAIL_OUTBOUND_SANDBOX`).

## Why local is enough

Every bug fixed on this branch is a **volume/protocol** problem (PostgREST
silently capping an unpaged `select` at 1000 rows, a bare `in()` filter
blowing the URL length limit past ~400-450 items) — not anything specific to
Admizz's real leads. Postgres/PostgREST behaves identically at 16,000
synthetic rows as at 16,000 real ones. Stage already holds a real clone of
Admizz's data, but touching stage/prod is unnecessary here and this repo's
`CLAUDE.md` blocks DB access outside code review anyway — local reproduces
the failure mode with zero risk.

## 1. Prerequisites

```bash
# Local Supabase stack must be running
supabase status   # if not running: supabase start
```

In `.env.local` (repo root), confirm/add:

```
SMS_ENABLED=true
EMAIL_OUTBOUND_ENABLED=true
# Deliberately NOT setting SMS_SANDBOX=false or EMAIL_OUTBOUND_SANDBOX=false —
# leaving both unset keeps every send in sandbox mode (see src/lib/sms/flag.ts
# and src/lib/email/outbound/flag.ts): the materialization/chunking/pagination
# logic under test still runs for real, but no message reaches a real phone
# or inbox.
```

Restart `npm run dev` after editing `.env.local` if it was already running.

## 2. Seed the scale-test tenant

```bash
./scripts/seed-blast-scale-local.sh              # 16,000 leads (default)
# or, for a quicker smoke pass first:
LEAD_COUNT=2000 ./scripts/seed-blast-scale-local.sh
```

Re-running is safe (idempotent). This creates tenant **Blast Scale Test**
(`blast-scale-test`), login `blast-test@local.test` / `edgexdev123`, with all
leads in stage "New" / list "All Test Leads", SMS + bulk email enabled, and
credit/cap settings raised above `LEAD_COUNT` so the send isn't rejected or
throttled by an unrelated setting before it ever reaches the code under test.

## 3. SMS blast — send + verify

1. Log in as `blast-test@local.test`, go to **SMS**, create a new blast.
2. Audience filter: Stage = New (should match all seeded leads — confirm the
   count shown matches `LEAD_COUNT`, e.g. 16000).
3. Body: anything (e.g. `Test send {{first_name}}`).
4. Click **Send**, confirm the recipient-count prompt.
5. **Expected**: `200 OK`, no "Failed to materialize recipient rows". This is
   the exact original incident's error — its absence at this scale is the
   headline proof.
6. Once queued/processing completes (watch the blast's status), verify in
   Supabase Studio (`http://127.0.0.1:54323`) or via SQL:
   ```sql
   select status, recipients_total, recipients_suppressed, estimated_credits, reserved_credits
   from sms_blasts where id = '<blast-id>';

   select count(*) from sms_messages where blast_id = '<blast-id>';
   -- must equal recipients_total, not capped at 1000
   ```
7. **What this proves that a small test can't**: `recipients_total` and the
   `sms_messages` row count must both equal `LEAD_COUNT`, not silently cap at
   1000 — this is the exact shape of 3 of the 5 bugs fixed (credit-total
   query, finalize status-count query, and — indirectly — the
   already-materialized check if you send twice, see step 5 below).
8. **Retry proof (idempotency + pagination combined)**: click Send again on
   the same blast (or re-POST the same `/send` if the UI blocks a second
   click on a queued blast — use the blast's `id` against
   `POST /api/v1/sms/blasts/[id]/send` directly). Confirm `sms_messages` row
   count is still exactly `LEAD_COUNT` — no duplicates. This is what the
   "1000+ rows already materialized" regression test simulates with mocks;
   this step proves it against a real Postgres/PostgREST round trip.

## 4. Email blast — send + verify

Same shape as SMS, at `/email-campaigns`, with `resolveAudience` chunking
suppression lookups at 150/call and `materializeInChunks` at 100/call — so
16,000 rows means ~160 chunked upsert calls instead of 1. Verify:

```sql
select status, recipients_total, recipients_suppressed
from email_blasts where id = '<blast-id>';

select count(*) from email_messages where source_id = '<blast-id>';
-- must equal recipients_total
```

If the send is large enough to cross `daily_send_cap` on a *lower* cap than
seeded here, you'd also be exercising the mid-flight "Throttled" banner —
`computeBlastCounts` (one of the 5 fixes) is what keeps that banner's live
numbers correct past 1000 rows. The seed script sets the cap to 20,000
specifically to let a 16,000-row test complete in one pass; lower
`daily_send_cap` manually first (`update tenant_email_settings set
daily_send_cap = 500 where tenant_id = '44444444-4444-4444-4444-444444444444';`)
if you want to exercise that throttle path deliberately.

## 5. SMS credit reaper — verify (optional, needs a contrived stuck state)

The 5th fix (`sms-credit-reaper.ts`) only runs for a blast whose Inngest run
died mid-send, which isn't reachable through the normal UI flow. To exercise
it directly:

```sql
-- Force blast-1 into the state the reaper looks for: terminal status,
-- reserved_credits > 0, no settle ledger row yet.
update sms_blasts set status = 'sent' where id = '<blast-id>';
```

```ts
// Then, in a scratch script or vitest run, call directly:
import { findUnsettledTerminalBlasts, reapBlast } from "@/lib/inngest/functions/sms-credit-reaper";
const candidates = await findUnsettledTerminalBlasts();
const result = await reapBlast(candidates.find(b => b.id === "<blast-id>")!);
console.log(result); // actual must equal the full submitted+delivered count, not capped at 1000
```

## 6. Cleanup

The seeded tenant is fully isolated (`blast-scale-test` slug, `4444...`
tenant id) — safe to leave, or wipe with:

```sql
delete from public.tenants where id = '44444444-4444-4444-4444-444444444444';
-- ON DELETE CASCADE removes tenant_users, leads, sms_blasts/messages,
-- email_blasts/messages, credit accounts/ledger, settings rows with it.
```

## What this does and doesn't prove

**Proves**: the chunking/pagination/retry logic holds up against a real
Postgres + PostgREST round trip at the exact row-count class that broke
prod, not just against test mocks.

**Doesn't prove**: behavior against the real Aakash SMS / Resend email
provider APIs (sandbox mode intentionally never reaches them), or anything
about the *original* two incidents' precise root cause (never recovered —
see `54429b01`'s commit message). Persistent server-side logging is still a
separate, open gap for making a *future* failure diagnosable.
