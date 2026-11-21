# Unified Inbox — Phase 3b Brief (near-instant inbound)

> Small Sonnet build brief. Make inbound messages appear in `/inbox` in ~1–2s instead of up to ~60s. Branch off `stage`; stop at review. Context: `docs/UNIFIED-INBOX-BRIEF.md`.

## Context / problem

Inbound flow today: webhook **enqueues** to the `events` queue → a **cron drains** it (every 1 min on dev via VPS crontab; every 2 min on prod via the GH Actions workflow once on main). So a real WhatsApp message can take **up to the cron interval** to surface — proven live: outbound is instant, inbound lagged ~1 min. That's fine for a queue's robustness but too slow for a real agent inbox.

Realtime is **not** the bottleneck — once an event is processed, `postgres_changes` pushes it to open `/inbox` clients instantly. The lag is purely the **drain interval**.

## The change (keep the queue; add inline processing)

After the webhook **fast-acks** Meta, **fire-and-forget the processor** so the just-enqueued event is handled immediately. Keep the cron as a **safety-net fallback** (retries, server-restart recovery). This is the same fire-and-forget pattern already used in `submit/route.ts` and the email path.

**File:** `src/app/api/webhooks/meta/[provider]/route.ts` (and mirror in `src/app/api/webhooks/sandbox/route.ts` for consistency).

- Import `processInboundEvents` from `@/lib/inbox/process-inbound`.
- After the enqueue loop, **before** `return`, kick it without awaiting:
  ```ts
  // Near-instant inbound: process now; the cron remains a fallback for retries/restarts.
  void processInboundEvents().catch((err) =>
    logger.error({ err, provider }, "meta webhook: inline inbox process failed (cron will retry)")
  );
  return NextResponse.json({ received: true, enqueued }, { status: 200 });
  ```
- **Do NOT `await`** it — the 200 must still return immediately (Meta disables slow webhooks). The promise continues on the event loop.

## Why this is safe here
- We run a **persistent Node server** (`next start` in Docker), **not** serverless/edge — so a non-awaited promise keeps running after the response is sent and completes normally. (State this in the PR; it's the load-bearing assumption.)
- **No double-processing:** the event is `await`-inserted before the kick, so the processor sees it; message insert is idempotent (`channel_id, provider_message_id` partial-unique → `23505` skip); the processor marks events `completed`, so the next cron tick finds nothing. Inline + cron can't duplicate.
- **No new latency risk to the ack:** `void` means the response isn't blocked.

## Out of scope
- No queue removal, no schema change, no new infra. The cron/workflow stays exactly as-is (fallback).
- Don't change the processor logic itself.

## Verification
1. `npm run build` clean + `npx eslint --max-warnings 50 .` 0 errors.
2. Locally: `node scripts/inbox-sandbox-send.mjs "instant test"` against the sandbox route — the conversation should appear **without** manually calling `/api/internal/inbox/process` (the webhook now self-processes). Re-send same `provider_message_id` → still no duplicate.
3. On dev after merge: send a real WhatsApp → appears in `/inbox` in ~1–2s (not ~1 min). The 1-min dev cron still runs harmlessly (processes 0 pending).

## SONNET HANDOFF PROMPT
> Build **Unified Inbox Phase 3b** on a branch off `stage` per `docs/UNIFIED-INBOX-PHASE-3B-BRIEF.md`: make inbound near-instant by fire-and-forgetting `processInboundEvents()` after the fast-ack in `src/app/api/webhooks/meta/[provider]/route.ts` (and mirror in `src/app/api/webhooks/sandbox/route.ts`) — `void` it (never await; the 200 must return immediately), `.catch` to a `logger.error`, keep the cron/workflow as the fallback. No schema/infra/processor changes. Verify per the brief (build + eslint 0 errors; sandbox message appears without a manual drain; no duplicates). Commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Then STOP and summarize for Opus review.
