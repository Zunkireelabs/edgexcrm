# Account detail page — v2 (billable totals + Account Team + Activity feed)

> Close the explicit deferrals from the v1 brief (now archived at `docs/archive/features/ACCOUNT-DETAIL-360-BRIEF.md`, shipped at `d1a4b89`). v2 adds three surfaces to `/accounts/[id]`: **billable totals in KEY INFO** (left column), **Account Team card** (right column, between HealthSnapshot and OpenLeads), and **Activity tab content** (middle column, currently disabled with "Coming soon"). UI additions + 3 new API endpoints + 5 small `emitEvent()` additions on existing routes; no DB migrations.

---

## Goal

v1 shipped a workspace-first 3-column page with HealthSnapshot + conditional OpenLeads in the right column. Three deferrals were called out as "table-stakes for an agency CRM" by the CRM-expert consult: lifetime billable $, billable hrs this month, and the Account Team card. The Activity tab was scaffolded but disabled.

v2 closes all three deferrals in one brief. Backend infra is mostly already there — `time_entries` + `rate_snapshot` + `projects.account_id` exist, `events` is populated by 12 emit sites, `auth.users` lookups work via the documented `scopedClient.raw()` escape hatch (precedent set by v1's `owner_email`).

---

## What the CRM domain expert pushed back on (verbatim)

A v2 follow-up consultation by `/crm-expert` shaped three concrete design decisions:

> **1. Billable totals — KEY INFO + a trend signal, no sparkline yet.** Your 2 KEY INFO rows are the floor. **Add a third row: "Billable hrs this month: XX.X hrs"** — owners care about both the dollar amount and the hours (utilization signal). On "Billable this month $", **add a tiny ▲/▼ delta vs last month** (e.g. "$4,250 ▲ +12%"). That delta is the killer signal in PSA dashboards (Productive + Harvest both lead with it). Skip the sparkline in v2 — it's polish, not table-stakes; defer to v3.
>
> **Drop the "supplemental line in the Overview Active Projects card."** Duplicating the same number 12px below the KEY INFO row reads as noise. The KEY INFO is canonical; the project rows show $ per project; the Health Snapshot already shows project counts. Three places saying the same thing is two places too many.

> **2. Account Team card — group + sort + label spec.** Per-row content: **avatar + name + role label + "X.X hrs this month" + "Last active N days ago"** (small grey if >14d). Don't show lifetime $ per person — that's a per-user profile concern. Don't show their job title — that's user-profile territory, not account-relationship territory.
>
> **Two-group structure, NOT a flat list**:
> - **Owners** section: account owner (pinned first) + project owners. Sorted: account owner always #1, then project owners by hrs-this-month desc.
> - **Contributors** section: everyone else who logged time on this account's projects in the last 90 days. Sorted by hrs-this-month desc.
>
> Salesforce's flat "Account Team" is wrong shape for PSA — agencies have a real Owner/IC distinction that a flat list flattens out. The two-group layout is **worth it** here, especially for big accounts.
>
> **Role labels** (PSA-canonical): `Account Manager` (owner) · `Project Lead` (project owners) · `Contributor` (time loggers). Avoid job titles ("Engineer", "Designer") — those live on the user profile.
>
> **Inactive cutoff**: contributors filter to "active in last 90 days." Owners + project owners stay regardless. Show "Active last 6mo ago" tag on rows >14d but ≤90d. Card header shows count badge: `Team (5)`.

> **3. Activity feed — events table + derived time-logged stream.** Add `account_status_changed` (Active ↔ Inactive — high-signal for client health), `time_entry_approved` (specifically the approval, not individual entry creation — too noisy), `primary_contact_changed` (relationship signal).
>
> **Exclude at account level** (live on Project Activity instead): individual task status changes · task comments · file uploads.
>
> **Critical aggregation rule for time entries**: group by `user + day + project`. "Alice logged 6.5h on Project X on May 28" — one row — not four entries of "+0.5h, +1h, +2h, +3h." This is the difference between a usable feed and an unreadable wall of noise. The brief must be explicit about this.
>
> **Sort**: created_at desc; **paginate** at 30 items with "Load more"; **icons** per event type (FolderPlus, Clock, UserPlus, Building2, Edit). Filter chips on top ("All / Time / Projects / Contacts / Changes") = v3.
>
> **Feasibility caveat**: the events table is sparse today. Shipping Activity in v2 means **derived time-logged events are the spine of the feed** initially. The brief should call this out so Sonnet doesn't expect 50 events on day one.

---

## Scope

### In scope (v2)

1. **Billable totals** in `AccountKeyInfoSection` — 3 new rows:
   - **Billable this month**: `$X,XXX ▲ +Y%` (delta vs last calendar month — green up arrow, red down arrow, gray equals).
   - **Billable hours this month**: `XX.X hrs`.
   - **Lifetime billable**: `$XX,XXX`.
2. **`AccountTeamCard`** in `AccountRelatedPanel`, slotted **between `HealthSnapshotCard` and `OpenLeadsCard`**. Two-group structure (Owners / Contributors). Always renders (an account always has at least the owner).
3. **Activity tab content** — wires the disabled `Activity` trigger in `AccountTabs`. Union of (a) events table rows scoped to this account and (b) derived time-logged stream aggregated by user+day+project. Paginated at 30 with "Load more."
4. **3 new API endpoints** (see Backend section):
   - `GET /api/v1/accounts/[id]/billable-summary`
   - `GET /api/v1/accounts/[id]/team`
   - `GET /api/v1/accounts/[id]/activity?page=1&limit=30`
5. **5 `emitEvent()` additions** on existing mutation routes — enables Activity feed coverage:
   - `account.updated` in `PATCH /api/v1/accounts/[id]` (notes/owner/active/primary_contact flips).
   - `project.updated` in `PATCH /api/v1/projects/[id]` — payload includes `{ changed_fields: ["status", "owner_id", ...] }` so the feed can render "Project X status changed to Active" without a separate event type per field.
   - `time_entry.approved` + `time_entry.rejected` in `/api/v1/time-entries/[id]/approve` + `/reject`.
   - `lead.converted` in `POST /api/v1/leads/[id]/convert` — payload includes `{ contact_id, account_id }` so the feed can render "Lead → Contact at this account."

### Out of scope (deferred to v3)

- **Sparkline / trend chart** of billable $ over last 6 months on the Account page. KEY INFO delta row covers 80% of the value.
- **Billing tab content** (invoices + retainer + per-project breakdown) — needs an invoices model. v3.
- **Filter chips on Activity tab** ("All / Time / Projects / Contacts / Changes"). v3 polish.
- **Per-user billable detail page** (drill-in from Account Team row → individual contributor's history on this account). v3.
- **`last_activity_at` computed field** on Account list — covered by Activity feed showing the most recent event; the list-page column was bundled into this brief originally but Activity solves the same surface needs better.
- **At-risk health score** — needs defined signals (no activity 14d, missed deadlines, etc.). Separate brief.
- **Webhook dispatcher actually consuming `events` rows** — adding emits in v2 makes the table richer, but the dispatcher still doesn't fire HTTP webhooks. Out of scope for this brief; see STATUS-BOARD ongoing hardening item.
- **`time_entries.account_id` denormalization** to drop the JOIN — not needed yet; queries via `JOIN projects` are fast enough at current scale.

---

## Layout — per surface

### Billable totals (left column, in `AccountKeyInfoSection`)

Insert 3 new rows in `AccountKeyInfoSection` **between "Open Leads" and "Created"**:

- **Billable this month** — value composed of: `formatCurrency(amount_this_month)` + delta pill.
  - Delta computation: `(amount_this_month - amount_last_month) / amount_last_month` × 100. Round to whole percent.
  - Delta rendering: `▲ +12%` (green-700 text, no background), `▼ -8%` (red-600 text, no background), `— 0%` (text-muted-foreground) if exactly equal or both zero, **nothing** (just the dollar value, no delta) if last_month was zero AND this_month > 0 (would divide by zero — show "New" pill instead).
  - When BOTH months are zero: render `$0` only, no delta.
- **Billable hrs this month** — `XX.X hrs` (one decimal place, e.g. "62.5 hrs"). Compute from `billable_minutes_this_month / 60`.
- **Lifetime billable** — `$XX,XXX` (no delta). All-time sum.

For **counselor role**: these values reflect ONLY the counselor's own hours (existing scoping pattern on `/summary` endpoint, preserved in the new `/billable-summary` endpoint). Brief should add a small `(your hours only)` muted hint under the rows when `role === "counselor"` so the number isn't mistaken for the account total.

### `AccountTeamCard` (right column, new — between Health and OpenLeads)

Two-group structure:

**Header**: `Team (N)` — N is total count across both groups. Inactive contributors (>90 days no time logged) are not counted.

**Group 1 — Owners** (always rendered):
- Pinned first: account owner (avatar + name + `Account Manager` role pill).
- Then: project owners on this account (avatar + name + `Project Lead` role pill + "Owns: 2 projects" subtitle).
- Sort within group: account owner is always #1; project owners after, sorted by `hrs_this_month desc`.

**Group 2 — Contributors** (only rendered when there are any):
- Anyone who's logged time on this account's projects in the last 90 days AND isn't already an Owner.
- Avatar + name + `Contributor` role pill + `X.X hrs this month` + (if last activity >14d ago) `Active last Nd ago` small grey line.
- Sorted by `hrs_this_month desc`.

**Row visual**: 
- Avatar circle 28px with initials.
- Name `text-sm font-medium #0f0f10`.
- Role pill: `text-[10px] uppercase tracking-wide` — `Account Manager` (purple-50/700), `Project Lead` (blue-50/700), `Contributor` (gray-100/600).
- Hours-this-month right-aligned `text-xs #787871`.
- "Active last Nd ago" below the row if applicable, `text-[11px] text-gray-400`.

**Empty state**: never empty in practice (owner always exists). If somehow no owner is set AND no contributors exist, show "No team activity yet."

**Counselor mode**: card shows full team regardless of role — team identity is shared info, not personal data. The `hrs_this_month` numbers per person come from `/team` endpoint which does NOT scope by counselor (override the existing pattern explicitly here — team is read-only metadata, not personal).

### Activity tab (middle column, wires the disabled tab)

**Replace the disabled `Activity` trigger** in `AccountTabs` with a wired panel. Move `Activity` between `Contacts` and `Billing`:

```
[Overview] [Projects] [Contacts] [Activity] [Billing*]
                                              * disabled
```

**Panel content**:
- Empty state: "No activity yet on this account."
- Otherwise: vertical list of activity rows, ordered `created_at desc`, paginated 30 per page with "Load more" button at bottom.
- Each row: icon circle + main text + timestamp (relative: "2h ago", "3d ago", "last month").

**Row types** (from events table + derived time-logged):

| Event source | Row text | Icon |
|---|---|---|
| `account.created` | "Account created" | `Building2` |
| `account.updated` | "Account updated — {field}" (when payload includes `changed_fields`) | `Edit` |
| `account.status_changed` (derived from `account.updated` with `is_active` in changed_fields) | "Account marked Inactive" / "Account marked Active" | `ToggleLeft` |
| `primary_contact_changed` (derived from `account.updated` with `primary_contact_id` in changed_fields) | "Jane Doe set as primary contact" | `UserCheck` |
| `project.created` | "Project «Name» created" | `FolderPlus` |
| `project.updated` (status_changed flavor) | "Project «Name» → Active" | `FolderClock` |
| `project.deleted` | "Project «Name» deleted" | `FolderMinus` |
| Derived: time logged | "Alice logged 6.5h on «Project X»" | `Clock` |
| `time_entry.approved` | "Alice's 6.5h on «Project X» approved" | `CheckCircle` |
| `time_entry.rejected` | "Alice's 6.5h on «Project X» rejected" | `XCircle` |
| `contact.created` | "Contact Bob added" | `UserPlus` |
| `lead.converted` | "Lead Susan converted to contact" | `ArrowRightCircle` |
| `lead.created` (filtered to leads with this account_id) | "Lead Susan added" | `UserPlus` |

**Derived time-logged aggregation** (critical):
- The derived stream queries `time_entries WHERE project_id IN (SELECT id FROM projects WHERE account_id = X)` and **groups by `(user_id, entry_date, project_id)`** summing minutes.
- One aggregated row per group → ONE row in the activity feed, NOT one per time entry.
- Each aggregated row's `created_at` = `MAX(time_entries.created_at)` within the group (so the row sorts by when the LAST entry in that day's group was made).
- Subtle: don't show derived `time_entry.created` events from the events table — they're individual and noisy. Use the derived aggregated stream instead.

**Pagination shape**: response includes `{items: [...], next_page: number | null}`. Page param 1-indexed. Limit 30 per page (configurable up to 100).

**For counselor role**: activity feed scopes to events where `entity_id` is owned by the counselor OR `events.payload.user_id === auth.userId`. For derived time entries, only show entries where `time_entries.user_id === auth.userId`. Same scoping pattern as /leads activity.

---

## Backend additions

### 1. New endpoint: `GET /api/v1/accounts/[id]/billable-summary`

**File**: `src/app/(main)/api/v1/accounts/[id]/billable-summary/route.ts` (new).

**Response**:
```ts
{
  data: {
    this_month: {
      billable_minutes: number,
      billable_amount: number,        // sum of (minutes / 60) * rate_snapshot, filtered to is_billable + approval_status === 'approved'
    },
    last_month: {
      billable_minutes: number,
      billable_amount: number,
    },
    lifetime: {
      billable_minutes: number,
      billable_amount: number,
    }
  }
}
```

**Implementation**:
- Use `scopedClient(auth)` with `getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)` gate.
- 3 parallel queries via `Promise.all` — `this_month`, `last_month`, `lifetime`.
- Each query: `time_entries JOIN projects WHERE projects.account_id = id AND time_entries.is_billable = true AND time_entries.approval_status = 'approved' AND time_entries.entry_date BETWEEN start AND end`. Sum `(minutes * rate_snapshot / 60)` for amount, `SUM(minutes)` for minutes.
- For counselor: `AND time_entries.user_id = auth.userId`.
- Date boundaries computed server-side: `this_month_start = first day of current month`, `last_month_start = first day of previous month`, `last_month_end = last day of previous month`, `lifetime = no date filter`.

### 2. New endpoint: `GET /api/v1/accounts/[id]/team`

**File**: `src/app/(main)/api/v1/accounts/[id]/team/route.ts` (new).

**Response**:
```ts
{
  data: {
    owners: [
      {
        user_id: string,
        email: string,
        role_label: "Account Manager" | "Project Lead",
        is_account_owner: boolean,
        owned_projects_count: number,   // for project leads
        hrs_this_month: number,         // decimal hours
        last_active_at: string | null,  // most recent time_entry created_at, OR null if never
      }
    ],
    contributors: [
      {
        user_id: string,
        email: string,
        role_label: "Contributor",
        hrs_this_month: number,
        last_active_at: string,         // always set for contributors (defined by having logged time)
      }
    ]
  }
}
```

**Implementation**:
- Use `scopedClient(auth)` with feature gate. **Do NOT scope by counselor** — team identity is shared info.
- Identify the owner set:
  - Account owner: `accounts.owner_id` for this account.
  - Project owners: `SELECT DISTINCT owner_id FROM projects WHERE account_id = id AND owner_id IS NOT NULL`.
- Identify contributors: `SELECT DISTINCT user_id FROM time_entries JOIN projects ON time_entries.project_id = projects.id WHERE projects.account_id = id AND time_entries.created_at > NOW() - INTERVAL '90 days' AND time_entries.user_id NOT IN (owner_set)`.
- For each user in (owners ∪ contributors), compute:
  - `hrs_this_month`: `SUM(minutes) / 60` from time_entries in current calendar month for this account.
  - `last_active_at`: `MAX(time_entries.created_at)` for this account.
  - `owned_projects_count` (project leads only): count of projects on this account they own.
- Email lookup: use `scopedClient.raw().auth.admin.listUsers()` filtered to the union set, OR a loop of `getUserById()` if the set is small (<10).
- Sort within each group server-side per the brief.
- 5xx if any owner email lookup fails for one user → return that user with `email: null` rather than failing the whole response. Same try/catch-return-default pattern as v1.

### 3. New endpoint: `GET /api/v1/accounts/[id]/activity?page=1&limit=30`

**File**: `src/app/(main)/api/v1/accounts/[id]/activity/route.ts` (new).

**Response**:
```ts
{
  data: {
    items: [
      {
        id: string,           // event.id OR synthetic "te-{date}-{user}-{project}" for derived time-logged
        type: string,         // "account.created" | ... | "time_entry.logged" (derived)
        payload: object,      // event payload OR derived { user_id, user_email, project_id, project_name, minutes_sum }
        created_at: string,
      }
    ],
    next_page: number | null
  }
}
```

**Implementation** (~80 LOC):
1. Compute `project_ids = SELECT id FROM projects WHERE account_id = id` (cached for this request).
2. Fetch events: `SELECT * FROM events WHERE tenant_id AND (entity_id = account.id OR entity_id IN (project_ids) OR (entity_type IN ('contact','lead') AND payload->>account_id = account.id))` — order desc, limit 100 (overfetch to allow merging).
3. Fetch derived time-logged stream: `SELECT user_id, entry_date, project_id, SUM(minutes) AS minutes_sum, MAX(created_at) AS created_at FROM time_entries WHERE project_id IN (project_ids) GROUP BY user_id, entry_date, project_id ORDER BY MAX(created_at) DESC LIMIT 100`. Wrap each row as a synthetic activity item with type `time_entry.logged`.
4. **Merge** the two streams sorted by `created_at desc`.
5. **Paginate** the merged result: skip `(page - 1) * limit`, take `limit`. Return `next_page = page + 1` if more remain, else null.
6. Email + name lookups: for each unique user_id in the page, fetch via `scopedClient.raw().auth.admin.listUsers()` once (one round trip), then attach `user_email` to payloads.
7. For counselor: filter events to `entity_id` owned by counselor OR `payload->>user_id = auth.userId`. Filter derived stream to `user_id = auth.userId`.

**Performance note for Sonnet**: this is the heaviest of the 3 endpoints. If queries get slow on high-traffic accounts, the obvious wins are (a) cache project_ids in memory for the request, (b) add an index on `events(tenant_id, entity_id, created_at desc)` if not already there. Don't add the index in this brief — measure first.

### 4. 5 `emitEvent()` additions on existing routes

Small additions; each is 1-3 lines:

| Route | Event type | Payload | Why |
|---|---|---|---|
| `PATCH /api/v1/accounts/[id]` (after successful UPDATE) | `account.updated` | `{ changed_fields: string[], old: {...}, new: {...} }` | Notes/owner/active/primary_contact flips show in Activity feed. |
| `PATCH /api/v1/projects/[id]` (after successful UPDATE) | `project.updated` | `{ changed_fields: string[], old, new, account_id }` | Project status changes show in Activity. account_id in payload so Activity query can scope. |
| `POST /api/v1/time-entries/[id]/approve` (after successful UPDATE) | `time_entry.approved` | `{ user_id, project_id, minutes, account_id, rate_snapshot }` | Approval visible in Activity. account_id derived from project. |
| `POST /api/v1/time-entries/[id]/reject` (after successful UPDATE) | `time_entry.rejected` | `{ user_id, project_id, minutes, account_id, rejection_reason }` | Same as approve. |
| `POST /api/v1/leads/[id]/convert` (after successful UPDATE) | `lead.converted` | `{ lead_id, contact_id, account_id }` | "Lead → Contact at this account" entry. |

Each emit uses the existing `emitEvent()` from `src/lib/api/audit.ts`. Mirror the existing pattern: `await emitEvent({ tenantId: auth.tenantId, type: "account.updated", entityType: "account", entityId: id, requestId, payload: {...} })`.

---

## Files to touch

| File | Change | LOC est. |
|---|---|---|
| `src/app/(main)/api/v1/accounts/[id]/billable-summary/route.ts` | **New** | ~110 |
| `src/app/(main)/api/v1/accounts/[id]/team/route.ts` | **New** | ~150 |
| `src/app/(main)/api/v1/accounts/[id]/activity/route.ts` | **New** | ~180 |
| `src/app/(main)/api/v1/accounts/[id]/route.ts` (PATCH) | **Extend** — add `emitEvent` after UPDATE | +10 |
| `src/app/(main)/api/v1/projects/[id]/route.ts` (PATCH) | **Extend** — add `emitEvent` after UPDATE | +10 |
| `src/app/(main)/api/v1/time-entries/[id]/approve/route.ts` (POST) | **Extend** — add `emitEvent` | +8 |
| `src/app/(main)/api/v1/time-entries/[id]/reject/route.ts` (POST) | **Extend** — add `emitEvent` | +8 |
| `src/app/(main)/api/v1/leads/[id]/convert/route.ts` (POST) | **Extend** — add `emitEvent` | +8 |
| `src/industries/it-agency/features/accounts/pages/account-detail.tsx` | **Extend** — add 3 parallel fetches (billable + team + activity-first-page); pass to subcomponents | +50 |
| `src/industries/it-agency/features/accounts/components/account-detail/account-key-info-section.tsx` | **Extend** — add 3 billable rows + delta logic + counselor hint | +80 |
| `src/industries/it-agency/features/accounts/components/account-detail/account-related-panel.tsx` | **Extend** — slot AccountTeamCard between Health and OpenLeads | +5 |
| `src/industries/it-agency/features/accounts/components/account-detail/account-team-card.tsx` | **New** | ~180 |
| `src/industries/it-agency/features/accounts/components/account-detail/account-tabs.tsx` | **Extend** — wire Activity panel, drop disabled state | +20 |
| `src/industries/it-agency/features/accounts/components/account-detail/activity-tab.tsx` | **New** | ~250 |
| `src/industries/it-agency/features/accounts/components/account-detail/activity-row.tsx` | **New** — single activity row with icon switch + text + timestamp | ~120 |
| `src/industries/it-agency/features/accounts/components/account-detail/index.ts` | **Extend** — add new exports | +3 |
| `src/lib/format-billable-delta.ts` | **New** — small util to format the `▲ +12% / ▼ -8% / — 0% / New` delta pill | ~50 |
| `src/lib/format-relative-time.ts` | **New** (only if not already present — check first) — small util for "2h ago", "3d ago", "last month" rendering on activity rows | ~40 |

**Total: ~18 files (8 new + 9 extends + 1 conditional new). ~1,250 LOC net.** Heavier than v1 because of the 3 distinct backend endpoints + the Activity feed complexity. The 5 emitEvent additions are tiny but enable the entire Activity feed to function.

---

## Patterns to reuse (from existing code)

- **3-column shell + tab strip**: unchanged from v1. `AccountTabs` just gets the Activity panel wired.
- **`scopedClient.raw().auth.admin.*`**: precedent set by v1's `owner_email` + Contact 360's `account_owner_email`. Same escape hatch for `auth.users` lookups in `/team` + `/activity` endpoints.
- **`/api/v1/time-entries/summary`** (`src/app/(main)/api/v1/time-entries/summary/route.ts`): **reference for the counselor-scoping pattern** on `/billable-summary` (lines 68-76 show the `requireAdmin` + `eq("user_id", auth.userId)` shape). Don't reuse the endpoint itself — it returns all accounts; we want per-account.
- **`emitEvent()`**: `src/lib/api/audit.ts`. Mirror existing call sites — e.g. `/api/v1/accounts/[id]:204` for `account.deleted` shows the exact pattern.
- **`Promise.all` parallel fetches in page useEffect**: v1's `account-detail.tsx:82-102` is the reference for adding the 3 new fetches.
- **Card chrome**: `border border-border bg-card rounded-lg shadow-none p-3 space-y-3` — same as `HealthSnapshotCard`. Apply to `AccountTeamCard`.
- **Role pills**: same shape as Active/Inactive pill on `AccountSummaryCard` (`text-xs font-medium px-2 py-0.5 rounded-full`). New color tokens per role: Account Manager `bg-purple-50 text-purple-700`, Project Lead `bg-blue-50 text-blue-700`, Contributor `bg-gray-100 text-gray-600`.
- **Empty states**: `text-sm text-muted-foreground` plain text, no icon. Mirror current ContactsTab + ProjectsTab patterns.
- **`PROJECT_STATUS_MAP`**: shared from `time-tracking/status-badge` (exported in v1 fixback). For Activity feed row that says "Project X → Active", use `PROJECT_STATUS_MAP[new_status].label` for consistency.
- **Avatar initials helper**: ContactsTab has `getInitials(first, last)` — extract to a shared util OR duplicate (both fine; the duplication is trivial). For team members where we only have `email`, derive initials as `email.split('@')[0].slice(0, 2).toUpperCase()`.
- **Design tokens**: primary text `#0f0f10`, secondary `#787871`, dropdown hover `#0000170b`, status pills bg-green-50/700 + bg-gray-100/500, rounded-lg buttons.

---

## Verification

Before merging:

- [ ] `npm run build` clean locally.
- [ ] `npx eslint --max-warnings 50 .` clean locally (must stay at 17 baseline).
- [ ] **Billable totals**:
  - 3 new KEY INFO rows render: Billable this month + Billable hrs this month + Lifetime billable.
  - Delta pill renders correctly: ▲ green when positive, ▼ red when negative, — gray when equal, "New" pill when last month was zero AND this month >0, no delta when both zero.
  - Counselor mode: hint "(your hours only)" appears under the rows.
  - Verify by curling the new endpoint on a real account and spot-checking math against time_entries query.
- [ ] **Account Team card**:
  - Renders between HealthSnapshotCard and OpenLeadsCard.
  - Header shows `Team (N)`.
  - Owners group: account owner is always #1, project owners follow sorted by hrs desc.
  - Contributors group: only renders when there are any; sorted by hrs desc.
  - Inactive contributors (>14d, ≤90d) show "Active last Nd ago" tag.
  - Contributors >90d are filtered out (don't appear at all).
  - Counselor mode: card shows full team (NOT scoped to counselor's own hours per the override in the brief).
  - Role pills render with correct colors (purple/blue/gray).
- [ ] **Activity tab**:
  - Tab trigger now wired (no longer disabled, no "Coming soon" tooltip).
  - First page loads 30 items max.
  - "Load more" button appears when next_page is non-null; clicking loads next page in place.
  - Empty state renders when no events + no time entries.
  - Time entries are correctly aggregated by user+day+project (one row per group, not per entry — test by logging multiple time entries the same day on the same project and confirming only one row appears).
  - Icons render correctly per event type.
  - Relative timestamps render: "2h ago", "3d ago", "last month".
  - Counselor scoping works: counselor sees only their own entity events + own time-logged entries.
- [ ] **`emitEvent` additions**:
  - PATCH `/api/v1/accounts/[id]` writes an `account.updated` event with `changed_fields` array.
  - PATCH `/api/v1/projects/[id]` writes a `project.updated` event with `changed_fields` + `account_id`.
  - Approve/reject time entry routes write `time_entry.approved` / `.rejected` events.
  - Convert lead route writes `lead.converted` event.
  - Verify by triggering each mutation, then `SELECT * FROM events ORDER BY created_at DESC LIMIT 5` in Supabase.
- [ ] **Non-IT-agency tenants**: `/accounts/[id]/{billable-summary,team,activity}` all return 403 (industry-gated via `getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)`).
- [ ] **All 7 code-review checklist items** considered:
  - **PostgREST embed FK disambiguation** — RELEVANT for `/team` endpoint joining time_entries → projects → accounts. Use explicit FK names if doing PostgREST embeds; otherwise flat queries with explicit `.eq("account_id", ...)` chains avoid the issue.
  - **PATCH preserves POST invariants** — N/A (no PATCH changes).
  - **Route shell for new pages** — N/A (no new page routes; the 3 new endpoints don't have UI page shells).
  - **`.select()` after insert/update** — N/A.
  - **Radix Select empty-string sentinel** — N/A.
  - **Cross-cutting predicate audits** — RELEVANT. The Activity feed queries events scoped to account_id (via direct event entity_id match OR via project_ids subquery OR via payload->>account_id JSON path). Grep `from("events")` to confirm no other query in the codebase needs the same filter logic — at time of brief, only `/api/v1/leads/[id]/activities` and (now) this `/activity` endpoint touch events. Both stay self-contained.
  - **Page-padding stacks with shell** — N/A (no page wrapper changes).

---

## Sonnet handoff prompt

Paste the block below to a fresh Sonnet session.

```
You're implementing v2 of the Account 360 detail page on a feature branch. Read /Users/sadinshrestha/Projects/edgeXcrm/docs/ACCOUNT-DETAIL-360-V2-BRIEF.md end-to-end before touching any code — it closes 3 explicit deferrals from the v1 brief: billable totals in KEY INFO, Account Team card in the right column, and Activity tab content. The brief has the full scope, file list, exact patterns to mirror, CRM-expert-informed design framing (quoted verbatim), and verification checklist.

Workflow:
1. From the repo root, fetch latest stage and branch off it:
   git fetch origin && git checkout -b feat/account-detail-360-v2 origin/stage
2. Implement the ~18 file changes per the brief:
   - 3 new API endpoints under src/app/(main)/api/v1/accounts/[id]/{billable-summary,team,activity}/route.ts
   - 5 small emitEvent() additions on existing PATCH/approve/reject/convert routes (account, project, time-entries approve, time-entries reject, leads convert)
   - 9 frontend extensions/new files: account-detail.tsx page extends to add 3 parallel fetches; AccountKeyInfoSection gains 3 billable rows; AccountRelatedPanel slots in AccountTeamCard between Health and OpenLeads; AccountTabs wires the Activity panel; 3 new components (AccountTeamCard, ActivityTab, ActivityRow); barrel export; 1-2 small utils (format-billable-delta, format-relative-time — check if relative-time helper already exists before writing a new one)
3. Verify locally before pushing:
   - npm run build  (clean)
   - npx eslint --max-warnings 50 .  (clean — CI hard gate; local build does NOT run ESLint)
4. Self-check against the verification checklist at the bottom of the brief.
5. Commit with a clear message and push the branch. Don't merge; Opus reviews and squash-merges to stage.

Important constraints from the brief:
- This is a UI + API additions brief. NO database migrations. NO denormalization of time_entries.account_id (we JOIN through projects).
- The Activity feed is a UNION of (a) events table rows scoped to this account and (b) a DERIVED time-logged stream that aggregates time_entries by (user_id, entry_date, project_id) summing minutes. Critical: ONE feed row per aggregated group, NOT one row per time entry. Brief explains why (CRM-expert pushback: ungrouped is unreadable noise).
- Do NOT show derived time_entry.created events from the events table — they're redundant with the aggregated time-logged stream. The derived stream is the spine; events table fills in everything ELSE.
- Counselor scoping: billable totals + activity feed both scope to counselor's own data (existing pattern). Account Team card does NOT scope (team identity is shared info — explicit override in the brief).
- Active contributors filter: time logged in last 90 days. Owners (account owner + project owners) always stay regardless of activity recency.
- Role labels: "Account Manager" (account owner), "Project Lead" (project owners), "Contributor" (time loggers without ownership). DO NOT use job titles like "Engineer"/"Designer" — those live on user profiles.
- Billable delta vs last month is a small ▲/▼ pill next to the dollar value, NOT a separate row. New pill renders "New" when last month was $0 and this month is >$0 (avoid divide-by-zero math).
- Skip the sparkline / trend chart. Skip the supplemental "billed this month" line on the Overview Projects card (CRM expert said: duplication = noise).
- DO add the 5 emitEvent() calls per the brief. Each is 1-3 lines. They enable the Activity feed to show account/project/time-entry/lead-convert changes; without them the feed only shows .created events and the derived time-logged stream.
- Activity feed pagination: 30 per page, "Load more" button at bottom. Page param 1-indexed.

If anything in the brief is ambiguous or you find a real issue with the approach, surface it in the handoff back to Opus rather than guessing. Especially: if the email lookup in /team or /activity is slow with auth.admin.listUsers, consider chunking by 100 user IDs or batching — but note the constraint in the handoff so Opus can validate the approach.
```
