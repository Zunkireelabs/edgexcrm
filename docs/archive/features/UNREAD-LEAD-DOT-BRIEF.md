# Unread-Lead Red Dot (leads table) — Implementation Brief

> **Status:** approved, ready for implementation. Branch off `stage`.
> **Read end-to-end before coding.** Verified findings are inlined so you don't re-derive them — but open each cited file to confirm line numbers (they drift) before editing.

---

## Why this exists

We just shipped notifications + a sidebar "All Leads" badge (the red **"1"**). But that count tells the user *that* a lead needs attention, not *which* one. The owner wants the **lead row itself** to carry a **small red dot next to the name** — so across the "All Leads" table you can see at a glance exactly which leads have something unread, like unread conversations in an email inbox. Opening the lead clears its dot.

This is a small, focused addition on top of the existing notification plumbing — **no new endpoint, no new hook, no schema change.**

---

## The single source of truth: "a lead is unread if…"

> The current user has an **unread notification whose `link` is `/leads/{thatLeadId}`**.

That naturally covers every lead-related event we notify on (`lead.created`, `lead.assigned`, `lead.stage_changed`, `email.received` with a lead) because they all link to `/leads/{id}`. Bulk-assign notifications use the bare `/leads` link (no id) and are correctly excluded by the `/leads/%` match.

**Both** the row dots **and** the sidebar "All Leads" count must derive from this one definition, so the number on "All Leads" always equals the number of dotted rows. We achieve that by computing the unread lead-id set once (server) and deriving the count from it.

---

## Verified findings (don't re-derive)

- **Leads page** `src/app/(main)/(dashboard)/leads/page.tsx` is an async **Server Component**. It fetches via `getLeads(tenantId, { role, userId })` (`src/lib/supabase/queries.ts:34-55`) and passes `leads` + many props into `<LeadsTable>` (page lines ~52-64), including `currentUserId` and `role`.
- **Leads table** `src/components/dashboard/leads-table.tsx` is a **client component** (`"use client"`). Lead **name** is rendered ~lines 824-835:
  ```tsx
  <td className="px-3 py-1.5">
    <div className="group/name relative" style={{ width: NAME_COLUMN_WIDTH }}>
      <Link href={`/leads/${lead.id}`} className="text-sm font-medium text-[#0f0f10] hover:underline block pr-0 group-hover/name:pr-[72px] transition-[padding] duration-100">
        <TruncatedText text={`${lead.first_name || ""} ${lead.last_name || ""}`.trim() || "—"} />
      </Link>
    </div>
  </td>
  ```
  (The `group-hover/name:pr-[72px]` makes room for a hover "Preview" button on the right — keep the dot on the **left** so it never collides with that.)
- **`useBadgeCounts`** `src/hooks/use-badge-counts.ts` already fetches `/api/v1/badge-counts` on mount + every 30s and returns `{ counts, refresh }`. Counts shape: `{ unread_notifications, unread_leads }`.
- **`/api/v1/badge-counts`** `src/app/(main)/api/v1/badge-counts/route.ts` — `scopedClient`, `force-dynamic`, per-user. Currently computes `unread_leads` as a count of unread `lead.created` notifications.
- **Clearing already works:** opening a lead fires `POST /api/v1/notifications/read-by-link` with `{ link: "/leads/{id}" }` (`lead-detail-v2.tsx` ~lines 117-123), which sets `read_at` on that lead's unread notifications. So once a lead is opened, it drops out of the unread set on the next 30s poll / list refresh — no new clearing logic needed.
- **Index:** `idx_notifications_user_unread` (partial, `WHERE read_at IS NULL`) covers the query — cheap.
- **Counselor scoping:** `getLeads` already filters the list to `assigned_to = userId` for counselors. Notifications are per-user (`user_id`). So a counselor's unread set only references their own leads, and dots only land on rows they can see. No leak, no extra work.

---

## Implementation

### 1. `/api/v1/badge-counts/route.ts` — also return the unread lead-id set
Replace the `unread_leads` count query with a select of the unread lead **links**, derive the id set in JS, and return both the array and its length (so count == dots):

```ts
const { data: unreadLeadRows } = await db
  .from("notifications")
  .select("link")
  .eq("user_id", auth.userId)
  .is("read_at", null)
  .like("link", "/leads/%");

const unreadLeadIds = [
  ...new Set(
    (unreadLeadRows ?? [])
      .map((r) => (r.link as string).slice("/leads/".length))
      .filter((id) => id && !id.includes("/")) // exclude nested/non-id links
  ),
];

return apiSuccess({
  unread_notifications: unreadNotifications ?? 0,
  unread_leads: unreadLeadIds.length,
  unread_lead_ids: unreadLeadIds,
});
```
Keep the existing `unread_notifications` query as-is. (`unread_leads` now means "distinct leads with any unread notification" — this is intentionally broader than before and makes the sidebar count equal the number of dotted rows.)

