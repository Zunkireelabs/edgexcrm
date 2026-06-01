# Notifications + Attention-Badge System — Implementation Brief

> **Status:** approved, ready for implementation. Branch off `stage`.
> **Read this end-to-end before touching code.** It contains verified findings so you don't have to re-derive them — but still open each cited file to confirm line numbers (they may have drifted) before editing.

---

## Why this exists

While smoke-testing email Phase 3, a lead's reply landed in the CRM but nothing *signaled* "you have something to act on." The owner wants, iOS-app-style:
1. A notification summary that **deep-links** (click → jump to the exact lead/place).
2. **Count-dot badges** across nav + tabs so nothing is missed and users stay engaged.

**This is an expansion, not a greenfield build.** A working notification system already exists:
- Table `notifications` (migration `015`): `id, tenant_id, user_id, type, title, message, link, read_at, created_at`. RLS present. `type` is **free-text** (no enum to alter).
- Helper `src/lib/notifications.ts`: `createNotification(params)`, `createNotifications(params[])` (batch). `NotificationTypes` const currently: `LEAD_ASSIGNED, LEAD_UNASSIGNED, INVITE_ACCEPTED, TEAM_MEMBER_JOINED`.
- Bell dropdown `src/components/dashboard/notifications-dropdown.tsx`: polls `GET /api/v1/notifications?limit=10` every 30s, shows a red unread-count badge, **already deep-links via `notification.link` on click** (`handleNotificationClick`, ~line 100). Deep-linking is DONE — you're feeding it more events.

**Design principle (CRM-expert):** the activity timeline is the system of record; notifications are only the subset needing a human to *act/be aware now*. "Everyone well-informed" is achieved by **precise routing + ambient badges**, NOT by pinging the bell for every event. The two biggest anti-fatigue levers are **correct routing** and **suppressing self-actions**.

---

## Verified findings (don't re-derive)

- **Self-suppression does NOT exist today**, and there's a latent bug: assigning a lead to yourself notifies you. You will introduce the suppression primitive and fix the bug.
- **No auto-assign exists** — both lead-create paths leave `assigned_to` null, so `lead.created` routes to admins in practice. Code it defensively anyway.
- **Tasks are project-scoped** (`tasks.project_id NOT NULL`, no `lead_id`; `due_date` is DATE-only; no task cron). `task.due` is therefore **DEFERRED** to a separate brief — do NOT build it here, do NOT add a `TASK_DUE` constant.
- **"Emails" is a SUB-TAB inside the Activity tab**, rendered by `src/components/dashboard/lead/activities/activities-panel.tsx` (`SUB_TABS`, ~line 51). It is NOT in `lead-tabs.tsx`. The unread-email badge goes on the sub-tab button.
- Highest existing migration is `027_utm_links.sql` → new migration is `028`.
- `emails` table (migration `025`) has **no `read_at`** — this brief adds it.
- Counselor role: API routes override `assignedTo = auth.userId` when `auth.role === 'counselor'`. Every count/notification must respect this.

---

## Scope split

| Piece | Scope | Gating |
|---|---|---|
| `lead.created`, `lead.stage_changed` triggers + self-suppression fix | Universal | none |
| `email.received` trigger | Education-only | lives in education email poll lib (already industry-gated) |
| `/api/v1/badge-counts` + `useBadgeCounts` + sidebar "All Leads" badge | Universal | none |
| `emails.read_at` migration + mark-read + Emails sub-tab unread badge | Education-only | API gated by `getFeatureAccess(auth.industryId, FEATURES.EMAIL)` |

---

## PART 1 — Notification triggers

### 1.0 Foundation — `src/lib/notifications.ts`
- Add to `NotificationTypes`: `EMAIL_RECEIVED: "email.received"`, `LEAD_CREATED: "lead.created"`, `LEAD_STAGE_CHANGED: "lead.stage_changed"`.
- Add two exported helpers (the single chokepoint for routing hygiene):
  - `createNotificationsExcept(actorUserId: string | null, params: NotificationParams[])` — filters out entries where `userId === actorUserId`, de-dups by `userId` (keep first), then calls `createNotifications`.
  - `getTenantAdminRecipients(supabase, tenantId): Promise<string[]>` — `select user_id from tenant_users where tenant_id = ? and role in ('owner','admin')`.
  - `upsertThreadNotification(...)` — used by 1.3/1.4 collapse: if an unread notification of a given `type` for `userId` with a given `link` exists within the last ~15 min, UPDATE its title/message/created_at (bump) instead of inserting. Uses `createServiceClient`.

### 1.1 Fix the existing self-notify bug (do first — exercises the helper)
- `src/app/(main)/api/v1/leads/[id]/route.ts` (~296-346) and `src/app/(main)/api/v1/leads/bulk/route.ts` (~156-212): route LEAD_ASSIGNED/UNASSIGNED through `createNotificationsExcept(auth.userId, …)`.

