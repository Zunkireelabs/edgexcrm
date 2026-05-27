# Sonnet handoff — Promote Accounts to a top-level CRM entity

> One-shot brief. Self-contained — you don't see the conversation that produced it. Read CLAUDE.md first (Industry Scoping Rules, Tenant Isolation Rules), then this. Workflow: Opus plans + reviews + pushes to stage. You execute on a feature branch and push it. Opus reviews, smokes, merges. **Do not push to stage.**

## Why this work exists

Today, the **Accounts** entity (B2B customers — agencies, employers, the orgs we bill against) lives under `/time-tracking/accounts/*` and is gated by `FEATURES.TIME_TRACKING`. That framing is wrong. In every B2B CRM (Salesforce, HubSpot, Pipedrive, Zoho) Accounts is a **top-level CRM entity**, not a sub-feature of timesheets. The URL was a tell.

This refactor promotes Accounts to the sidebar as its own top-level item (it-agency only, since other industries don't model B2B accounts yet), with `/accounts/*` URLs and a separate `FEATURES.ACCOUNTS` constant. Time Tracking continues to own Projects/Tasks/Time Entries — it just no longer owns Accounts.

A previous attempt (`feature/time-tracking-nav-tabs` @ `96fcaae`, since deleted) added tabs under Time Tracking. That branch was discarded — the framing was the issue, not the implementation. You're not redoing tabs; you're moving Accounts out.

## Scope and non-scope

**In scope:**
- Move 6 files (preserve git history).
- New `meta.ts` for the accounts feature.
- New `FEATURES.ACCOUNTS = "accounts"` constant.
- Register accounts feature + sidebar entry in the it-agency manifest.
- Register `Building2` icon in `INDUSTRY_ICONS`.
- Re-gate 7 API routes (accounts/projects/tasks) from `FEATURES.TIME_TRACKING` → `FEATURES.ACCOUNTS`.
- Rewrite hardcoded `/time-tracking/accounts*` → `/accounts*` links in 3 page files (one of which stays put).
- Update one cross-feature import that arises from the move.

**Explicitly NOT in scope:**
- `/time-tracking/projects/[id]/page.tsx` — **stays put.** Nesting projects under accounts in the URL is a future refactor that needs account_id propagation; not now.
- `/time-tracking/approvals` — **stays put.** Reachable via the "Pending" stat tile on the timesheet (already wired).
- `/time-tracking/page.tsx` (timesheet) — **no nav changes.**
- `time_entries` API routes (`/api/v1/time-entries/*` including approve/reject) — **stay gated by `FEATURES.TIME_TRACKING`**. Time entries are a time-tracking concept, not an accounts concept.
- `status-badge.tsx`, `task-row.tsx`, the timesheet components, the `time-tracking` hooks, `project-detail.tsx` (the page) — **stay in `features/time-tracking/`**.
- `shell.tsx` beyond the one-line `Building2` registration.
- Universal sidebar items (Dashboard, Leads, Pipeline, Team, Settings) — untouched.

## Branch

```
git checkout stage
git pull --ff-only origin stage
git checkout -b feature/promote-accounts
```

If `git pull` is not a fast-forward, stop and report — stage has moved in a way that needs review.

## Step 1 — Move 6 files with `git mv` (preserve history)

```
git mv "src/app/(main)/(dashboard)/time-tracking/accounts/page.tsx" \
       "src/app/(main)/(dashboard)/accounts/page.tsx"

git mv "src/app/(main)/(dashboard)/time-tracking/accounts/[id]/page.tsx" \
       "src/app/(main)/(dashboard)/accounts/[id]/page.tsx"

git mv src/industries/it-agency/features/time-tracking/pages/accounts-list.tsx \
       src/industries/it-agency/features/accounts/pages/accounts-list.tsx

git mv src/industries/it-agency/features/time-tracking/pages/account-detail.tsx \
       src/industries/it-agency/features/accounts/pages/account-detail.tsx

git mv src/industries/it-agency/features/time-tracking/components/account-form.tsx \
       src/industries/it-agency/features/accounts/components/account-form.tsx

git mv src/industries/it-agency/features/time-tracking/components/project-form.tsx \
       src/industries/it-agency/features/accounts/components/project-form.tsx
```

`git mv` will create the new directories as needed. After this, the old `time-tracking/accounts/` route folder will be empty — git tracks empty dirs as absent, so nothing more to do there.

## Step 2 — Create `meta.ts` for the new feature

New file: `src/industries/it-agency/features/accounts/meta.ts`

```ts
import { FEATURES, INDUSTRIES } from "../../../_registry";
import type { FeatureMeta } from "../../../_types";

export const accountsMeta: FeatureMeta = {
  id: FEATURES.ACCOUNTS,
  industries: [INDUSTRIES.IT_AGENCY],
};
```

Mirror the shape of `src/industries/it-agency/features/time-tracking/meta.ts`.

## Step 3 — Register `FEATURES.ACCOUNTS`

Edit `src/industries/_registry.ts`. Add to the `FEATURES` const, in the `// Industry-scoped (it_agency)` section, after `TIME_TRACKING`:

```ts
  // Industry-scoped (it_agency)
  TIME_TRACKING: "time-tracking",
  ACCOUNTS: "accounts",
```

## Step 4 — Register accounts feature + sidebar in the it-agency manifest

Edit `src/industries/it-agency/manifest.ts`:

1. Add import: `import { accountsMeta } from "./features/accounts/meta";`
2. Add `{ meta: accountsMeta }` to the `features` array.
3. Add a sidebar entry **above** the Time Tracking entry (Accounts comes first conceptually — it's the parent entity):

```ts
{
  featureId: FEATURES.ACCOUNTS,
  href: "/accounts",
  label: "Accounts",
  icon: "Building2",
},
```

Final sidebar order: `Accounts`, then `Time Tracking`.

## Step 5 — Register `Building2` in `INDUSTRY_ICONS`

Edit `src/components/dashboard/shell.tsx`:

1. Add `Building2` to the lucide-react import (alphabetize within the import block — current block has `LayoutDashboard, Users, Settings, ... Clock, ChevronDown ...`; insert `Building2` near the top).
2. Add `Building2` to the `INDUSTRY_ICONS` record (preserve the existing order — append at the bottom is fine, or insert alphabetically if you prefer).

That's the only change to `shell.tsx`. Do not touch anything else in this file.

## Step 6 — Re-gate the 7 API routes from `FEATURES.TIME_TRACKING` → `FEATURES.ACCOUNTS`

For each route below, replace **every** `FEATURES.TIME_TRACKING` with `FEATURES.ACCOUNTS` in the `getFeatureAccess(auth.industryId, ...)` call sites:

1. `src/app/(main)/api/v1/accounts/route.ts` (2 occurrences — GET + POST)
2. `src/app/(main)/api/v1/accounts/[id]/route.ts` (3 occurrences — GET + PATCH + DELETE)
3. `src/app/(main)/api/v1/accounts/[id]/leads/route.ts` (1 occurrence)
4. `src/app/(main)/api/v1/projects/route.ts` (2 occurrences — GET + POST)
5. `src/app/(main)/api/v1/projects/[id]/route.ts` (3 occurrences — GET + PATCH + DELETE)
6. `src/app/(main)/api/v1/projects/[id]/tasks/route.ts` (2 occurrences — GET + POST)
7. `src/app/(main)/api/v1/tasks/[id]/route.ts` (3 occurrences — GET + PATCH + DELETE)

`FEATURES.TIME_TRACKING` only stays in time-entry routes — leave those alone:
- `/api/v1/time-entries/route.ts`
- `/api/v1/time-entries/[id]/route.ts`
- `/api/v1/time-entries/[id]/approve/route.ts`
- `/api/v1/time-entries/[id]/reject/route.ts`

`grep -rn "FEATURES.TIME_TRACKING" src/app/(main)/api/v1/` after your edits should show **only** the 4 time-entry routes.

## Step 7 — Update import paths in the two moved page shells

The two app-route pages (`src/app/(main)/(dashboard)/accounts/page.tsx` and `.../accounts/[id]/page.tsx`) currently import from `@/industries/it-agency/features/time-tracking/pages/...`. After the move:

- `accounts/page.tsx`: import `AccountsListPage` from `@/industries/it-agency/features/accounts/pages/accounts-list`.
- `accounts/[id]/page.tsx`: import `AccountDetailPage` from `@/industries/it-agency/features/accounts/pages/account-detail`.

Also change `FEATURES.TIME_TRACKING` → `FEATURES.ACCOUNTS` in both shells' `getFeatureAccess()` calls.

## Step 8 — Cross-feature import in `account-detail.tsx`

The moved `account-detail.tsx` imports `ProjectStatusBadge` from `../components/status-badge`. After the move, `status-badge.tsx` is still at `features/time-tracking/components/status-badge.tsx` (it's also consumed by 4 other time-tracking files; it stays there).

Update the import in the moved `src/industries/it-agency/features/accounts/pages/account-detail.tsx`:

```ts
// Before
import { ProjectStatusBadge } from "../components/status-badge";
// After
import { ProjectStatusBadge } from "../../time-tracking/components/status-badge";
```

This cross-feature import is intentional. It telegraphs that the badge is a shared visual primitive used across both features; promoting it to `_shared/` or `@/components/` is a future cleanup, not for this branch.

The other moved pages/components have no relative imports that cross feature boundaries — verify with `grep -n '"\.\./' src/industries/it-agency/features/accounts/{pages,components}/*.tsx` after the move.

## Step 9 — Cross-feature import in `project-detail.tsx` (stays in time-tracking)

`src/industries/it-agency/features/time-tracking/pages/project-detail.tsx` stays put but imports `ProjectForm` from `../components/project-form`, which has moved. Update:

```ts
// Before
import { ProjectForm } from "../components/project-form";
// After
import { ProjectForm } from "../../accounts/components/project-form";
```

Same architectural note as Step 8: a cross-feature import is the right signal here — `project-detail.tsx` is a candidate to move into the accounts module later. For now it stays.

## Step 10 — Rewrite hardcoded `/time-tracking/accounts*` links

Three files, 5 link occurrences total. After your moves they live at:

- `src/industries/it-agency/features/accounts/pages/accounts-list.tsx` (1)
  ```diff
  - href={`/time-tracking/accounts/${account.id}`}
  + href={`/accounts/${account.id}`}
  ```
- `src/industries/it-agency/features/accounts/pages/account-detail.tsx` (2)
  ```diff
  - router.push("/time-tracking/accounts");
  + router.push("/accounts");
  ```
  ```diff
  - <Link href="/time-tracking/accounts">
  + <Link href="/accounts">
  ```
- `src/industries/it-agency/features/time-tracking/pages/project-detail.tsx` (2) — stays in time-tracking but its breadcrumb/back-link points to Accounts
  ```diff
  - router.push("/time-tracking/accounts");
  + router.push("/accounts");
  ```
  ```diff
  - <Link href="/time-tracking/accounts">
  + <Link href="/accounts">
  ```

Sanity check after edits: `grep -rn "/time-tracking/accounts" src/` should return **zero** results.

## Step 11 — Update `docs/FEATURE-CATALOG.md`

Add (or modify) a row for the Accounts feature. Pattern off the existing `TIME_TRACKING` row. Owner: it-agency. Industries: it_agency. Location: `src/industries/it-agency/features/accounts/`.

## Verification

Run, in order:

1. `npm run build` — clean. 50 pages compile, no errors.
2. `npm run lint` — 0 errors. (11 pre-existing warnings on stage today; don't introduce new ones.)
3. `grep -rn "/time-tracking/accounts" src/` — empty.
4. `grep -rn "FEATURES.TIME_TRACKING" src/app/(main)/api/v1/` — only the 4 time-entry routes.
5. `grep -rn "features/time-tracking/pages/accounts-list\|features/time-tracking/pages/account-detail\|features/time-tracking/components/account-form\|features/time-tracking/components/project-form" src/` — empty.

Manual UI (start dev server, log in as each tenant):

**As Zunkireelabs admin (it_agency, admin@zunkireelabs.com / admin123):**
- [ ] Sidebar shows **Accounts** with `Building2` icon, above **Time Tracking**.
- [ ] `/accounts` loads — accounts list renders, Create button works.
- [ ] `/accounts/<id>` loads — account detail renders, projects list shows, inline project create works.
- [ ] `/time-tracking/accounts` returns **404**.
- [ ] `/time-tracking/accounts/<id>` returns **404**.
- [ ] `/time-tracking` (timesheet) still works unchanged.
- [ ] `/time-tracking/projects/<id>` still works; its "back to Accounts" link goes to `/accounts` (not `/time-tracking/accounts`).
- [ ] `/time-tracking/approvals` still works.

**As an Admizz user (education_consultancy, any user):**
- [ ] No **Accounts** item in sidebar.
- [ ] `/accounts` returns **404**.
- [ ] `curl` (or fetch) to `/api/v1/accounts` returns **403** with `FORBIDDEN`.

## Reporting back

Report in this shape, mirroring previous handoffs:

```
Branch: feature/promote-accounts
Commit(s): <sha> <one-line message>
Build: <clean | errors with detail>
Lint: <0 errors, N warnings — all from pre-existing files>
Files moved: 6 (verified via git log --follow)
New file: meta.ts
Edits: _registry.ts, it-agency/manifest.ts, shell.tsx, 7 API routes, 3 page files (link rewrites), 2 page shells, FEATURE-CATALOG.md
Cross-feature imports introduced: 2 (documented in steps 8 + 9)
Verification: <pass/fail for each numbered check above>
Deviations / judgment calls: <none, or list>
```

Do NOT push to stage. Push only `feature/promote-accounts` to origin.

## Pitfalls that have bit us on this codebase

- **Don't `git reset --hard` to origin without first checking your local branch isn't ahead.** A prior session orphaned a Sonnet commit this way — recoverable, but a scare.
- **Icon names in manifests are strings, not `LucideIcon` imports.** The manifest crosses the Server Component → Client Component boundary; passing the component crashes the dashboard.
- **`scopedClient.update()` / `.delete()` must always include a caller-supplied filter** (e.g. `.eq("id", ...)`) — the auto-injected `tenant_id` alone would target every row in the tenant. You're not adding new queries here, but keep an eye out if you touch any.
