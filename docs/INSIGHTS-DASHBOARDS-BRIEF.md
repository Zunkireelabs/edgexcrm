# Insights → Dashboards (education_consultancy) — Sonnet Build Brief

**Branch:** `feature/insights-dashboards` (off `stage`)
**Owner workflow:** Opus wrote this brief. **Sonnet implements on this branch and STOPS at review** — do NOT merge, do NOT push to `stage`/`main`, do NOT apply the migration to any DB. Opus reviews post-hoc, runs both gates, applies the migration on Sadin's GO, and promotes.
**Industry focus:** `education_consultancy` only (Admizz is the requesting tenant).
**Migration number:** `048_dashboards.sql` (047 is the latest on disk).

---

## 1. Goal (what we're building)

Today every tenant has ONE hardcoded dashboard at `/dashboard` (5 stat cards + 3 charts + edu-only UTM). Admizz wants **role/position-specific dashboards**: the admin/owner creates multiple **named dashboards** and **grants each to one or more positions**; a user sees the dashboards granted to their position, with the **data scoped to what that position is allowed to see**.

This v1 also reframes the nav: for education tenants, the flat **`Dashboard`** nav item becomes an **`Insights`** group whose first (and for now only) child is **`Dashboards`**. `Reports` and `Goals` are deferred — established as intent, NOT built, NOT shown as dead nav links.

**Build the admin/owner experience first.** Members (Counsellor / Lead Caller / Application Executive) get a read-only view of dashboards granted to their position, or a clean empty state if none are granted yet.

---

## 2. Design decisions (LOCKED — do not re-litigate)

These were settled with Sadin. Implement exactly as stated.

- **The dashboard is the unit of sharing.** A dashboard row carries a **position grant list**. We do NOT use the existing per-position `dashboard.widgets` allowlist as the gate on this surface (that mechanism stays in the codebase for the legacy `/dashboard`, but Insights ignores it).
- **Two orthogonal visibility axes:**
  1. **Which dashboards you see** = the dashboard's `granted_position_ids` (NEW).
  2. **Whose data fills a dashboard** = the **viewer's** position `leadScope` (EXISTING: `own`/`all`/`team`). Owner/admin always resolve to `all`.
  - → One dashboard *definition*, personalized per viewer. Reuse `leadQueryScope(permissions, userId)` exactly as `/dashboard` does today — **no new scoping code**.
  - Example: Counsellor Dashboard granted to the `counsellor` position (leadScope `own`). Counsellors CA and CB both see it; CA's widgets count CA's assigned leads, CB's count CB's. An admin opening it sees `all` leads (their override stands — acceptable for v1; "view-as" is deferred).
- **Lean, not a builder.** A dashboard = name + ordered list of widgets chosen from a **fixed predefined widget catalog** (the 5 existing widgets). NO drag-and-drop, NO freeform layout, NO configurable data sources.
- **Universal data model, education-gated surface.** The `dashboards` table is **tenant-scoped and universal** (like `positions`) so a 2nd industry needs no migration later. The **nav + routes are gated to `education_consultancy`** via a new `insights` feature in the education manifest.
- **View-only v1.** Owner/admin create/edit/delete/grant. Members only view. No per-position editing.
- **Grant target = positions** (by `position_id`), not individual users.
- **Empty state, not a fallback dashboard.** A position granted zero dashboards sees "No dashboards have been assigned to your position yet."
- **Nav surgery for education only.** Education tenants: hide the universal `Dashboard` item, show `Insights`. `/dashboard` route redirects to `/insights/dashboards`. All other industries: unchanged (flat `Dashboard`, legacy page).

---

## 3. Data model — migration `048_dashboards.sql`

Tenant-scoped table + RLS mirroring the `030_positions.sql` pattern (`get_user_tenant_ids()` for SELECT, `is_tenant_admin()` for mutations). **Plus** a grant-aware SELECT policy so members can only read dashboards granted to their position. RLS is defense-in-depth; the app (service-role/`scopedClient`) ALSO filters by grant in code (belt + suspenders, per the tenant-isolation rules).