### 1.2 `lead.stage_changed` — `src/app/(main)/api/v1/leads/[id]/route.ts` (PATCH)
- Gate on the existing `stageChanged` boolean (~line 280).
- Recipients: `updated.assigned_to`, **excluding `auth.userId`**.
- **Terminal stages:** first grep `pipeline_stages` schema for an `is_won`/`is_lost`/`is_terminal` flag and prefer it; only if none exists, hard-code slugs `enrolled`/`rejected` with a comment that slugs are tenant-configurable. On terminal → also notify admins (`getTenantAdminRecipients`).
- `link: /leads/{id}`. Combine recipients via `createNotificationsExcept(auth.userId, [...])`.
- Message e.g. `${leadName} moved to ${updated.status}` (reuse `leadName` already computed ~line 293).

### 1.3 `lead.created` — both create paths
- `src/app/(main)/api/v1/leads/route.ts` create path (after the event-emit `Promise.all`, ~line 412) **and** `src/app/api/public/submit/[tenantSlug]/[formSlug]/route.ts` (after its `Promise.all`, ~line 278).
- Routing: `assigned_to` set → assignee; else → `getTenantAdminRecipients`. No CRM-user actor on either path → no self-suppression.
- **Volume guard (required):** only notify when `lead.is_final === true` (the `/v1/leads` create path can produce partial leads; public submit is always final).
- **Collapse (recommended):** per-admin rolling counter via `upsertThreadNotification` keyed on `type=lead.created` + the admin's `user_id` (link `/leads` generic or the specific lead — use a stable key; for collapse a generic `/leads` link with a "N new leads" message is acceptable). Use judgment; the must-have is the `is_final` guard.
- `link: /leads/{id}` (single) — for the collapsed case a `/leads` list link is fine.

### 1.4 `email.received` — `src/app/api/internal/email/poll/lib.ts`
- Inside `pollOneAccount`, in the per-message success path **after** the thread-metadata update (~line 223) and the existing `emitEvent("email.received")` (~line 240), before `newInboundCount += 1`.
- Recipients: `account.user_id` (inbox owner, always present) + lead assignee via `select assigned_to from leads where id = thread.lead_id` (only if `thread.lead_id` set). Unique set, nulls dropped. No CRM actor to suppress (sender is external).
- **Collapse (core):** maintain a `Set<string>` of thread ids notified this cycle at the top of `pollOneAccount`; skip notification creation (not the email insert) if the thread is already in the set this cycle.
- **Collapse (cross-cycle, recommended):** `upsertThreadNotification` keyed on `type=email.received` + `userId` + `link=/leads/{lead_id}` within ~15 min → bump ("2 new replies") instead of insert.
- `link: thread.lead_id ? /leads/{lead_id} : undefined`. Wrap notification creation in its own try/catch so a failure never aborts the poll (match the existing per-message try/catch).
- Message e.g. `${parsed.from_name || parsed.from_email}: ${parsed.subject || "(no subject)"}`.

### 1.5 (Cosmetic, optional) — `notifications-dropdown.tsx` (~111-139)
- Add `getNotificationIcon` cases for the three new types. Default icon already works; skip if time-boxed.

---

## PART 2 — Attention badges

### 2.1 Migration `supabase/migrations/028_email_read_state.sql`
```sql
ALTER TABLE emails ADD COLUMN read_at TIMESTAMPTZ;

-- Backfill so existing inbound mail doesn't all show unread on deploy (CRITICAL line):
UPDATE emails SET read_at = COALESCE(received_at, sent_at, created_at)
WHERE direction = 'inbound' AND read_at IS NULL;

CREATE INDEX idx_emails_unread_inbound ON emails (thread_id)
WHERE direction = 'inbound' AND read_at IS NULL;
```
- `read_at` is only meaningful for inbound rows (outbound stays NULL; the unread query filters `direction='inbound'`).
- RLS: no new policy. Counselors are not `is_tenant_admin`, so they can't UPDATE `emails` under RLS — the mark-read endpoint runs via service-role `scopedClient` and enforces counselor scope in code (2.2).
- Apply via Supabase MCP after review.

### 2.2 Mark-as-read flow
- **New endpoint** `src/app/(main)/api/v1/email/threads/[id]/read/route.ts` (`PATCH`): structure from `src/app/(main)/api/v1/notifications/[id]/read/route.ts`, but use `scopedClient(auth)` + `getFeatureAccess(auth.industryId, FEATURES.EMAIL) → apiForbidden()`. Counselor scope: if `auth.role === 'counselor'`, fetch own `connected_email_account_id`s (same 2-query approach as `email/threads/route.ts:27-38`) and verify the thread's account is in that set (404 otherwise). Then:
  `db.from("emails").update({ read_at: new Date().toISOString() }).eq("thread_id", id).eq("direction","inbound").is("read_at", null)`.
