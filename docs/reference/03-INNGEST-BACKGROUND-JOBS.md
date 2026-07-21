# Background Jobs — Inngest

EdgeX's scheduled/background work (reminders, inbox draining, polling, KB ingestion) runs on
**Inngest**, not GitHub Actions cron. This replaced a GH-Actions `schedule:`-cron architecture
whose real-world cadence drifted to **1–3 hours** between runs regardless of the cron expression
written in the workflow file (GH's scheduler is best-effort and heavily throttled under platform
load — see the retired `email-poll-prod.yml` comment history for the observed numbers). Reminders,
inbox processing, and reply-sync all need minute-level freshness; GH cron could not deliver it.

## Architecture

- **Inngest Cloud**, Hobby (free) tier.
- **No separate worker runtime.** Functions run in-process inside the existing Next.js container,
  served from `src/app/api/inngest/route.ts` (`serve()` from `inngest/next`). A scheduled fire is
  Inngest Cloud calling that route over HTTPS — same container, same deploy, no new infra.
- **Shared client**: `src/lib/inngest/client.ts` — `new Inngest({ id: "edgex-ai" })`. Every
  function imports from here so they register under one Inngest app.
- **Local dev**: `INNGEST_DEV=1` in `.env.local` + `npx inngest-cli dev` (unsigned dev server,
  auto-discovers `http://localhost:3000/api/inngest`, dashboard on `:8288`). Never set
  `INNGEST_DEV` on stage/prod.

## Environments

| Inngest env | Maps to | Keys |
|---|---|---|
| `Production` | EdgeX prod (`edgex.zunkireelabs.com`) | `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` — GH environment secret, plumbed by `deploy.yml`'s ops-env block |
| `Staging` (custom env) | EdgeX stage (`dev-lead-crm.zunkireelabs.com`) | separate `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` pair — GH secret, plumbed by `deploy-staging.yml` |

Same app id (`edgex-ai`) in both environments — Inngest Cloud keeps them isolated by key pair, not
by app id. Stage and prod runs never cross-contaminate each other's event stream or execution
history in the dashboard.

## Function inventory

| Function id | Cron | Source | What it does |
|---|---|---|---|
| `ops-heartbeat` | `0 * * * *` | `src/lib/inngest/functions/heartbeat.ts` | Liveness probe — logs only, touches no tenant data. Proves the Cloud → serve-route path fires on schedule in each environment. |
| `ops-reminders-scan` | `*/15 * * * *` | `src/lib/inngest/functions/reminders.ts` (body in `src/lib/inngest/jobs/reminders.ts`) | Task reminders (`lead_checklists.remind_at` due) + outreach draft-due bell (`sequence_step_drafts.due_at` due). Fire-once via `reminded_at`/`notified_at` stamps. |
| `ops-inbox-process` | `*/10 * * * *` | `src/lib/inngest/functions/inbox-process.ts` | Drains pending `inbox.inbound_received` events from the `events` queue → conversations/messages/notifications (`src/lib/inbox/process-inbound.ts`). Idempotent via `events.status` + `ON CONFLICT` message insert. |
| `ops-email-poll` | `*/30 * * * *` | `src/lib/inngest/functions/email-poll.ts` (body in `src/lib/inngest/jobs/email-poll.ts`) | Gmail reply-sync poll. **Dormant** until `EMAIL_REPLY_SYNC_ENABLED=true` (Path B) — early-returns `{disabled:true}` under Path A. |
| `kb-ingest` | event-triggered (`kb/item.ingest.requested`) | `src/lib/ai/ingestion/kb-ingest.ts` | Knowledge-base ingestion pipeline for the AI/Orca layer. Not a cron — included here for completeness of the shared app registration. |

Each cron job has a matching HTTP route (`/api/internal/reminders/run`, `/api/internal/inbox/process`,
`/api/internal/email/poll`) that shares the same underlying implementation via the `jobs/` module —
those routes exist for manual/scripted invocation (`workflow_dispatch`-style debugging via `curl` +
`INTERNAL_CRON_SECRET`), not as a scheduling fallback.

## Adding a new background job

1. Create `src/lib/inngest/functions/<name>.ts` exporting `inngest.createFunction(...)`. If the
   logic is also needed from an HTTP route, put the actual body in `src/lib/inngest/jobs/<name>.ts`
   and have both the function and the route call it (see `jobs/reminders.ts` / `jobs/email-poll.ts`
   for the pattern).
2. Register the export in the `functions` array in `src/app/api/inngest/route.ts`.
3. That's it — no workflow file, no VPS crontab line, no GH secret to add for scheduling.

**Never add a GitHub-Actions `schedule:` cron for background work again.** That pattern is what
produced the 1–3 hour cadence drift this migration fixed. If you're tempted to reach for a
`schedule:` trigger, the answer is an Inngest function.

## Deploy & sync

After a deploy that adds or changes a function's config (new function, new cron expression, new
event trigger), sync the app so Inngest Cloud picks up the new registration:

```bash
curl -X PUT https://<host>/api/inngest
```

or via the Inngest dashboard → app → **Sync app**. Hosts:

- Stage: `dev-lead-crm.zunkireelabs.com`
- Prod: `edgex.zunkireelabs.com`

A normal deploy that only changes function *bodies* (not the registration) doesn't need a manual
sync — Inngest calls the route on every scheduled fire and picks up new code automatically since
the route always reflects what's currently deployed.

## Free-tier budget

Hobby tier: **50,000 executions/month**, counted per run-or-step, **shared across both the Staging
and Production environments** (they're the same account, not separate quotas). Watch usage in the
Inngest dashboard's usage page.

Levers if approaching the cap, cheapest first:
1. Relax a cron's cadence (e.g. `ops-inbox-process` from `*/10` to `*/15`).
2. Make inbox processing event-driven instead of polled — `inngest.send()` an event the moment a
   webhook lands, so `ops-inbox-process`'s poll becomes a rare fallback drain rather than the
   primary path.
3. Upgrade to the Pro tier ($99/mo, 1M executions/month) if the workload has genuinely grown past
   what cadence tuning can absorb.

## Idempotency

Every migrated job is safe to fire more than once for the same window — this is what made the
Phase 0–2 parallel-bake (Inngest function + GH-Actions cron both live, hitting the same
implementation) safe with no risk of double-processing:

- Reminders: `reminded_at` / `notified_at` stamps — a row already stamped is excluded from the
  next scan.
- Inbox processing: `events.status` (`pending → completed`, capped retries via `attempts`) +
  `messages` partial-unique constraint on `(channel_id, provider_message_id)` with
  `ON CONFLICT DO NOTHING`.
- Email poll: read-only scan; Gmail history-id watermarking in `connected_email_accounts` prevents
  reprocessing already-seen messages.

## History

- **Phase 0** (#272) — Inngest platform foundation + `ops-heartbeat`.
- **Phase 1** (#273) — `ops-reminders-scan`.
- **Phase 2** (#274) — `ops-inbox-process` + `ops-email-poll`.
- **Phase 3** (this doc) — GitHub-Actions cron workflows retired; Inngest is now the only scheduler
  for this work.
