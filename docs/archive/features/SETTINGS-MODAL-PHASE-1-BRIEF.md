# BRIEF — Settings Modal (Phase 1: shell + reuse) — for Sonnet

> **Role:** Executor. Build Phase 1 on a NEW branch, run gates, do a local run, then **STOP and report**.
> Do NOT push, PR, merge, or touch prod. **Sadin verifies the UI himself.** Use `/frontend-dev` +
> `/ui-ux-expert` for the shell visuals. Full spec: the user's "EdgeX CRM v2 — Settings Modal Architecture
> Specification" (the 9 categories). Design ref: Manus/Linear settings modal.

## Branch hygiene (do this first)
The uncommitted education **nav-sections** work (`shell.tsx` + `manifest.ts`, INTELLIGENCE/LEADS/OPERATIONS/…
headers) is sitting in the working tree on `stage` and has been Opus-reviewed = clean. Create
`feature/settings-modal` off the current `stage`, then **commit the nav-sections changes as their own first
commit** (`feat(nav): education section headers`) so they're no longer dangling. Build the settings modal on
top. (Both touch `shell.tsx`, so they ship as one coherent unit.)

## Locked decisions
- **Global overlay modal** — opens over the current page (never navigates away), URL-synced + deep-linkable,
  back-button closes it, refresh-safe.
- **Phase 1 = shell + reuse**: modal shell + 9-category left-nav + URL deep-linking, with ALL existing
  settings managers dropped into their category panels AS-IS (light wrapper styling only). New sections
  (AI & Orca, Webhooks, Lead Routing, Lead Scoring) render a clean **"Coming soon"** placeholder.
- 9 categories in order: General, AI & Orca, Organization, Team & Roles, Lead Management, Academic
  Operations, Communications, Integrations, Compliance.

## 1. Modal mechanism — provider + query-param overlay (NOT intercepting routes)
- Create `src/contexts/settings-modal-context.tsx`: `SettingsModalProvider` + `useSettingsModal()` →
  `{ openSettings(tab?), closeSettings, isOpen, activeTab }`. Mount it in `(dashboard)/layout.tsx`, passing
  `tenant` + `role` (already fetched there). It renders `<SettingsModal>` over `children`.
- **URL contract** (mirror the existing `inbox-connector.tsx` `useSearchParams()`+`router.replace()` pattern):
  use a `?settings=<tab>` param on the CURRENT pathname. Open → `router.push(pathname?settings=tab)` (so
  back-button closes). Tab switch → `router.replace`. Close → `router.push(pathname)` (strip param). A mount
  effect reads `searchParams.get("settings")` → opens to that tab (deep-link + refresh-safe). If the param
  resolves to a hidden/unknown category, fall back to `general`.
- **Honor the spec's `/settings?tab=` links:** convert `src/app/(main)/(dashboard)/settings/page.tsx` into a
  thin server "opener" — keep the owner/admin gate, then `redirect("/home?settings=<tab>")` (map incoming
  `?tab=`, default `general`). So bookmarked `/settings?tab=classes` still opens the modal. Internal triggers
  call `openSettings(tab)` directly.

## 2. Shell components (create)
- `src/components/dashboard/settings/modal/settings-modal.tsx` — Radix `Dialog`; `DialogContent`
  `max-w-[1320px] w-[90vw] h-[85vh] p-0`, flex row: fixed ~240px `<SettingsSidebar>` + scrollable right panel
  that lazy-renders the active panel.
- `src/components/dashboard/settings/modal/settings-sidebar.tsx` — org identity block (logo/name/color/role
  from `tenant`) + the gated category list; highlights `activeTab`.