```sql
-- 048_dashboards.sql
-- Named, position-scoped dashboards for the Insights surface. Tenant-scoped and
-- universal (engine is industry-agnostic; only the nav/route is education-gated for now).
-- Sharing model: a dashboard is granted to zero+ positions via granted_position_ids.
-- Owner/admin see every dashboard in their tenant; members see only granted ones.

CREATE TABLE IF NOT EXISTS dashboards (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  description          TEXT,
  widgets              JSONB NOT NULL DEFAULT '[]'::jsonb,   -- ordered array of widget keys (strings)
  granted_position_ids UUID[] NOT NULL DEFAULT '{}',         -- positions that may VIEW this dashboard
  sort_order           INT NOT NULL DEFAULT 0,
  created_by           UUID,                                  -- auth.users id; nullable, informational
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dashboards_tenant ON dashboards (tenant_id);

ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY;

-- SELECT: admins see all tenant dashboards; members see only those granted to their position.
CREATE POLICY "dashboards_select" ON dashboards
  FOR SELECT USING (
    tenant_id IN (SELECT get_user_tenant_ids())
    AND (
      is_tenant_admin(tenant_id)
      OR EXISTS (
        SELECT 1 FROM tenant_users tu
        WHERE tu.user_id = auth.uid()
          AND tu.tenant_id = dashboards.tenant_id
          AND tu.position_id = ANY (dashboards.granted_position_ids)
      )
    )
  );
CREATE POLICY "dashboards_insert" ON dashboards
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "dashboards_update" ON dashboards
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "dashboards_delete" ON dashboards
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- ── Seed one "Overview" dashboard per education_consultancy tenant ──
-- Preserves the admin's current view (all 5 widgets). granted_position_ids = '{}' →
-- only owner/admin see it initially; admin can edit grants to hand it to positions.
INSERT INTO dashboards (tenant_id, name, description, widgets, granted_position_ids, sort_order)
SELECT t.id, 'Overview', 'Default overview dashboard',
       '["stats","leads-by-stage","leads-by-source","leads-by-counselor","utm"]'::jsonb,
       '{}', 0
FROM tenants t
WHERE t.industry_id = 'education_consultancy'
ON CONFLICT DO NOTHING;
```

> **Note for Sonnet:** `ON CONFLICT DO NOTHING` here has no unique target to bind to (no unique constraint on name) — it's a harmless no-op guard. If re-running the migration is a concern, wrap the seed in a `WHERE NOT EXISTS (SELECT 1 FROM dashboards d WHERE d.tenant_id = t.id)` guard instead. Pick one; don't leave a seed that double-inserts on re-apply.

**Widget keys (the catalog, v1):** `stats`, `leads-by-stage`, `leads-by-source`, `leads-by-counselor`, `utm`. These map 1:1 to the existing components (see §7).

**Add the `Dashboard` type** to `src/types/database.ts`:
```ts
export interface Dashboard {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  widgets: string[];               // widget keys, ordered
  granted_position_ids: string[];  // position ids
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
```

---

## 4. Feature folder (industry-scoped)

Create `src/industries/education-consultancy/features/insights/`:

```
insights/
  meta.ts                              # FeatureMeta { id: FEATURES.INSIGHTS, industries: [EDUCATION_CONSULTANCY] }
  types.ts                             # re-export Dashboard + any view-model types
  lib/
    widget-catalog.ts                  # WIDGET_CATALOG: key → { key, label, description }
  components/
    dashboard-renderer.tsx             # maps widget keys → existing widget components (client)
    dashboard-builder-dialog.tsx       # create/edit dialog (name, desc, widget multi-select, position-grant multi-select) (client)
    dashboard-card.tsx                 # a card in the list (client; admin gets edit/delete affordances)
  pages/
    dashboards-list.tsx                # the Insights → Dashboards list view (client wrapper; receives SSR data)
    dashboard-view.tsx                 # single-dashboard render (client wrapper; receives SSR leads + dashboard)
```

`meta.ts`:
```ts
import { FEATURES, INDUSTRIES } from "../../../_registry";
import type { FeatureMeta } from "../../../_types";

export const insightsMeta: FeatureMeta = {
  id: FEATURES.INSIGHTS,
  industries: [INDUSTRIES.EDUCATION_CONSULTANCY],
};
```