- **Expose `read_at`:** add `read_at: string | null` to the `Email` interface in `src/industries/education-consultancy/features/email/hooks/use-email-threads.ts`, and add `read_at` to the select string in `src/app/(main)/api/v1/email/threads/route.ts` (~line 44).
- **Trigger:** in `email-thread-card.tsx`, on expand (when the thread has any inbound with `read_at === null`) → `fetch(/api/v1/email/threads/${thread.id}/read, { method: "PATCH" })` + call a new `onThreadRead(threadId)` prop.
- **Optimistic update:** `activities-panel.tsx` passes `onThreadRead` that does `setThreads(prev => prev.map(t => t.id === id ? { ...t, emails: t.emails.map(e => e.direction==='inbound' ? { ...e, read_at: e.read_at ?? now } : e) } : t))`. Badge derives from `threads`, so it clears instantly. No rollback on PATCH failure (next refresh re-syncs).

### 2.3 Unified counts endpoint + hook
- **New** `src/app/(main)/api/v1/badge-counts/route.ts` (`GET`, `export const dynamic = "force-dynamic"`, `scopedClient`, head+count queries). Returns `apiSuccess({ unread_notifications, new_leads })`:
  - `unread_notifications`: `notifications` where `user_id = auth.userId AND read_at IS NULL`.
  - `new_leads`: `leads` where `status='new' AND deleted_at IS NULL AND converted_at IS NULL`; **if `auth.role === 'counselor'` add `.eq("assigned_to", auth.userId)`** (mirror `leads/route.ts:73-80`).
  - Do **not** include email-unread — it's derived client-side, keeping this endpoint universal & cheap.
- **New hook** `src/hooks/use-badge-counts.ts` — reuse the 30s-poll pattern from `notifications-dropdown.tsx:41-69`. Returns `{ counts, refresh }`.

### 2.4 Sidebar badges — `src/components/dashboard/shell.tsx`
- `const { counts } = useBadgeCounts();` (component is already `"use client"`).
- Extend `renderNavItem` (~line 221) to accept optional `badge?: number`; after the label render:
  `{badge ? <Badge variant="destructive" className="ml-auto h-5 min-w-5 px-1.5 text-xs">{badge > 9 ? "9+" : badge}</Badge> : null}`.
- In the `UNIVERSAL_NAV_TOP.map` render (~line 289), inject `badge: counts.new_leads` for the `/leads` item only. Industry items: no badge.

### 2.5 Emails sub-tab badge — `src/components/dashboard/lead/activities/activities-panel.tsx`
- `const unreadEmailCount = useMemo(() => threads.reduce((n, t) => n + t.emails.filter(e => e.direction === 'inbound' && !e.read_at).length, 0), [threads]);`
- In the `SUB_TABS.map` render (~line 286), for `tab.id === 'emails' && unreadEmailCount > 0` render a red `<Badge>` next to the label (`Badge` is already imported).
- Pass `onThreadRead` to each `<EmailThreadCard>` (~line 367) wired to the optimistic updater. Non-education tenants: the hook only runs when `isEducation`, so `threads=[]` and the count is 0 automatically.
- Stretch (skip v1): Tasks sub-tab badge — the sub-tab is a placeholder with no per-lead task list; not cheap.

---

## Counselor-scoping checklist
- `unread_notifications` — per-user by construction ✅
- `new_leads` — **must** add `assigned_to = auth.userId` for counselors ⚠️ (easy-to-miss leak)
- email-unread (per-lead) — inherits `threads/route.ts` counselor scoping ✅
- mark-read PATCH — re-check thread ownership in code (RLS won't authorize counselors) ⚠️
- All notifications to a counselor must be for leads assigned to them (routing enforces this)

---

## Verification (on dev, before requesting review)
1. `npm run build` clean.
2. **email.received:** reply to a connected inbox → manual poll → bell shows "New email reply" → click opens `/leads/{id}` → Emails sub-tab red badge → expand → badge clears + `read_at` set (psql check).
3. **lead.created:** public form submit → admin bell "New lead" → "All Leads" sidebar badge increments → working the lead off `new` decrements.
4. **lead.stage_changed:** admin moves a counselor's lead → counselor notified; counselor moves their own → no self-ping; move to `enrolled` → admins notified.
5. **Self-suppression:** self-assign a lead → no notification.
6. **Counselor scope:** counselor's `new_leads` counts only own assigned `new` leads; cannot mark another counselor's thread read (404).
7. **Backfill:** after migration 028, old inbound emails show read (no unread flood).
8. **Non-education tenant:** no email badges / no `email.received`; lead/stage notifications + "All Leads" badge still work.

## Out of scope / parked
- Email prod promotion (separate gated deploy).
- `task.due` (separate brief — needs project-link decision + daily cron + `due_notified_at` dedup column).
- Per-user notification preferences / digest (defer until ~10+ users/tenant).
- True per-user lead "viewed" marker (`lead_views` table) — `new`-stage definition suffices for v1.

## Tenant-isolation reminders (load-bearing)
- New routes use `scopedClient(auth)`; `.update()` always carries a caller filter beyond the auto `tenant_id` (the `.eq("thread_id", id)` etc.).
- Migration 028 column is on the existing tenant-scoped `emails` table — no new RLS needed.