- `src/components/dashboard/settings/modal/settings-registry.ts` — single source of truth: array of
  `{ key, label, icon, isVisible(ctx), panel: React.lazy(...) }`. `isVisible` uses
  `getFeatureAccess(industryId, FEATURES.X)` (it's a pure, client-safe import from `@/industries/_loader`)
  + `isEducation`. Lazy panels = per-category code-split.
- `src/components/dashboard/settings/modal/panel-shell.tsx` — shared `<PanelHeader>` + `<PanelSection>` for
  consistent padding/headers (the "minimal restyle").
- `src/components/dashboard/settings/modal/coming-soon.tsx` — placeholder panel.
- `src/components/dashboard/settings/modal/panels/*.tsx` — 9 panel wrappers (below).

## 3. Category → panel mapping (reuse existing managers AS-IS; preserve their feature-gating)
| Category | Composes (in order) |
|---|---|
| General | `SettingsForm` (name/slug/color) + `IndustryInfoCard` |
| AI & Orca | `ComingSoon` |
| Organization | `IndustryEntitiesManager` (Destinations/entities) + `BranchesManager` |
| Team & Roles | `PositionsManager` *(render Positions in THIS category only — never twice)* |
| Lead Management | `LeadListsManager` (gate `LEAD_LISTS`); "Lead Routing"/"Lead Scoring" = `ComingSoon` sub-sections |
| Academic Operations | `ClassesManager` (gate `CLASSES`) + `AgentsManager` (gate `APPLICATION_TRACKING`); category visible only when `isEducation` |
| Communications | `EmailSenderCard` + `ChannelsCard` + `EmailRulesManager` + `InboxConnector` (gate `EMAIL`, keep its `?connected/?error` handling, wrap in `<Suspense>`) |
| Integrations | `ApiKeysManager` (`category="integration"`) + Webhooks `ComingSoon` |
| Compliance | `ConsentManager` (gate `APPLICATION_TRACKING`) |

Each panel re-applies the SAME `getFeatureAccess` gating these managers have today in `settings/page.tsx`, so
non-applicable managers/categories stay hidden exactly as now.

## 4. Data for prop-dependent panels — one bootstrap route
Three managers need server-fetched props a client modal lacks:
- `SettingsForm` needs `tenant` → thread it as a prop from the provider (already client-side). No fetch.
- `IndustryEntitiesManager` needs `entities` → it already self-fetches `/api/v1/entities` on mount; let it.
  It also needs the `industry` row.
- `PositionsManager` needs `navCatalog` + `widgetCatalog` → **no endpoint exposes these today**; they're
  computed inline in `settings/page.tsx` (~lines 75–99) from `UNIVERSAL_NAV` + `getIndustrySidebarItems(...)`
  + a static `widgetCatalog`.

→ Create **`GET /api/v1/settings/bootstrap`** (owner/admin-gated, tenant-scoped) returning
`{ industry, navCatalog, widgetCatalog }`. **Extract the catalog computation from `page.tsx` into a shared
helper** (e.g. `src/lib/settings/catalogs.ts`) and call it from BOTH the route and (if still needed) anywhere
else — one definition, so the nav-permission checkboxes can't drift. The Organization + Team&Roles panels
fetch this on first open (lazy → fires once, only if visited), show a skeleton, then render. Keep `entities`
self-fetched (don't duplicate into bootstrap).

**Biggest risk (call out in your report):** if the bootstrap catalog logic drifts from the page's, the
PositionsManager nav-permission checkboxes show the wrong keys — a real RBAC bug, not cosmetic. That's why it
must be the SAME extracted helper, moved verbatim.

## 5. Rewire the Settings triggers
- `src/components/dashboard/shell.tsx`: the Settings nav item (both the education-section render and
  `UNIVERSAL_NAV_BOTTOM`) and the account-dropdown "Settings" link → call `openSettings()` (give `renderNavItem`
  an optional `onClick` override; keep `href="/settings"` for middle-click/fallback). Import `useSettingsModal`.
- Update the 3 existing section deep-links to `openSettings(tab)`:
  - `lead-lists-nav-group.tsx` `#lead-lists` → `openSettings("lead-management")`
  - `classes-workspace.tsx` `#classes` → `openSettings("academic-operations")`
  - `from-account-picker.tsx` `#connected-inboxes` → `openSettings("communications")`

## 6. Gating + the old route
- Provider builds `GatingContext { industryId, role, isEducation }`; sidebar shows only `isVisible`
  categories; deep-link to a hidden category → `general`.
- Keep owner/admin gate: the Settings trigger only renders for owner/admin (mirror existing `isLayoutAdmin`);
  the `/settings` opener route keeps its server-side owner/admin gate.

## Design direction (use /ui-ux-expert)
Manus/Linear aesthetic: white modal, rounded, subtle backdrop; left nav 240px with org identity block on top
then muted-uppercase-less category items with icons; right panel generous padding, one category at a time,
section headers via `PanelHeader`. Desktop + tablet responsive (stack/he drawer on narrow). Don't redesign the
managers' internals — just consistent wrappers.

## Gates / report
- `npm run build` clean · `npx eslint --max-warnings 50` clean.
- Local run (Sadin verifies): Settings opens as an overlay from the nav + account menu WITHOUT leaving the
  page; URL shows `?settings=<tab>`; deep-link/refresh re-opens the right tab; back-button closes; all 9
  categories render with the existing managers working; AI&Orca/Webhooks/Lead-Routing/Scoring show "Coming
  soon"; gating hides Academic Ops/Compliance for non-applicable tenants; non-admins don't see Settings.
- Commit on `feature/settings-modal` (nav-sections as a separate first commit), then STOP and report (branch,
  commits, the bootstrap route + extracted catalog helper, gate outputs, any deviation). Do NOT push/PR/merge/
  prod — Opus reviews, then drives the push.

## Out of scope (Phase 2)
Real AI & Orca panel, Webhooks manager, expanded General fields (industry/timezone/date-format/currency/logo
+ a tenant-update API), Lead Routing/Scoring, Org-layers UI. Registry entries stay; swap `ComingSoon` later.
