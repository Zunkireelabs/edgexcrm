# Nav: surface Time Approvals + introduce role-gated sidebar items

**Owner**: Opus (plan + review) → Sonnet (implement)
**Branch**: `feature/nav-approvals-link`
**Base**: `stage` (currently `c042e22` + 1 docs commit on top)
**Scope**: IT agency only. Education consultancy gets a separate pass later today.

## Why

`/time-tracking/approvals` is a built, shipped, production-deployed admin page (approving / rejecting team time entries). Today it has **no sidebar nav entry** — the only way to reach it is by clicking a stats card inside `/time-tracking` (`timesheet-stats-cards.tsx:44`). Admins keep missing it. Add it to the IT agency sidebar.

While we're touching the manifest, do the small type-system change to support **role-gated sidebar items** so this and future role-scoped features (counselor-only views, owner-only billing, etc.) get a proper rail instead of inline `if (role !== ...)` hacks in `shell.tsx`.

## What changes

### 1. Extend `SidebarItem` type with optional role filter

**File**: `src/industries/_types.ts`

Add an optional `minRoles` field to `SidebarItem`:

```ts
export interface SidebarItem {
  featureId: string;
  href: string;
  label: string;
  icon: string;
  /**
   * If present, only show this sidebar item to users whose role is in
   * the list. Mirrors role gates already enforced at the API / page
   * level — this just hides the nav entry. Absent = visible to all
   * roles in the tenant.
   */
  minRoles?: readonly ("owner" | "admin" | "viewer" | "counselor")[];
}
```

Name it `minRoles` (plural) rather than `minRole` because role hierarchy isn't strictly linear in this codebase (counselor isn't "less than" viewer in any meaningful way — they're orthogonal). Explicit list of allowed roles is clearer than a min/max ordering.

### 2. Filter sidebar items by role in the loader

**File**: `src/industries/_loader.ts`

Update `getIndustrySidebarItems` to accept the user's role and apply the filter:

```ts
export function getIndustrySidebarItems(
  industryId: string | null | undefined,
  role?: string,
): readonly SidebarItem[] {
  const m = getManifest(industryId);
  const registeredFeatureIds = new Set(m.features.map((f) => f.meta.id));
  return m.sidebar.filter((item) => {
    if (!registeredFeatureIds.has(item.featureId)) return false;
    if (item.minRoles && (!role || !item.minRoles.includes(role as never))) return false;
    return true;
  });
}
```

Role param is optional so existing callers without role context don't break — they just see unfiltered nav. Update the JSDoc to reflect the new behavior.

### 3. Pass role through from the dashboard layout

**File**: `src/app/(main)/(dashboard)/layout.tsx`

Line 36 today:
```ts
const industrySidebarItems = getIndustrySidebarItems(tenantData.tenant.industry_id);
```

Change to:
```ts
const industrySidebarItems = getIndustrySidebarItems(tenantData.tenant.industry_id, tenantData.role);
```

That's the only consumer that needs updating.

### 4. Register the approvals sidebar entry in the IT agency manifest

**File**: `src/industries/it-agency/manifest.ts`

Insert a new sidebar entry **immediately after** the existing Time Tracking entry, so the visual order is Time Tracking → Approvals:

```ts
{
  featureId: FEATURES.TIME_TRACKING,
  href: "/time-tracking",
  label: "Time Tracking",
  icon: "Clock",
},
{
  featureId: FEATURES.TIME_TRACKING,  // shares the feature gate with Time Tracking
  href: "/time-tracking/approvals",
  label: "Approvals",
  icon: "Stamp",
  minRoles: ["owner", "admin"],
},
```

Note: both items reuse `FEATURES.TIME_TRACKING` as their `featureId`. The industry gate is feature-level, not route-level — sub-pages of a feature don't need their own feature ID. The role gate handles the admin-only narrowing.

### 5. Register the `Stamp` icon in the shell

**File**: `src/components/dashboard/shell.tsx`

