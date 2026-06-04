# Positions / Permission Profiles — Phase 4 Brief (Sidebar + Page Guards + Dashboard + SSR cleanup)

> Full design: `~/.claude/plans/today-lets-work-on-robust-platypus.md`. Phases 1 (`c71269b`), 2 (`a2a9534`), 3 (`feat/positions-phase3`, in local review) SHIPPED/landing. This brief is self-contained for **Phase 4 — the final phase**. It makes the **UI reflect** the position (sidebar, pages, dashboard) and closes the remaining **SSR read-path** holes. After Phase 4 the feature is complete.

## Recap — what's already enforced vs what's missing

- **Enforced (Phase 2/3, API layer):** `GET /api/v1/{leads,pipelines,team,knowledge-bases}` honor `canSeeNav`; leads/pipelines filtered by `leadScope` + `pipelineAccess`; `requireLeadAccess` honors `canEditLeads`. Positions are creatable/assignable (Phase 3).
- **Missing (Phase 4):**
  1. **Sidebar** still shows every nav item regardless of the position's `nav` allow-list (the gap you saw with hardik — Team/Settings/Forms visible though his Counsellor position excludes them).
  2. **Page routes** for disallowed modules still render (the `/team` *page* frame loads even though `/api/v1/team` 403s).
  3. **Dashboard** doesn't filter widgets by the position's `dashboard.widgets`.
  4. **SSR read helpers** (`src/lib/supabase/queries.ts` `getLeads`/`getLead`/`getLeadsForPipeline`) still scope by `role === "counselor"` and **ignore pipeline access** — so server-rendered pages (dashboard, /leads, /pipeline) can show leads from disallowed pipelines before any API call. This is the last real data hole.

## Locked decisions (carried from earlier phases)

