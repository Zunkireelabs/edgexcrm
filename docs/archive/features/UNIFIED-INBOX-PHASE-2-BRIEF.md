# Unified Inbox — Phase 2 Brief (notifications-on-inbound + processor workflow)

> Sonnet build brief. Phase 2 of the unified inbox. v1 is shipped to stage (`stage` @ `9eb782a`, live on `dev-lead-crm`) — see `docs/UNIFIED-INBOX-BRIEF.md` for the full picture. **Code-only — no VPS access.** Build on a branch off `stage`; stop at review.

## Context

v1 inbox works (inbound→thread→reply, sandbox channel) but is missing two operational pieces that make it feel like a real inbox:
1. **No alert on new messages** — `process-inbound.ts` bumps `unread_count` but never fires a bell notification. Users don't know a message arrived unless they're staring at `/inbox`.
2. **No scheduled drain** — the inbound `events` queue is only drained by manually calling `POST /api/internal/inbox/process`. Needs a scheduled trigger like the email poll has.

Both are small and mirror existing, proven patterns. **Out of scope:** real Meta channels, dev VPS sandbox wiring, AI agent (all later phases).

## Confirmed decisions
- Code-only; no VPS/SSH. The scheduled drain is a **GitHub Actions workflow** (mirrors `email-poll.yml`), not a VPS crontab.
- Notification recipients: **conversation assignee** (if `assignee_type='human'`) ∪ **linked lead's `assigned_to`**; if neither exists → **tenant admins** (`getTenantAdminRecipients`). This keeps counselors scoped (they only get pinged for their own leads' conversations) and ensures unassigned+unlinked inbound still notifies someone.
- Collapse via `upsertThreadNotification` keyed on `link` = `/inbox?conversation=<id>` → multiple messages in one conversation within 15 min bump a single notification.

---

## Deliverable 1 — notifications-on-inbound

**Files:** `src/lib/notifications.ts` · `src/lib/inbox/process-inbound.ts` · `src/components/dashboard/inbox/InboxUI.tsx`

1. **Add the type** to `NotificationTypes` (`src/lib/notifications.ts:78`):
   ```ts
   INBOX_MESSAGE_RECEIVED: "inbox.message_received",
   ```

2. **Fire the notification** in `process-inbound.ts` `processOneEvent`, **after** the unread/last_message bump and only for **non-duplicate** inbound (i.e. after the `if (isDuplicate) return;` guard — that early-return already exists). Mirror the email-poll block at `src/app/api/internal/email/poll/lib.ts:245-280`:
   - Resolve recipients into a `Set<string>`:
     - extend the conversation `select` (both the existing-conv lookup and, for new convs, what you have) to include `assigned_to_user_id, assignee_type`;
     - if `assignee_type === 'human'` and `assigned_to_user_id` → add it;
     - if `lead_id` → query `leads.assigned_to` (scoped by `tenant_id`) and add it if set;
     - if the set is still empty → `getTenantAdminRecipients(supabase, tenantId)`.
   - Labels: `senderLabel = p.contact_display_name || p.contact_phone || "Unknown"`; `message = `${senderLabel}: ${preview}`` (reuse the 200-char preview); `link = `/inbox?conversation=${conversationId}``.
   - `await Promise.all([...recipients].map(userId => upsertThreadNotification({ tenantId, userId, type: NotificationTypes.INBOX_MESSAGE_RECEIVED, title: "New message", message, link })))`.
   - Wrap in `try/catch` → `logger.warn(..., "Failed to create inbox notification (non-fatal)")`. **Non-fatal** — a notification failure must not fail message ingestion or re-queue the event.

3. **Deep-link in `InboxUI.tsx`** — read `?conversation=<id>` on mount and pre-select it. Use `useSearchParams()`; in a mount effect, if the param is present, `setSelectedId(param)`. If that conversation isn't in the loaded list, it's acceptable for v1 to just set the id (the thread fetch by id will still load its messages via the existing `fetchMessages`); don't over-engineer fetching it into the list. Don't break the existing no-param behavior.

