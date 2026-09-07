# Brief — restore the local DB to current schema, then run the blast-scale plan

**Author:** Opus planning session · **Date:** 2026-09-06 · **Executor:** Sonnet session
**Base branch:** `origin/stage` (`db9f3c18`, #506 merged and deployed)
**Blocks:** the stage → main promotion (the blast-scale run is the last verification owed).

---

## Root cause (verified by Opus — not a guess, and not a defect in #506)

The blast-scale test plan failed at seeding with `relation "public.tenant_sms_settings"
does not exist`. That is correct behaviour for the current local DB:

1. `supabase/config.toml` sets `[db.migrations] enabled = false` — **`supabase db reset`
   never replays the migration chain.** It loads, in order:
   `baseline/schema.sql` → `baseline/ledger.sql` → `baseline/reference.sql` → `seed.sql`.
2. `baseline/schema.sql` is dated **2026-07-23** and contains **none** of the blast
   tables. Verified by grep.
3. `baseline/ledger.sql` records **125 migrations, ending at `127_lead_archive_snapshot.sql`**.
   Everything from **128 onward has never been applied locally.**
4. The blast schema lives in migrations after that line:
   `202` (`tenant_sms_settings`, `sms_credit_accounts`), `203` (`sms_blasts`, `sms_messages`),
   `204` (`sms_suppressions`), `211` (`email_messages`), `214` (`email_blasts`).

So the local DB has been ~100 migrations behind since late July. This is why the 23
`src/lib/sms/*` and `src/lib/email/outbound/*` tests fail locally, and it is the
structural reason the earlier chunking fix "shipped without ever being proven against a
real multi-thousand-row send, and failed again" — there was no local environment in which
it *could* be proven.

**The fix is the tool the repo already ships**, not a new baseline dump:
`scripts/migrate-apply.sh local` — its header says exactly this: *"local = your OrbStack
Supabase. Applies migrations teammates merged (that arrived as files via `git pull`) on
top of your baseline."*

---

## Part 1 — restore the local DB

### Why a reset first (do not skip it)

An earlier session hand-applied a partial set (220–222, 224–227) on top of the baseline.
Applying 128–219 + 223 **now** would run them *after* migrations numbered higher —
out of order. Most are independent, but a migration in that range that touches a
constraint later migrations redefined could silently undo it (mig 226/227's role CHECK is
the obvious candidate). Reset first so the whole chain applies in numeric order exactly
once.

### Steps

```bash
git switch stage && git pull            # be on db9f3c18 or later
supabase db reset                       # baseline (schema+ledger@127+reference) + seed.sql
scripts/migrate-apply.sh local --dry-run   # REPORT THIS LIST before applying
scripts/migrate-apply.sh local             # applies 128 -> 227 in filename order
./scripts/local-db-setup.sh             # local login user + Test Agency link
```

**Report the `--dry-run` list** (count + first/last file) before running the real thing.
Expect roughly 100 files, `128_*` through `227_role_staff_backfill.sql`.

### If a migration fails — STOP, do not skip it

`migrate-apply.sh` uses `ON_ERROR_STOP=1`; files that already committed stay applied and
self-recorded, so a re-run retries only what is still pending. If one fails:

- **Report which file and the exact psql error.** Do not `--skip` it, do not edit the
  migration, do not hand-patch the local DB around it.
- This is genuinely useful information beyond this task: it tells us the chain is not
  replayable from the 2026-07-23 baseline, which is tracked debt (see the local-dev-DB
  notes) and matters for onboarding any new developer.
- The known-unreplayable ones are `001`–`096` (one-time prod ETL with hardcoded tenant
  UUIDs and row-count assertions) — those are already inside the baseline and are not in
  this range, so 128+ *should* replay cleanly. If they don't, that's a finding.

### Verification for Part 1

```bash
npm run test
```

The 23 failures in `src/lib/sms/*` and `src/lib/email/outbound/*` must go to **0**
(they should return to being *skipped* or *passing*, not failing). Report the actual
`Test Files` / `Tests` line. If they still fail, stop — the schema is still wrong and the
scale run would be meaningless.

---

## Part 2 — run the blast-scale plan

Follow `docs/dev-collab/TEST-PLAN-BLAST-SCALE.md` as written. **Local only.** Do not point
any part of it at stage or prod.

- **Section 1:** the sandbox flags in `.env.local` are `SMS_SANDBOX=true` /
  `EMAIL_OUTBOUND_SANDBOX=true`. That is safe and equivalent to unset — both
  `isSmsSandbox()` (`src/lib/sms/flag.ts:16`) and `isEmailOutboundSandbox()`
  (`src/lib/email/outbound/flag.ts:13`) are `!== "false"`. Leave them alone; just confirm
  they are not `false` before sending anything.
- **Section 2:** seed at the **default 16000**, not the 2000 quick pass. The row-count
  class is the whole point (the incidents were 3,118-row email and 828-row SMS).
- **Sections 3 & 4:** SMS blast and email blast — send + verify.
- **Section 5 (credit reaper):** the plan marks it optional because it needs a contrived
  stuck state. **Do it.** The reaper totals `provider_credit` to settle against actual, so
  a pagination bug there mis-charges real money against the Aakash pool, and it was one of
  the five queries fixed. If constructing the state is genuinely infeasible, say so and
  explain why — do not skip silently.
- **Section 6:** cleanup.

### Report actual numbers, not "verified"

- rows materialized vs audience size, both channels
- `sent` / `failed` / `cancelled` / `suppressed` counts and the final blast status
- reserved vs settled credits for the reaper
- any chunk retry that fired (the `onRetry` log line) with its chunk index

If a number differs from what the plan predicts, **report the difference** — do not
reconcile it in your head.

### What this run is actually proving

With 16,000 leads the paged reads cross the 1000-row boundary ~16 times per query, so the
section 3/4 counts are the real proof that `.order("id")` + `.range()` assembles each row
exactly once under a live PostgREST round trip — the thing the unit tests can only model.

---

## Failure handling

If **Part 2** fails, that IS a finding against merged code (#506 is already on stage).
Stop, report the exact error and step, and do not fix it inline — Opus reviews it first.

If **Part 1** fails, that is an environment/chain finding. Same rule: stop and report.

## Out of scope

- Any stage or prod DB access. Neither part needs it.
- Refreshing `supabase/baseline/schema.sql`. Re-baselining is a separate question; if
  `migrate-apply.sh local` replays cleanly, the baseline + chain is working as designed
  and does not need replacing.
- Code changes. None are expected from either part.
- The two pagination follow-ups already logged on #506 (`audience.ts:159`,
  `utm/submission-counts.ts:31`).