### 2. `src/hooks/use-badge-counts.ts` — expose the id set
- Extend the `BadgeCounts` interface: add `unread_lead_ids: string[]`.
- Add `unread_lead_ids: []` to `DEFAULT_COUNTS`.
- No other change — the hook already returns `counts`.

### 3. `src/components/dashboard/leads-table.tsx` — render the dot
- Import and call the hook near the top of the component: `const { counts } = useBadgeCounts();` then `const unreadLeadIds = useMemo(() => new Set(counts.unread_lead_ids), [counts.unread_lead_ids]);`
- In the name cell (~line 824), add a red dot **absolutely positioned in the left padding gutter** so it does **not** shift name alignment between dotted and non-dotted rows:
  ```tsx
  <td className="px-3 py-1.5">
    <div className="group/name relative" style={{ width: NAME_COLUMN_WIDTH }}>
      {unreadLeadIds.has(lead.id) && (
        <span
          className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-red-500"
          aria-label="Unread notification"
        />
      )}
      <Link href={`/leads/${lead.id}`} className="…unchanged…">
        <TruncatedText text={…unchanged…} />
      </Link>
    </div>
  </td>
  ```
  The `-left-2.5` places the dot inside the existing `px-3` (12px) left padding, so the name text stays put. If it visually crowds the avatar column, nudge to `-left-2` / `-left-3`; pick what looks right in the running app. Dot color matches the bell/sidebar red (`bg-red-500`).
- **Do not** add client polling here — `useBadgeCounts` already polls 30s, so the dots self-heal (a lead opened elsewhere clears within ≤30s; returning to the list shows the cleared state).

---

## Behaviour to expect
- A lead with any unread lead-linked notification shows a red dot next to its name; "All Leads" sidebar count equals the number of dotted rows.
- Opening a lead (from the row, the bell, or directly) clears that lead's notifications (existing `read-by-link`), so within ≤30s the dot disappears and the sidebar count decrements.
- Counselors only ever see dots on their own assigned leads.
- Non-education tenants: lead/stage/assign notifications still produce dots (universal); email ones simply don't exist for them.

## Verification (dev or local)
1. `npm run build` clean **and** `npx eslint --max-warnings 50` → **0 errors** (CI enforces the stricter lint — `build` alone is not enough; this bit us once already).
2. Submit a fresh form → "All Leads" sidebar shows "1" **and** the new lead's row shows a red dot next to its name.
3. Open that lead → return to the list → within ≤30s the dot is gone and the sidebar count drops to 0.
4. Trigger an inbound email reply on a lead (poll) → that lead's row gets a dot too (broader than just new-lead).
5. As a counselor, dots appear only on assigned leads; the count matches.
6. Confirm non-dotted and dotted rows keep their names left-aligned (dot lives in the padding gutter, no shift).

## Out of scope
- Real-time (sub-30s) dot updates — the 30s poll is the cadence, matching the bell.
- Per-row dots on any list other than "All Leads" (e.g. pipeline/kanban) — not requested.
- Schema changes — none.

## Tenant-isolation / workflow reminders
- `/api/v1/badge-counts` stays `scopedClient` + per-user (`user_id`); no cross-tenant exposure.
- Confirm cited line numbers before editing; the table file is large.

---

## Sonnet handoff prompt (paste this)

```
You're implementing a small notifications enhancement on a feature branch: a red dot next to a lead's name in the "All Leads" table for leads with unread notifications. READ /Users/sadinshrestha/Projects/edgeXcrm/docs/UNREAD-LEAD-DOT-BRIEF.md end-to-end first — it has the exact files, line numbers, the unified "unread lead" definition, and the verification matrix. Also skim CLAUDE.md § Tenant Isolation Rules.

This builds directly on the just-shipped notifications feature (badge-counts endpoint, useBadgeCounts hook, read-by-link clearing). It is intentionally small: NO new endpoint, NO new hook, NO schema change.

Steps (from repo root):
1. git fetch origin && git checkout -b feat/unread-lead-dot origin/stage
2. Implement the 3 changes in the brief, in order:
   a. /api/v1/badge-counts/route.ts — also return `unread_lead_ids: string[]` (distinct lead ids parsed from the current user's unread notifications with link like '/leads/%'); set `unread_leads = unread_lead_ids.length`.
   b. src/hooks/use-badge-counts.ts — add `unread_lead_ids: string[]` to the BadgeCounts interface and DEFAULT_COUNTS.
   c. src/components/dashboard/leads-table.tsx — consume useBadgeCounts(); render an absolutely-positioned red dot (bg-red-500, in the left padding gutter so name alignment doesn't shift) next to the name when the lead id is in the unread set.
3. Confirm the cited line numbers before editing (the table file is large).
4. Verify before pushing: `npm run build` clean AND `npx eslint --max-warnings 50` → 0 errors (CI enforces the stricter lint; build alone misses it). Then self-check against the brief's verification matrix; note which steps need the live dev environment.

When done, push feat/unread-lead-dot and summarize what you changed + which verification steps passed, for review + squash-merge to stage.
```