`lib/widget-catalog.ts` — the single source of truth for which widgets exist + their labels (used by the builder's multi-select and the renderer):
```ts
export interface WidgetDef { key: string; label: string; description: string; }
export const WIDGET_CATALOG: WidgetDef[] = [
  { key: "stats",              label: "Stats cards",        description: "Total / New / Contacted / Enrolled / Rejected" },
  { key: "leads-by-stage",     label: "Leads by Status",    description: "Donut of leads grouped by status" },
  { key: "leads-by-source",    label: "Leads by Source",    description: "Top sources / forms" },
  { key: "leads-by-counselor", label: "Leads by Counselor", description: "Per-counselor lead counts" },
  { key: "utm",                label: "UTM Attribution",    description: "Source / Medium / Campaign breakdown" },
];
export const WIDGET_KEYS = WIDGET_CATALOG.map((w) => w.key);
```

---

## 5. Registry + manifest changes

**`src/industries/_registry.ts`** — add to `FEATURES`:
```ts
  // Industry-scoped (education_consultancy)
  ...
  INSIGHTS: "insights",
```

**`src/industries/education-consultancy/manifest.ts`** — import `insightsMeta`, register it, and add the `Insights` sidebar **group** positioned `before-pipeline` (so it sits just under the universal top items, where Dashboard used to be):
```ts
import { insightsMeta } from "./features/insights/meta";
// ...
features: [
  { meta: insightsMeta },
  { meta: checkInMeta },
  // ...rest
],
sidebar: [
  {
    kind: "group",
    position: "before-pipeline",
    id: "insights",
    label: "Insights",
    icon: "ChartColumn",                 // add to INDUSTRY_ICONS (see §6)
    children: [
      { featureId: FEATURES.INSIGHTS, href: "/insights/dashboards", label: "Dashboards", icon: "LayoutDashboard" },
    ],
  },
  // ...existing Contacts / Check-In / Forms items
],
```

> A one-child group is intentional — it establishes the `Insights` IA so `Reports`/`Goals` drop in later as sibling children with zero refactor. Do not add `Reports`/`Goals` now (they'd be dead links).

---

## 6. Nav surgery in `src/components/dashboard/shell.tsx` (education-gated)

The shell already receives `tenant` (has `industry_id`) and renders `UNIVERSAL_NAV_TOP`. Make two contained edits, both gated to education:

1. **Hide the universal `Dashboard` item for education tenants.** Where `UNIVERSAL_NAV_TOP` is filtered for rendering (line ~317), also drop `/dashboard` when `tenant.industry_id === "education_consultancy"`. Example:
   ```ts
   const isEducation = tenant.industry_id === "education_consultancy";
   // in the render:
   {UNIVERSAL_NAV_TOP
     .filter((i) => navAllowed(i.href))
     .filter((i) => !(isEducation && i.href === "/dashboard"))
     .map((item) => renderNavItem(...))}
   ```
   The `Insights` group arrives via `industryBefore` (the manifest group, `position: "before-pipeline"`), so it renders right where Dashboard was. Other industries keep their flat Dashboard untouched.

2. **Register the group icon.** Add `ChartColumn` (lucide) to the imports and to the `INDUSTRY_ICONS` map. `LayoutDashboard` (the child icon) is already registered.

> Verify `industryBefore` / `industryAfter` derive group entries with `position: "before-pipeline"` into the pre-pipeline slot. If the existing code only splits flat items by `position`, ensure groups with a `position` are routed the same way (check how it-agency's `after-pipeline` "Project Management" group is bucketed and mirror it).

---

## 7. Route shells (SSR) — gating + data

All under `src/app/(main)/(dashboard)/`. Every shell: `getCurrentUserTenant()` → redirect `/login` if none → `getFeatureAccess(industry_id, FEATURES.INSIGHTS)` → `notFound()` → `canSeeNav(permissions, "/insights/dashboards")` → redirect `/dashboard` if false (all current positions are nav-mode `all`, so this passes; it's the standard guard).

**`/dashboard/page.tsx`** — add at the very top, before any fetch:
```ts
if (tenantData.tenant.industry_id === "education_consultancy") redirect("/insights/dashboards");
```
(Education's single dashboard surface is Insights; the legacy 5-widget render stays for all other industries.)

**`insights/page.tsx`** — `redirect("/insights/dashboards")` (after the same gate) so `/insights` resolves.

**`insights/dashboards/page.tsx`** (the LIST):
- Gate as above.
- Read dashboards via `scopedClient(...)` (tenant auto-scoped). Then **filter by grant in code**:
  - `permissions.baseTier === "owner" || "admin"` → all tenant dashboards.
  - else → `dashboards.filter(d => d.granted_position_ids.includes(tenantData.positionId))` (positionId may be null → no matches → empty state).
- Order by `sort_order`, then `created_at`.
- Pass `{ dashboards, canManage: baseTier is owner/admin }` to `<DashboardsList>`.

**`insights/dashboards/[id]/page.tsx`** (the VIEW):
- Gate as above.
- Fetch the dashboard by id via `scopedClient` (tenant-scoped). If not found → `notFound()`.
- **Grant check:** if NOT owner/admin AND `!dashboard.granted_position_ids.includes(positionId)` → `notFound()`.
- Fetch the same inputs `/dashboard` uses, scoped to the viewer:
  ```ts
  const [leads, teamMembers, stages, formConfigs] = await Promise.all([
    getLeads(tenant.id, leadQueryScope(permissions, userId)),
    getTeamMembers(tenant.id),
    getPipelineStages(tenant.id),
    getFormConfigsForTenant(tenant.id),
  ]);
  ```
- Render `<DashboardView dashboard={...} leads={...} stages={...} memberMap={...} formMap={...} />` which renders only the widgets in `dashboard.widgets`, in order, via `<DashboardRenderer>`.

> **Reuse, don't duplicate, the widget components:** `StatsCards`, `LeadsByStageChart`, `LeadsBySourceChart`, `LeadsByCounselorChart` (from `@/components/dashboard/...`), and `UtmAnalyticsSection` (from the edu utm-analytics feature). `<DashboardRenderer>` is a thin `switch (key)` over `WIDGET_CATALOG` keys mapping to these. Build the same `memberMap` / `formMap` the current `/dashboard/page.tsx` builds (lines 21–27).

---

## 8. API routes (mutations + optional client reads)

Under `src/app/(main)/api/v1/dashboards/`. Standard pattern: `createRequestLogger` → `authenticateRequest()` → `getFeatureAccess(auth.industryId, FEATURES.INSIGHTS)` → `apiForbidden()` → validate → `scopedClient(auth)` → standardized responses.

**Admin-write gate:** mutations require owner/admin. Use the resolved tier: `auth.permissions.baseTier === "owner" || auth.permissions.baseTier === "admin"` (equivalently `auth.role` owner/admin) → else `apiForbidden()`.

- **`route.ts`**
  - `GET` — list dashboards visible to the caller (same grant logic as the SSR list; admins all, members granted-only). Exists for any client refresh; SSR pages may read directly instead.
  - `POST` (admin) — create. Body: `{ name, description?, widgets: string[], granted_position_ids: string[] }`. **Validate:** name non-empty; every widget key ∈ `WIDGET_KEYS`; every position id exists for this tenant (query `positions` where `tenant_id = auth.tenantId`); strip unknowns. `scopedClient.insert` (tenant auto-injected). Set `created_by = auth.userId`. Return the inserted row.
- **`[id]/route.ts`**
  - `GET` — one dashboard; apply the same grant check (member must be granted or 404/403).
  - `PATCH` (admin) — partial update of `name`/`description`/`widgets`/`granted_position_ids`/`sort_order`. Same validation as POST for any provided field. **`scopedClient.update` MUST include `.eq("id", id)`** (per CLAUDE.md — the wrapper only auto-injects `tenant_id`; without an id filter you'd update every dashboard in the tenant).
  - `DELETE` (admin) — `scopedClient.delete().eq("id", id)`.

The builder dialog populates its position multi-select from the existing `GET /api/v1/positions` (already returns tenant positions with names) — do NOT build a new positions endpoint.

---

## 9. UI behavior

**`DashboardsList`** (`pages/dashboards-list.tsx`, client):
- Header "Dashboards" + (if `canManage`) a **`New Dashboard`** button opening `<DashboardBuilderDialog>` in create mode.
- Grid of `<DashboardCard>` — name, description, a small widget-count + granted-positions summary (admin only), click → navigate to `/insights/dashboards/[id]`. Admin cards expose `⋯` → Edit / Delete.
- **Empty state:** if `dashboards.length === 0`: admins see "No dashboards yet — create one" (with the New button); members see "No dashboards have been assigned to your position yet."

**`DashboardBuilderDialog`** (client):
- Fields: **Name** (required), **Description** (optional), **Widgets** (multi-select / checkbox list from `WIDGET_CATALOG`, order = catalog order for v1 — reordering is deferred), **Visible to positions** (multi-select of tenant positions by name, value = position id; fetched from `/api/v1/positions`).
- Create → `POST /api/v1/dashboards`; Edit → `PATCH /api/v1/dashboards/[id]`; on success toast + refresh (`router.refresh()`).
- Use shadcn `Dialog`, `Input`, `Checkbox`, and the existing multi-select pattern in the repo (grep for one used in the positions/settings UI; **do not** introduce a new dependency). **Radix `Select` forbids empty-string item values** — if you use a Select anywhere, use a sentinel, never `value=""`.

**`DashboardView`** (`pages/dashboard-view.tsx`, client) + **`DashboardRenderer`**:
- Title = dashboard name. Render each widget in `dashboard.widgets` order via the renderer. Unknown/legacy keys → skip silently.
- `utm` widget only renders for education (the whole feature is education-gated, so it's always fine here, but keep the `UtmAnalyticsSection` import lazy/guarded as today).

---

## 10. Visibility rules (the contract — get this exactly right)

> **Position grant decides *which* dashboards you see; the viewer's position `leadScope` decides *whose data* fills them; owner/admin always see `all`-scoped data and every dashboard.**

- Reuse `leadQueryScope(permissions, userId)` for the leads query in the VIEW shell — identical to `/dashboard`. Counsellor (`own`) → their leads; Lead Caller / Application Executive (`all`) → whole pool; admin/owner → all.
- The grant filter (list + view) keys on **`tenantData.positionId`** vs `dashboard.granted_position_ids`. A user with `position_id = null` matches nothing → empty state. That's correct.
- RLS policy is the backstop; app code is the primary enforcement (service-role bypasses RLS). Both must agree.

---

## 11. Gating / isolation checklist (must all hold)

- [ ] All 3 route shells + all API routes call `getFeatureAccess(..., FEATURES.INSIGHTS)` → `notFound()` / `apiForbidden()`.
- [ ] Non-education tenant: `/insights/dashboards` 404s; no `Insights` nav; flat `Dashboard` still present and working.
- [ ] Mutations are owner/admin only (member POST/PATCH/DELETE → 403).
- [ ] `scopedClient` used everywhere; `.update`/`.delete` carry `.eq("id", id)`.
- [ ] Member sees only granted dashboards (list + direct-URL to a non-granted id → 404).
- [ ] Counsellor view = own leads only; admin view of the same dashboard = all leads.
- [ ] `Dashboard` type added; widget keys validated against `WIDGET_KEYS` server-side.
- [ ] New icon (`ChartColumn`) added to `INDUSTRY_ICONS`.

---

## 12. Out of scope / deferred (capture, don't build)

- **Reports** and **Goals** sub-nav (placeholders only — established IA, not built).
- Drag-and-drop / freeform layout; widget reordering in the builder; per-widget config or filters.
- New position-specific metrics (calls made, connect rate, applications-in-progress) — these need new data models (no call-log / application-stage data exists today). Sequence later once Sadin specifies per-position metrics.
- "View-as / impersonation" so an admin can see exactly what a counsellor sees.
- Per-dashboard scope pinning (a dashboard forcing `own` even for admins).
- Promotion of the engine to `_shared` for other industries (data model is already universal; only a manifest flip needed later).
- Granting to individual users (positions only in v1).

---

## 13. Verification (Sonnet: run, then hand to Opus — do NOT push)

Gates: `npm run build` clean **and** `npx eslint . --max-warnings 50` clean (run BOTH — build-clean has shipped lint-red before).

Functional (describe results to Opus; the migration is NOT yet applied, so note which checks need the DB and leave them for the post-migration smoke):
1. As Admizz **owner/admin**: `/insights/dashboards` lists the seeded `Overview`; `New Dashboard` → create "Counsellor Dashboard" (pick a few widgets, grant to `Counsellor`) → appears in list → opens and renders.
2. Edit `Overview` grants; delete a test dashboard.
3. Non-education tenant (Zunkiree / Prime): no `Insights` nav, `/insights/dashboards` 404, flat `Dashboard` intact.
4. As a **Counsellor** user: sees `Insights → Dashboards`; sees only granted dashboards; widgets show own leads; direct URL to a non-granted dashboard 404s.
5. `/dashboard` as Admizz → redirects to `/insights/dashboards`.

---

## 14. Workflow guardrails (READ THIS)

- Implement on `feature/insights-dashboards`. **STOP at review.** Do NOT merge to `stage`, do NOT push, do NOT `git checkout main`.
- **Do NOT apply `048_dashboards.sql` to any database** (dev or shared). The shared Supabase DB is also local dev's DB. Opus applies it on Sadin's explicit GO.
- Leave the work committed on the branch (or uncommitted — Opus will commit with the correct trailer). Do not self-approve.
- If you hit an ambiguity not covered here, leave a `// TODO(opus):` note and keep going; don't invent scope.

---

## 15. Sonnet handoff prompt (paste this to the Sonnet session)

> Implement the Insights → Dashboards feature for the `education_consultancy` tenant per `docs/INSIGHTS-DASHBOARDS-BRIEF.md`, on the existing `feature/insights-dashboards` branch (already checked out off `stage`). Build all of it: migration `048_dashboards.sql` (file only — do NOT apply it to any DB), the `insights` feature folder, registry + education manifest registration, the education-gated nav surgery in `shell.tsx`, the 3 route shells, the `/api/v1/dashboards` CRUD routes, and the list/builder/renderer/view UI — reusing the existing dashboard widget components and `leadQueryScope` scoping. Honor every item in §11 (gating/isolation) and §10 (visibility contract). When done, run BOTH gates (`npm run build` and `npx eslint . --max-warnings 50`) and report results, then STOP for Opus review — do NOT merge, push, or apply the migration.

---

## 16. PENDING follow-up — "Admin Dashboard" funnel widget (NOT yet built; shipped through here = Phases 1–2 + switcher + nav-after-home)

**Status (2026-06-13):** Phases 1–2 (named dashboards, position grants, switcher, layout, Insights-after-Home nav) shipped to stage. Admizz's client then requested a **second dashboard, "Admin Dashboard" (owner/admin only)**, containing a **new funnel-scorecard widget**. Blocked on two decisions below — not built yet. Owner == admin throughout (both base-tiers see every dashboard via the resolver override; an empty `granted_position_ids` already means admin-only, so the "Admin Dashboard" needs no special grant).

**Client spec — 4-phase funnel, each with sub-metrics:**

| Phase | Metrics |
|---|---|
| Leads | Total · New · active · Lost |
| Prospects | Total · New · active · Lost |
| Applications | Total · New · active · Lost |
| Conversion | Success · Lost |

**Decision 1 — stage→phase mapping (needs client approval).** Admizz's "Admizz Pipeline" has **32 stages** (messy: `Prospect` ×2, `Not Reachable` ×4, `Closed` ×3, most empty). Draft mapping:

| Phase | Stages |
|---|---|
| Leads | New Lead (333), Connected, Lead Qualified, Profile Verified |
| Prospects | Prospect (2), Assigned Prospects, Counseling Scheduled, Counseling, Needs More Time |
| Applications | Documents Collected (1), Application Submitted, Offer Received, Visa Filed, Application Ready, New App, Class Ready |
| Conversion · Success | Enrolled, Joined Class *(terminal `won`)* |
| Conversion · Lost | Lost, Closed, Non-converted leads (1), Not Eligible, Not Interested, Not Reachable |

**Decision 2 — "New"/"Lost" definitions.** "New" = entered phase in last 7 days (computable now, mirrors stat-cards "this week"). **Per-phase "Lost" is NOT computable from current lead state** (a lost lead sits in one global Lost/Closed stage, untagged by phase) — true per-phase Lost needs `events` (`lead.stage_changed`) history reconstruction = bigger lift. Pick: **lean v1** (Total+New+active per phase, single Conversion Success/Lost) vs **full spec** (per-phase Lost via events).

**Build path once decisions locked:** add a `funnel` key to the insights widget catalog + a `FunnelWidget` (and likely a where-to-store-the-stage-mapping call: widget config vs a `pipeline_stages.funnel_phase` column) → create a dashboard row "Admin Dashboard" (`granted_position_ids = {}`) for Admizz (or seed/lazy-create) → Sonnet brief → review → stage → main. Opus plans/reviews; Sonnet builds the widget.