- Add `Stamp` to the `lucide-react` imports (alphabetize: between `Sparkles` and `Tabs`-related, wherever fits cleanly).
- Add `Stamp` to the `INDUSTRY_ICONS` registry object.

That's it. No other file touches.

## What NOT to do

- **Don't** turn `/time-tracking` into a tabbed page with My Timesheet / Team Approvals tabs. That's a separate restructure conversation; out of scope here.
- **Don't** add an expandable Time Tracking group with Approvals as a sub-item. We want a flat sidebar — keeping it consistent with the rest of the manifest pattern. The Public Forms expander is the only special case and stays the only special case.
- **Don't** touch the route shell at `src/app/(main)/(dashboard)/time-tracking/approvals/page.tsx` — it already has the right industry + auth gates. The page-level role enforcement that exists today (or doesn't — verify) is the source of truth; we're only adding a UI gate so non-admins don't see the link.
- **Don't** touch the education consultancy manifest. Separate pass after this one.
- **Don't** change the visual ordering of the IT agency sidebar except for inserting Approvals after Time Tracking.
- **Don't** add comments narrating the change ("// new approvals link" etc). The diff speaks for itself.

## Page-level role gate — VERIFY DURING IMPLEMENTATION

The approvals page route shell at `src/app/(main)/(dashboard)/time-tracking/approvals/page.tsx` currently only gates on `industry_id` (`getFeatureAccess(... TIME_TRACKING)`). It passes `tenantData.role` through to `<ApprovalsQueuePage>` but does NOT 404 non-admins at the shell.

**Action during implementation**: open the page and confirm whether `<ApprovalsQueuePage>` itself enforces role inside the component (e.g., shows an empty/forbidden state for non-admin roles), or whether non-admins can currently see other people's pending entries.

- If the component already gates → fine, our UI gate just hides the link.
- If the component does NOT gate → ADD a route-shell role check in the same edit:
  ```ts
  if (tenantData.role !== "owner" && tenantData.role !== "admin") notFound();
  ```
  Mirrors the pattern used in `src/app/(main)/(dashboard)/projects/page.tsx:13` (`if (!isAdmin) notFound();`).

This is a defensive belt-and-suspenders check. The sidebar hiding is UI-only — anyone with the URL would still hit the page if route-shell or API role checks are missing.

## Verification matrix

Local, before pushing:

- [ ] `npm run build` clean
- [ ] `npx eslint --max-warnings 50 .` clean
- [ ] TypeScript: `minRoles` field accepts the role string literals correctly
- [ ] As `admin@zunkireelabs.com` (IT agency, owner) on dev: **Approvals** appears in the sidebar between Time Tracking and Pipeline. Click navigates to `/time-tracking/approvals` and the page renders.
- [ ] As a non-admin IT agency user (create one quickly if needed, or test in incognito with role manually overridden): Approvals does NOT appear in the sidebar. Direct URL navigation behavior matches the answer from the page-level verification step above (either renders empty / forbidden state, OR 404s if you added the route-shell gate).
- [ ] As `admizzdotcom2020@gmail.com` (education consultancy, owner) on dev: sidebar is unchanged from today (no Approvals item — education_consultancy doesn't have `time-tracking` registered).
- [ ] Public Forms section in the sidebar still works (the expander pattern wasn't disturbed).
- [ ] Mobile Sheet sidebar shows the same items as desktop.

## Code-review checklist (the 6 standing items)

All N/A — no DB changes, no new API routes, no PostgREST embeds, no new POST/PATCH, no new `<SelectItem>`. The only cross-cutting change is the manifest type extension, which is type-safe-by-construction.

## Handoff format

Sonnet pushes the branch when done and stops. Opus fetches, reviews the diff, runs build + eslint, reads the role-gate verification answer, squash-merges to stage, deletes the branch from origin, updates SESSION-LOG.

Stage auto-deploys to `dev-lead-crm.zunkireelabs.com`. After Sadin smokes there, Opus runs the prod promotion (non-FF ort merge stage → main) on Sadin's explicit go-ahead.