**Notes:** the bell dropdown already polls every 30s and navigates via `notification.link` on click (`notifications-dropdown.tsx`), so no dropdown changes are needed. Customer is not a tenant user → no self-ping suppression needed.

## Deliverable 2 — `inbox-process.yml` GitHub Actions workflow

**File:** `.github/workflows/inbox-process.yml` — copy `.github/workflows/email-poll.yml` exactly, changing only:
- `name: Inbox Process (dev)`
- the curl target → `https://dev-lead-crm.zunkireelabs.com/api/internal/inbox/process`
- keep `Authorization: Bearer ${{ secrets.INTERNAL_CRON_SECRET_DEV }}` (same secret), `workflow_dispatch`, the `[ "$http_code" = "200" ] || exit 1` check.
- cron: `*/2 * * * *` (every 2 min — inbox latency should feel quicker than email's 5).

**Caveat to state in the PR:** GH Actions schedules only register from the **default branch (main)**, so this won't run on a schedule until it reaches main (prod promotion) — same as `email-poll.yml`. Until then it's **manually dispatchable** (Actions → "Inbox Process (dev)" → Run workflow), which is enough for dev verification. (A prod-scheduling line gets added at prod promotion alongside the prod secret.)

---

## Verification (local first, per workflow)
1. `npm run build` clean + `npx eslint --max-warnings 50 .` 0 errors.
2. Locally (sandbox channel already seeded; `.env.local` has the secrets): `node scripts/inbox-sandbox-send.mjs "phase 2 test" maya_01 "+9779812345678" "Maya Sharma"` → inject + drain.
3. Confirm a `notifications` row was created for the right recipient(s) (psql: `SELECT user_id, type, title, message, link FROM notifications WHERE type='inbox.message_received' ORDER BY created_at DESC LIMIT 5;`) — link is `/inbox?conversation=<id>`.
4. Send a 2nd message in the **same** conversation within 15 min → the SAME notification row is bumped (not a new row) — collapse works.
5. Assign the conversation (or its lead) to a user → next inbound notifies that user; unassigned+unlinked inbound → notifies tenant admins.
6. Click the bell notification → lands on `/inbox` with that conversation **pre-selected** (deep-link).
7. Counselor: a counselor only receives notifications for conversations whose lead is assigned to them.
8. Workflow: `inbox-process.yml` parses (yaml valid); manual `workflow_dispatch` against dev returns 200 (after merge to stage).

## Out of scope (do NOT do)
- Dev/prod VPS env or crontab (Phase 3 — needs Sadin's auth; the GH workflow covers scheduled draining).
- Any real Meta channel work; connect-a-channel UI; AI agent.

## SONNET HANDOFF PROMPT
> Build **Unified Inbox Phase 2** on a branch off `stage` per `docs/UNIFIED-INBOX-PHASE-2-BRIEF.md`. Two code-only deliverables: (1) **notifications-on-inbound** — add `INBOX_MESSAGE_RECEIVED` type, fire `upsertThreadNotification` from `process-inbound.ts` after the non-duplicate unread bump (recipients: conversation assignee ∪ linked-lead assignee, else tenant admins; link `/inbox?conversation=<id>`; non-fatal try/catch), and a deep-link in `InboxUI` that pre-selects `?conversation=<id>`. Mirror the email-poll notify block at `src/app/api/internal/email/poll/lib.ts:245-280`. (2) **`.github/workflows/inbox-process.yml`** — copy `email-poll.yml`, retarget to `/api/internal/inbox/process`, 2-min cron + manual dispatch, same `INTERNAL_CRON_SECRET_DEV`. Verify per the brief (build + eslint 0 errors + the local sandbox notification walkthrough). Do NOT touch the VPS or any real-channel code. Commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Then STOP and summarize for Opus review.