- **Nav keys are route hrefs everywhere** — universal (`/dashboard`, `/leads`, `/pipeline`, `/team`, `/settings`, `/knowledge-bases`) and industry (`/contacts`, `/check-in`, `/forms`). `canSeeNav(permissions, href)` is the single check. `/dashboard` is never gated (it's the redirect fallback).
- `getCurrentUserTenant()` already returns `permissions: ResolvedPermissions` (Phase 1). Every page/layout uses it.
- owner/admin resolve to full access (`allowedNavKeys: null`, etc.), so all gates are automatically open for them.

---

## Part A — SSR scope helper (add to `src/lib/api/permissions.ts`)

One helper so every SSR caller derives its lead scope identically:
```ts
export interface LeadQueryScope {
  restrictToSelf: boolean;
  userId: string;
  pipelineIds: string[] | null; // null = all pipelines
}
export function leadQueryScope(p: ResolvedPermissions, userId: string): LeadQueryScope {
  return {
    restrictToSelf: p.leadScope === "own",
    userId,
    pipelineIds: p.pipelineAccess === "all" ? null : [...p.pipelineAccess.ids],
  };
}
```

## Part B — Sidebar filtering

**B1. `src/industries/_loader.ts` — `getIndustrySidebarItems`:** add a 3rd param `permissions?: ResolvedPermissions`. In `isItemAllowed`, after the existing `minRoles` check add:
```ts
if (permissions && !canSeeNav(permissions, item.href)) return false;
```
Import `canSeeNav` + `ResolvedPermissions` from `@/lib/api/permissions`. (Keep `minRoles` as the coarse fallback; the href check is the fine gate.)

**B2. `src/app/(main)/(dashboard)/layout.tsx`:** pass `permissions` through:
- `getIndustrySidebarItems(tenantData.tenant.industry_id, tenantData.role, tenantData.permissions)`.
- Compute and pass an `allowedNavKeys` prop to `DashboardShell`: `tenantData.permissions.allowedNavKeys === null ? null : [...tenantData.permissions.allowedNavKeys]` (Set→array for the Server→Client boundary; `null` = all).

**B3. `src/components/dashboard/shell.tsx`:**
- Add `allowedNavKeys?: string[] | null` to `DashboardShellProps` and the destructure (default `null`).
- Build a gate: `const navAllowed = (href: string) => allowedNavKeys === null || allowedNavKeys.includes(href);`
- Filter the three universal arrays before rendering, e.g.:
  ```tsx
  {UNIVERSAL_NAV_TOP.filter((i) => navAllowed(i.href)).map((item) => renderNavItem(...))}
  {UNIVERSAL_NAV_MIDDLE.filter((i) => navAllowed(i.href)).map(renderNavItem)}
  {UNIVERSAL_NAV_BOTTOM.filter((i) => navAllowed(i.href)).map(renderNavItem)}
  ```
  (`/dashboard` is in TOP — it will always be allowed for any real position since the UI forces it, but don't special-case; if a position somehow excludes it, owner/admin still get `null`=all.)
- Industry items are already filtered server-side by B1 (they arrive pre-filtered in `industrySidebarItems`), so `industryBefore`/`industryAfter` need no change.
- **Optional — "Public Forms" quick-links section:** hide it when `!navAllowed("/forms")` (it's the form-builder-adjacent section). Low priority; include only if trivial.

## Part C — Page-route redirect guards

For each protected page (server components that already call `getCurrentUserTenant()`), add right after the `tenantData` null-check:
```ts
if (!canSeeNav(tenantData.permissions, "<href>")) redirect("/dashboard");
```
Apply to:
| Page file | href |
|---|---|
| `(dashboard)/leads/page.tsx` + `leads/[id]/page.tsx` | `/leads` |
| `(dashboard)/pipeline/page.tsx` | `/pipeline` |
| `(dashboard)/knowledge-bases/page.tsx` + `[id]` | `/knowledge-bases` |
| `(dashboard)/contacts/page.tsx` + `[id]` | `/contacts` |
| `(dashboard)/check-in/page.tsx` + `[id]` | `/check-in` |
| `(dashboard)/forms/...` (form-builder pages) | `/forms` |

- **`/team`**: gate with `/team`. (Members already can't mutate, but the page should redirect when not allowed.)
- **`/settings`**: leave as-is — it already redirects non-owner/admin, and members never pass that check. (Don't double-gate.)
- **`/dashboard`**: never gate.
- Industry pages keep their existing `getFeatureAccess(...) → notFound()` gate; the `canSeeNav` redirect is *additional* (feature-exists vs position-allows are different axes).

## Part D — Dashboard widget filtering (`(dashboard)/dashboard/page.tsx`)

- Import `canSeeWidget`, `leadQueryScope` from `@/lib/api/permissions`.
- Replace the `getLeads(..., { role, userId })` call with the scoped form (Part E): `getLeads(tenantData.tenant.id, leadQueryScope(tenantData.permissions, tenantData.userId))`.
- Wrap each widget by its key:
  | Widget | key |
  |---|---|
  | `<StatsCards>` | `stats` |
  | `<LeadsByStageChart>` | `leads-by-stage` |
  | `<LeadsBySourceChart>` | `leads-by-source` |
  | `<LeadsByCounselorChart>` | `leads-by-counselor` |
  | `<UtmAnalyticsSection>` | `utm` |
  Render each only when `canSeeWidget(tenantData.permissions, "<key>")`.
- **Replace** the existing `canSeeTeamStats = role owner/admin` gate on `LeadsByCounselorChart` with `canSeeWidget(tenantData.permissions, "leads-by-counselor")` (owner/admin → `dashboardWidgets:null` → true, so unchanged for them; members get it only if their position grants it).
- Keep the `industry_id === "education_consultancy"` condition on `<UtmAnalyticsSection>` AND `canSeeWidget(..., "utm")`.

## Part E — SSR read-path migration (`src/lib/supabase/queries.ts`) + all callers

Migrate the three helpers off `role` onto the scope object — this also closes the pipeline-access SSR hole.

- **`getLeads(tenantId, scope?)`** — replace the `{ role?, userId?, limit? }` options with `{ restrictToSelf?, userId?, pipelineIds?, limit? }`:
  ```ts
  if (scope?.restrictToSelf && scope.userId) query = query.eq("assigned_to", scope.userId);
  if (scope?.pipelineIds) query = query.in("pipeline_id", scope.pipelineIds); // null/undefined = all
  ```
- **`getLead(leadId, tenantId, scope?)`** — same `restrictToSelf`/`userId` check; plus, if `scope?.pipelineIds` is set and the fetched lead's `pipeline_id` isn't in it, return `null`.
- **`getLeadsForPipeline(tenantId, opts)`** — keep the existing specific `pipelineId` param; add `restrictToSelf`/`userId` (replace the `role==="counselor"` line) and, when `pipelineIds` is set, return `[]` if the requested `pipelineId` isn't in the allowed set (and `.in("pipeline_id", pipelineIds)` when no specific pipelineId is requested).

**Update all 6 callers** to pass `leadQueryScope(tenantData.permissions, tenantData.userId)` (spread/merge with any extra opts like `limit`/`pipelineId`):
- `(dashboard)/dashboard/page.tsx` (getLeads)
- `(dashboard)/leads/page.tsx` (getLeads)
- `(dashboard)/contacts/page.tsx` (getLeads)
- `(dashboard)/leads/[id]/page.tsx` (getLead)
- `(dashboard)/check-in/[id]/page.tsx` (getLead)
- `(dashboard)/pipeline/page.tsx` (getLeadsForPipeline — merge `leadQueryScope` with the existing `pipelineId`)

Equivalence: for current users `leadQueryScope` yields `restrictToSelf = (role==="counselor")` and `pipelineIds = null`, so these are byte-identical today; they only diverge once a restrictive position is assigned.

## Part F — (Optional) header badge shows position name

Cosmetic finish for the gap you saw (hardik's header says "Viewer" not "Counsellor"). If trivial:
- Extend `getCurrentUserTenant()`'s embed to also select the position `name` (`positions(permissions, name)`); return `positionName: string | null`.
- Pass it to `DashboardShell`; in the account dropdown badge, show `positionName ?? role`.
Skip if it adds noticeable complexity — not required for Phase 4 completeness.

---

## Hard rules / pitfalls (Phase 4)

- **No new behavior for owner/admin or unconfigured tenants.** owner/admin → `allowedNavKeys:null`, `dashboardWidgets:null`, `pipelineAccess:"all"`, `leadScope:"all"` → every gate open. Members with no restrictive position (NULL position / seeded all-access) likewise unchanged. Verify the no-op still holds for existing Admizz admin + a plain counselor.
- **`/dashboard` is never gated** (redirect target). Guards `redirect("/dashboard")`, never a 404 loop.
- **Sidebar hiding ≠ the only gate** — it now matches the API (Phase 2), so the two agree. Don't remove the API guards.
- **SSR pipeline filtering is the real fix in Part E** — without `.in("pipeline_id", …)` a pipeline-restricted member sees disallowed-pipeline leads in the server-rendered list. Don't skip it.
- Keep `minRoles` in `getIndustrySidebarItems` (coarse fallback); add the `canSeeNav` check alongside it.
- Universal infra — NOT registered in any manifest/`_registry`.

## Verification (Phase 4) — the feature is now complete end-to-end

- `npm run build` clean AND `npx eslint --max-warnings 50` (0 errors).
- **Re-run the hardik / Counsellor case (the screenshot):** with the Counsellor position (nav allow = Dashboard, All Leads, Pipeline, Knowledge Bases, Contacts, Check-In; NOT Team/Settings/Forms), log in as hardik →
  - **Sidebar now shows only the 6 allowed items** (Team, Settings, Forms, Public Forms gone). 📸
  - Direct-navigating to `/team` or `/forms` → **redirects to /dashboard**.
  - Dashboard shows only allowed widgets.
  - (Counsellor is leadScope all → still sees all leads, which is correct.)
- **Restricted-pipeline member** (e.g. "Front Desk" with one pipeline, leadScope own): `/leads` SSR list shows only their own leads in that pipeline; `/pipeline` shows only the allowed pipeline; dashboard stats reflect only those.
- **Branch Manager** (leadScope all + canEditLeads): sees all leads everywhere, dashboard full, can edit.
- **No-op check**: existing admin → full sidebar + all widgets + all leads; a plain counselor (NULL position) → own leads, full sidebar (their NULL position = all nav). Non-education tenants unchanged.
- **Owner-lockout safety** still holds (can't misconfigure an admin into restriction — hard override).

---

## ⟶ SONNET HANDOFF PROMPT (paste this to the Sonnet session)

> Implement **Phase 4 (final)** of the Positions/RBAC feature exactly per `docs/POSITIONS-RBAC-PHASE4-BRIEF.md`. Read it in full first. Phases 1–3 are shipped (resolver/helpers, API enforcement, positions CRUD + assignment all exist). Phase 4 makes the **UI reflect** the position (sidebar, page redirects, dashboard widgets) and closes the **SSR read-path** holes. It must stay a no-op for owner/admin and unconfigured members.
>
> **Phase 4 stacks on Phase 3, which is NOT yet on stage** (we're merging the whole Positions feature at the end). Branch off the local Phase 3 branch — do NOT pull from stage (Phase 3 code isn't there): `git checkout feat/positions-phase3 && git checkout -b feat/positions-phase4`.
>
> Build, committing logically:
> 1. `src/lib/api/permissions.ts` — add `LeadQueryScope` + `leadQueryScope(p, userId)` per Part A.
> 2. Sidebar: `getIndustrySidebarItems` gains a `permissions?` param filtering by `canSeeNav(href)` (`_loader.ts`); `layout.tsx` passes `permissions` into it AND passes `allowedNavKeys` (Set→array, null=all) into `DashboardShell`; `shell.tsx` filters `UNIVERSAL_NAV_TOP/MIDDLE/BOTTOM` by `allowedNavKeys`. Keep `minRoles`.
> 3. Page guards: add `if (!canSeeNav(tenantData.permissions, "<href>")) redirect("/dashboard");` to the leads, pipeline, knowledge-bases, contacts, check-in, forms, and team pages (+ their `[id]` variants) using each page's href per the table. Never gate `/dashboard`; leave `/settings` as-is.
> 4. Dashboard (`dashboard/page.tsx`): wrap each widget in `canSeeWidget(permissions, "<key>")` (stats / leads-by-stage / leads-by-source / leads-by-counselor / utm), replacing the old `canSeeTeamStats` gate; scope `getLeads` via `leadQueryScope`.
> 5. SSR migration (`queries.ts`): change `getLeads`/`getLead`/`getLeadsForPipeline` from `role` to `{ restrictToSelf, userId, pipelineIds }` (close the pipeline hole per Part E), and update all 6 callers to pass `leadQueryScope(tenantData.permissions, tenantData.userId)`.
> 6. (Optional) Part F: header badge shows position name — only if trivial.
>
> Hard rules: owner/admin + unconfigured members must be byte-identical (all gates open via null/all); `/dashboard` never gated; keep the Phase 2 API guards intact; keep `minRoles`; NOT registered in any manifest. The Part E pipeline `.in(...)` filter is mandatory (don't skip — it's the SSR data hole).
>
> Verify before committing: `npm run build` clean AND `npx eslint --max-warnings 50` (0 errors). Push the branch and stop — Opus reviews the diff and runs the full end-to-end verification (hardik's sidebar now filtered, page redirects, pipeline-restricted SSR, no-op for admins) before squash-merge.
