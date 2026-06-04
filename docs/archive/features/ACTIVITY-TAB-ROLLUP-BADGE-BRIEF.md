# Activity Tab Roll-Up Notification Badge — Implementation Brief

> **Status:** approved, ready for implementation. Branch off `stage`.
> **Read end-to-end before coding.** Verified findings inlined — but confirm cited line numbers (they drift) before editing.

---

## Why this exists

On the lead detail page, the top-level **Activity** tab contains inner sub-tabs (Activity / Notes / Emails / Calls / Tasks / Meetings). When an inbound email reply arrives, the **Emails sub-tab** lights up with a red unread badge — but from the outside, with the Activity tab collapsed, you **can't tell** there's something unread inside; the Activity tab only shows a neutral gray count of activities.

The owner wants the **Activity top tab to carry a red roll-up badge = the total of its inner sub-tabs' notification counts**, so you can see at a glance that a lead has unread activity without clicking in. Today that total is driven entirely by **unread inbound emails**; it must be written as a **sum** so future inner-tab counts (unread calls/tasks/meetings) add into it.

**Confirmed design:** red roll-up **takes priority** — when the roll-up count > 0, show the red badge; otherwise fall back to the existing gray activities-count badge. One badge slot, red wins.

---

## The core constraint (why this is a lift, not a one-liner)

The inner unread-email count is computed inside `ActivitiesPanel` from `useEmailThreads`. But `ActivitiesPanel` is rendered as the Activity tab's content, and **Radix `TabsContent` unmounts inactive tabs** — so when the user is on Overview/Notes, `ActivitiesPanel` isn't mounted and its count doesn't exist. The roll-up badge has to show regardless of the active tab.

Therefore the email-threads state must be **lifted from `ActivitiesPanel` up to `lead-tabs.tsx`** (which is always mounted), which renders the badge and passes the threads back down. This is safe because **both `ActivitiesPanel` and `useEmailThreads` have exactly one consumer each** (verified) — no other component breaks.

Using the *same* threads state for both the parent badge and the child Emails sub-tab badge also guarantees they're **always exactly consistent** (the user's "parent = sum of children" requirement), including instant clearing when a thread is expanded.

---

## Verified findings (don't re-derive)

- **`lead-tabs.tsx`** (`src/components/dashboard/lead/lead-tabs.tsx`) is the always-mounted tab strip. The Activity trigger (lines 63-70) currently renders a gray badge from `activities.length`:
  ```tsx
  <TabsTrigger value="activity" className="gap-2">
    Activity
    {activities.length > 0 && (
      <Badge variant="secondary" className="h-5 px-1.5 text-xs">{activities.length}</Badge>
    )}
  </TabsTrigger>
  ```
  It renders `<ActivitiesPanel … />` as the activity TabsContent (lines 158-172). It already imports `Badge`. It does NOT currently import `useMemo`/`useEmailThreads`.
- **`ActivitiesPanel`** (`src/components/dashboard/lead/activities/activities-panel.tsx`):
  - Owns email state: `const { threads, setThreads, loading: threadsLoading } = useEmailThreads(isEducation ? leadId : "")` (line 83). `isEducation = industryId === "education_consultancy"` (line 80).
  - Derives the count (lines 216-223): `unreadEmailCount = threads.reduce((n,t)=>n+t.emails.filter(e=>e.direction==='inbound'&&!e.read_at).length,0)`.
  - `handleThreadRead` (lines 225-234) optimistically marks a thread's inbound emails read via `setThreads` — clears the badge on expand.
  - Uses `threadsLoading` (line 298), renders the Emails sub-tab badge from `unreadEmailCount` (lines 317-320), passes `onThreadRead={handleThreadRead}` to `<EmailThreadCard>` (line 399).
- **Single consumers:** `ActivitiesPanel` is used only in `lead-tabs.tsx`; `useEmailThreads` is used only in `activities-panel.tsx`.
- **`EmailThread` / `Email` types** come from `@/industries/education-consultancy/features/email/hooks/use-email-threads`.

---

## Implementation

### 1. `lead-tabs.tsx` — lift the email state, render the roll-up badge
- Add imports: `useMemo` (from react), `useEmailThreads`, and `type EmailThread, type Email` from the email-threads hook.
- Inside `LeadTabs`, before the return:
  ```tsx
  const isEducation = industryId === "education_consultancy";
  const { threads, setThreads, loading: threadsLoading } = useEmailThreads(isEducation ? lead.id : "");
  const unreadEmailCount = useMemo(
    () => threads.reduce((n, t) => n + t.emails.filter((e) => e.direction === "inbound" && !e.read_at).length, 0),
    [threads]
  );
  // Roll-up of inner Activity sub-tab notification counts. Today only Emails has one;
  // add future inner counts (unread calls/tasks/meetings) into this sum.
  const activityUnreadCount = unreadEmailCount;
  ```
- Replace the Activity trigger badge (lines 63-70) with red-takes-priority:
  ```tsx
  <TabsTrigger value="activity" className="gap-2">
    Activity
    {activityUnreadCount > 0 ? (
      <Badge variant="destructive" className="h-5 min-w-5 px-1.5 text-xs">
        {activityUnreadCount > 9 ? "9+" : activityUnreadCount}
      </Badge>
    ) : activities.length > 0 ? (
      <Badge variant="secondary" className="h-5 px-1.5 text-xs">{activities.length}</Badge>
    ) : null}
  </TabsTrigger>
  ```
