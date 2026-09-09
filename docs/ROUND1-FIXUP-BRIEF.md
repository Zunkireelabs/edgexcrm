# Round 1 fix-up — `feature/it-agency-dispatch-loop`

Same branch, same rules. **Stop at review: no PR, no merge, no stage/prod DB.** Add a commit on top of `4d1b7872` (do not rebase, do not amend, do not cut a new branch). Migration 230 has not left your machine, so it is edited in place rather than superseded.

The Round 1 review passed: gates green, scope right, migration shape correct, both screenshots verified. Two fixes required, two optional.

---

## Fix 1 (required) — suppress the launch burst

**This is the important one, and it is not a code defect.** The scan notifies every it_agency task with `due_date < today`, unfinished, assigned, `reminded_at IS NULL`. Prod has 22 tasks carrying months of history. The first scan after migration 230 applies will fire **all** of the already-overdue ones at once — bell rows *and* emails, for work that has been sitting since June. The one feature whose entire job is to make EdgeX notifications trustworthy would introduce itself as a spam wave.

Add to `supabase/migrations/230_tasks_reminded_at.sql`, inside the existing transaction, **after** the `ADD COLUMN` and **before** the ledger insert:

```sql
-- Suppress the launch burst: anything already overdue at install time is treated
-- as already reminded, so only tasks that go overdue AFTER this ships will notify.
-- Without this, the first ops-reminders-scan pass fires a months-deep backlog at
-- the assignee in one batch.
UPDATE tasks SET reminded_at = now()
WHERE due_date < CURRENT_DATE AND status <> 'done' AND reminded_at IS NULL;
```

Then update the file header — it currently claims "0 rows touched (ADD COLUMN only)", which is no longer true. State the real expectation and report the actual local count:

```
--   Expected before/after row counts: tasks — ADD COLUMN touches 0 rows; the
--     backlog-suppression UPDATE stamps every currently-overdue unfinished task
--     (local Docker Supabase: N rows). Report the prod count at apply time.
```

**Re-applying locally:** run the rollback lines from the header (`DROP INDEX`, `DROP COLUMN`), delete the `230_...` row from `public.schema_migrations`, then apply the edited file fresh. Confirm the re-run is still idempotent, and confirm a task made overdue *after* the migration still gets reminded — that is the behaviour the UPDATE must not break.

## Fix 2 (required) — make "stamp only after confirmed delivery" actually true

Your own flag, verified: `createNotification` (`src/lib/notifications.ts:35-38`) logs and returns `null` on an insert failure rather than throwing, so the `try/catch` in `runProjectTaskReminders` never fires and the row is stamped anyway — a lost reminder, silently, forever. Mirroring the `lead_checklists` shape was the right instinct and the brief did demand it; now make the new path honest without touching the old one:

```ts
const notif = await createNotification({ ...
});
if (!notif) {
  logger.error({ taskId: r.id }, "reminders run: notification insert failed — not stamping");
  continue;
}
notified++;
processedIds.push(r.id);
```

Add a test: `createNotification` resolving `null` leaves the row **unstamped** and it is retried on the next scan. That is the case your current "notify throws" test does not cover, because the real failure mode is a null return, not a throw.

Leave `runTaskReminders` (`lead_checklists`) alone — same latent issue, different blast radius, not this round.

## Fix 3 (recommended) — chunk the stamp

`.in("id", processedIds)` with up to 500 UUIDs is ~18KB of query string. This repo has been bitten by exactly that before (>440 ids → undici overflow → silently empty result). Here the failure mode is worse than for checklists: unstamped rows re-notify **every 15 minutes, forever**. Chunk the update at 100 ids per call. Volume today will not trigger it; it is cheap insurance against the loop.

## Fix 4 (check, may be no-op) — `APP_URL` per environment

The task-assigned email in your screenshot links to `https://edgex.zunkireelabs.com/projects/...` from local dev. That is `APP_URL`. Confirm the value each environment supplies, and say in the report what stage will send. There is prior history in this repo of stage's `APP_URL` pointing at prod; a task email that deep-links a stage user into production is a nasty bug to chase later. **Do not change any env file** — report what you find.

## Out of scope

Everything from the Round 1 brief §3, plus: do not touch `runTaskReminders`, do not add escalation or a second reminder, do not touch the email gate or add preferences, do not adjust the notification link scheme. No new tests beyond the one named in Fix 2.

## Report back

All four gates re-run (`npm run lint`, `npx tsc --noEmit`, `npm run test`, `npm run build`), the local row count from Fix 1's UPDATE, and **one screenshot**: a task that goes overdue *after* the migration still producing its reminder — proving Fix 1 suppressed the backlog without disabling the feature. Say explicitly that no stage or prod DB was touched.