- Pass the lifted state into `<ActivitiesPanel>` (add these props to the existing element, lines 159-171):
  ```tsx
  threads={threads}
  setThreads={setThreads}
  threadsLoading={threadsLoading}
  ```

### 2. `activities-panel.tsx` — receive threads as props instead of fetching
- **Remove** the `useEmailThreads` call (line 83).
- Extend `ActivitiesPanelProps` (interface ~line 37) with:
  ```tsx
  threads: EmailThread[];
  setThreads: React.Dispatch<React.SetStateAction<EmailThread[]>>;
  threadsLoading: boolean;
  ```
  Import `type EmailThread, type Email` are already imported from the hook (line 14) — keep `EmailThread`/`Email`; you may drop the `useEmailThreads` import if no longer referenced (keep the type imports).
- Destructure the new props in the component signature; keep `isEducation` as-is.
- Everything else stays: `unreadEmailCount` (now derives from the `threads` prop), `handleThreadRead` (uses the `setThreads` prop), `threadsLoading` usage (now the prop), the Emails sub-tab badge, and `onThreadRead={handleThreadRead}`. No logic changes — they just read props instead of local hook state.

### Why this is exactly consistent
Parent badge and child Emails sub-tab badge both derive `unreadEmailCount` from the **same** `threads` array. Expanding a thread fires `handleThreadRead` → `setThreads` (the lifted state) → both badges drop in the same render. No lag, no divergence.

---

## Behaviour to expect
- Activity top tab shows a **red badge = unread inbound emails** for the lead (the roll-up), visible without opening the Activity tab.
- When there are no unread notifications, it falls back to the existing gray activities-count badge.
- Opening/expanding the email thread clears the Emails sub-tab badge **and** the Activity roll-up badge simultaneously.
- Non-education tenants: `isEducation` is false → `useEmailThreads("")` → `threads=[]` → roll-up is 0 → gray count behavior unchanged.
- Note: email threads now fetch on lead-detail mount (lead-tabs is always mounted) instead of on first Activity-tab click — one extra `/api/v1/email/threads` call per lead-detail open for education tenants, which is what makes the badge appear upfront. Acceptable.

## Verification (dev or local)
1. `npm run build` clean **and** `npx eslint --max-warnings 50` → **0 errors** (CI enforces the stricter lint; build alone misses it).
2. Lead with an unread inbound email → **Activity top tab shows a red "1"** (matching the Emails sub-tab red "1"), visible while sitting on the Overview tab.
3. Open the Activity tab → Emails sub-tab → expand the thread → **both** the Emails badge and the Activity roll-up badge clear together.
4. Lead with activities but no unread email → Activity tab shows the **gray** activities count (unchanged).
5. Non-education tenant (Zunkireelabs) → no red badge; gray activities count behaves as before; no errors.
6. Multiple unread inbound emails across threads → the Activity badge equals their sum (and the Emails sub-tab badge); >9 shows "9+".

## Out of scope
- Roll-up badges on other top tabs (Notes/Overview/AI Insights) — only Activity was requested.
- Notification-table-based counts — the roll-up intentionally uses the same `emails.read_at` source as the inner Emails badge so parent == sum of children exactly.
- Wiring Calls/Tasks/Meetings unread counts — none exist yet; `activityUnreadCount` is written as a sum so they slot in later.
- Schema changes — none.

## Reminders
- Confirm the cited line numbers before editing.
- `setThreads` passed as a prop must be typed `React.Dispatch<React.SetStateAction<EmailThread[]>>` (matches what `useEmailThreads` returns).

---

## Sonnet handoff prompt (paste this)

```
You're implementing a small notifications UI enhancement on a feature branch: a red roll-up badge on the lead-detail "Activity" top tab equal to the total of its inner sub-tabs' notification counts (today = unread inbound emails). READ /Users/sadinshrestha/Projects/edgeXcrm/docs/ACTIVITY-TAB-ROLLUP-BADGE-BRIEF.md end-to-end first — it has the exact files, line numbers, the lift rationale, and the verification matrix. Also skim CLAUDE.md § Industry Scoping Rules.

Core idea: ActivitiesPanel (which computes the unread-email count) is unmounted when the Activity tab isn't active, so the count must be LIFTED to lead-tabs.tsx (always mounted), which renders the badge and passes threads back down. Both ActivitiesPanel and useEmailThreads have exactly one consumer each, so this is safe. No new endpoint/hook/schema.

Steps (from repo root):
1. git fetch origin && git checkout -b feat/activity-rollup-badge origin/stage
2. lead-tabs.tsx: lift `useEmailThreads(isEducation ? lead.id : "")` here; compute `unreadEmailCount`; render the Activity trigger badge as red-takes-priority (red `unreadEmailCount` roll-up if >0, else gray `activities.length`); pass `threads` + `setThreads` + `threadsLoading` down to <ActivitiesPanel>.
3. activities-panel.tsx: remove its internal useEmailThreads call; add `threads`, `setThreads`, `threadsLoading` to the props interface and destructure them; leave unreadEmailCount/handleThreadRead/Emails-sub-tab-badge logic unchanged (they now read the props).
4. Confirm cited line numbers before editing.
5. Verify before pushing: `npm run build` clean AND `npx eslint --max-warnings 50` → 0 errors. Self-check against the brief's verification matrix; note which steps need the live dev environment.

When done, push feat/activity-rollup-badge and summarize what you changed + which verification steps passed, for review + squash-merge to stage.
```
