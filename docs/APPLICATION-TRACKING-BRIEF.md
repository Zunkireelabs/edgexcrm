# Application Tracking — Build Brief (Education Consultancy)

> **Status:** B0 done (branch + brief). Awaiting Sonnet implementation B1–B5. Stop-at-review.
> **Branch:** `feature/application-tracking` (off `origin/stage` @ `0c28151`). PR target: **`stage`**.
> **Migration:** `057_application_tracking.sql` (next free number; 056 is the latest).
> **Scope:** industry-scoped to `education_consultancy`. Structural twin = `it_agency` **Deals** feature.
> **Owner:** Opus plans/reviews · Sonnet implements (stop-at-review) · Sadin = visual smoke + prod GO.

---

## 1. Why

Study-abroad agencies (Admizz) help one student apply to **many universities at once**, each application
progressing independently — an offer from University A while still collecting documents for University B.
edgeX models none of this today: a lead has one pipeline `status`, one `lead_type` (lead/prospect), and
`tags`. We add **one student (lead) → many applications**, the way Salesforce Education Cloud, Meritto,
LeadSquared, and SmartX all model it.

**Two surfaces** (the dual presentation every leading tool uses):
- **Per-lead Applications tab** on the lead detail page — the everyday counselor view.
- **Global `/Applications` nav** — table + Kanban board across all students — ops oversight; later feeds the
  Admizz "Leads→Prospects→Applications→Conversion" funnel.

## 2. Locked decisions

1. Statuses stored as **data** in a seeded `application_stages` table (configurable later; **no editor UI in v1** — seeded read-only).
2. **Full 9-stage** industry pipeline (+ 2 terminal) incl. the conditional/unconditional offer split.
3. Per-lead Applications tab visible **only when `lead_type='prospect'`**. **Auto-promote to prospect happens on the global board's "Add Application" path** (where you pick any lead). The per-lead path needs no promote — the lead is already a prospect there.
4. Ship **both** surfaces in **one PR** to `stage`.

## 3. Reuse map — mirror Deals, don't reinvent

An application is a **child of a lead** (`lead_id` FK) — unlike a deal, which is itself the top record.
So we mirror Deals' *patterns* into a new `applications` table, not the `deals` table itself.

| Build target | Mirror this existing file |
|---|---|
| Migration (`applications` + `application_stages`) | `supabase/migrations/046_deals.sql`, `047_deal_pipelines.sql` |
| Feature folder | `src/industries/it-agency/features/deals/` |
| Workspace page (table + board) | `.../deals/pages/deals-workspace.tsx` |
| Kanban board (@dnd-kit drag) | `.../deals/components/deal-board.tsx`, `deal-card.tsx` |
| Table view | `.../deals/components/deals-table.tsx` |
| Add sheet | `.../deals/components/add-deal-sheet.tsx` |
| Server query lib | `src/lib/deals/queries.ts`, `src/lib/deals/stages.ts` |
| Collection / item API | `src/app/(main)/api/v1/deals/route.ts`, `deals/[id]/route.ts` |
| Per-lead sub-record API (lead-tenant + branch-access checks) | `src/app/(main)/api/v1/leads/[id]/check-ins/route.ts` |
| Lead detail tab, industry-gated | travel `itinerary` tab in `src/components/dashboard/lead/lead-tabs.tsx` (`:101-103,209-218`) |
| Industry-scoped gate pattern | `src/industries/_loader.ts` `getFeatureAccess`; `src/industries/education-consultancy/manifest.ts` |

## 4. Data model

```
leads (student)  1 ────< many  applications
  lead_type=prospect              ├ id, tenant_id, lead_id (FK leads ON DELETE CASCADE), assigned_to (FK users, null)
                                   ├ university_name (text), program_name (text)
                                   ├ intake_term (text, e.g. "Fall 2026"), country (text)
                                   ├ stage_id (FK application_stages)  ← source of truth
                                   ├ status (text slug, denormalized from stage, kept in sync)
                                   ├ offer_type (text: 'conditional'|'unconditional'|null)
                                   ├ application_deadline (date, null)
                                   ├ application_fee_paid (bool default false), tuition_fee (numeric, null)
                                   ├ deposit_paid (bool default false), offer_letter_url (text, null)
                                   ├ notes (text, null), created_at, updated_at, deleted_at (soft delete, null)

application_stages (seeded per education tenant; configurable later)
  id, tenant_id, name, slug, position, color, terminal_type ('won'|'lost'|null), is_default (bool)
```

### Seeded default stages (slug · position · terminal_type · color)

| pos | name | slug | terminal_type | color |
|--|--|--|--|--|
| 0 | Shortlisted | `shortlisted` | – | #3b82f6 |
| 1 | Documents Pending | `documents_pending` | – | #f97316 |
| 2 | Applied | `applied` | – | #a855f7 |
| 3 | Conditional Offer | `conditional_offer` | – | #eab308 |
| 4 | Unconditional Offer | `unconditional_offer` | – | #14b8a6 |
| 5 | Offer Accepted | `offer_accepted` | – | #06b6d4 |
| 6 | Visa Applied | `visa_applied` | – | #8b5cf6 |
| 7 | Visa Approved | `visa_approved` | – | #10b981 |
| 8 | Enrolled | `enrolled` | `won` | #22c55e |
| 9 | Rejected | `rejected` | `lost` | #ef4444 |
| 10 | Withdrawn | `withdrawn` | `lost` | #6b7280 |

`offer_type` is its own field because only an **unconditional** offer (Letter of Acceptance) unlocks the
visa stage — the load-bearing domain nuance. New applications default to stage `shortlisted`.

### Migration notes (`057_application_tracking.sql`)

- **Tracked + additive + idempotent** (`CREATE TABLE IF NOT EXISTS`). Do NOT repeat the `lead_type`
  schema-drift mistake (that column was added with no migration).
- Both tables: `tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE`; `update_updated_at` trigger;
  partial indexes `WHERE deleted_at IS NULL`; indexes on `(tenant_id, lead_id)` and `(tenant_id, stage_id)`.
- **RLS** (mirror `046_deals.sql`): `ENABLE ROW LEVEL SECURITY`;
  `_select` → `tenant_id IN (SELECT get_user_tenant_ids())`;
  `_insert/_update/_delete` → `is_tenant_admin(tenant_id)`.
- Seed `application_stages` for existing education tenants:
  `INSERT ... SELECT <stage>, t.id FROM tenants t WHERE t.industry_id = 'education_consultancy'`.
- **⚠ New-tenant provisioning gap:** new-tenant onboarding does NOT auto-provision pipeline stages today
  (seeding is migration-driven, confirmed via the existing `pipeline_stages` setup). Either add
  education-tenant `application_stages` provisioning to the tenant-creation path, **or** log the gap on
  STATUS-BOARD so a freshly created education tenant isn't stuck with zero application stages. State which you did.

## 5. API surface (`src/app/(main)/api/v1/`)

Every route: `authenticateRequest()` → `getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING) → apiForbidden()`
→ `scopedClient(auth)`. Writes require admin (`requireAdmin`). Counselors are scoped to their own leads'
applications (filter by the parent lead's assignment / `auth.userId`, per the Counselor Role Scoping rule).
Emit `createAuditLog()` + `emitEvent()` on writes, like deals. PATCH must preserve POST invariants.

- `GET /application-stages` — read-only seeded stages.
- `GET /applications` — list across tenant; filters `stage_id`/`status`, `country`, `lead_id`, `assigned_to`. Powers global board/table.
- `POST /applications` — create. **If the target lead's `lead_type !== 'prospect'`, set it to `'prospect'` (audit-logged)** — the global-board auto-promote path. `.select()` back the join shape the board consumes.
- `GET /applications/[id]` · `PATCH /applications/[id]` (stage move: keep `status` slug in sync with `stage_id`, mirror the leads `[id]` dual-mode resolution) · `DELETE /applications/[id]` (soft delete, admin-only).
- `GET /leads/[id]/applications` — per-lead list (lead-tenant + branch-access verification, mirror `leads/[id]/check-ins`).
- `POST /leads/[id]/applications` — create from the lead page (lead is already a prospect; no promote).

## 6. UI surface

### A. Per-lead Applications tab — `src/components/dashboard/lead/lead-tabs.tsx`
- New `<TabsTrigger value="applications">` + `<TabsContent>` gated on
  `industryId === "education_consultancy" && lead.lead_type === "prospect"` (copy the travel `itinerary`
  conditional-tab pattern).
- `ApplicationsPanel` component: table of this lead's applications (University · Program · Intake · Country ·
  Status badge · Deadline) + **"Add Application"** sheet (university/program/intake/country → stage defaults
  to `shortlisted`). Inline stage advance via dropdown; `offer_type` + offer-letter upload surface at the
  offer stages. Reuse the existing file-upload util if one exists (check leads `file_urls`/storage); else
  store the URL as text in v1.
- `src/app/(main)/(dashboard)/leads/[id]/page.tsx` — fetch the lead's applications in parallel (alongside
  notes/checklists/activities) and pass through `LeadDetailV2` → `LeadTabs`.

### B. Global `/Applications` board — `src/industries/education-consultancy/features/application-tracking/`
- `meta.ts`, `pages/applications-workspace.tsx` (table + Kanban toggle; mirror `deals-workspace.tsx`),
  `components/` (applications-table, applications-board, application-card, add-application-sheet, status-badge).
- Board: columns = `application_stages` (color-coded), drag-to-advance via @dnd-kit (mirror `deal-board.tsx`).
  Each card: student name (link to `/leads/[id]`) · university · program · intake · deadline.
- Add Application here: pick a student (lead search) → POST `/applications` → auto-promotes to prospect.

### C. Wiring (industry-scoped gate, registry + 3 enforcement points)
1. `src/industries/_registry.ts` — add `APPLICATION_TRACKING: "application-tracking"` to `FEATURES` (under the education_consultancy group).
2. `.../features/application-tracking/meta.ts` — `{ id: FEATURES.APPLICATION_TRACKING, industries: [INDUSTRIES.EDUCATION_CONSULTANCY] }`.
3. `src/industries/education-consultancy/manifest.ts` — import the meta into `features[]`; add sidebar entry
   `{ featureId: FEATURES.APPLICATION_TRACKING, href: "/applications", label: "Applications", icon: "GraduationCap" }`.
4. `src/components/dashboard/shell.tsx` — add `GraduationCap` to the icon import block **and** to
   `INDUSTRY_ICONS` (else it silently falls back to `FileText`).
5. `src/app/(main)/(dashboard)/applications/page.tsx` — thin shell: `getCurrentUserTenant()` →
   `getFeatureAccess(...) → notFound()` → render the workspace.
6. `src/types/database.ts` — add `Application` + `ApplicationStage` row types.

## 7. Master task checklist (live tracker — nothing ships unchecked)

**B0 — Branch + brief (Opus)**
- [x] `git checkout -b feature/application-tracking origin/stage`
- [x] This brief written
- [ ] STATUS-BOARD entry added

**B1 — Database** (`057_application_tracking.sql`)
- [ ] `application_stages` table + RLS + `update_updated_at` trigger
- [ ] `applications` table (§4 fields) + soft-delete + indexes `(tenant_id,lead_id)`, `(tenant_id,stage_id)` `WHERE deleted_at IS NULL` + RLS
- [ ] Seed the 11 stage rows for existing `education_consultancy` tenants
- [ ] New-tenant stage provisioning handled OR gap logged on STATUS-BOARD (state which)
- [ ] `src/types/database.ts` — `Application` + `ApplicationStage` types
- [ ] Migration verified on local/throwaway DB (NOT shared Supabase) — tables, RLS select/insert, seed present

**B2 — API**
- [ ] `GET /api/v1/application-stages`
- [ ] `GET` + `POST /api/v1/applications` (POST auto-promotes lead → prospect)
- [ ] `GET` + `PATCH` + `DELETE /api/v1/applications/[id]` (PATCH syncs status↔stage; DELETE soft, admin-only)
- [ ] `GET` + `POST /api/v1/leads/[id]/applications` (lead-tenant + branch-access verification)
- [ ] Gate + scopedClient + counselor scoping + audit/event on every route

**B3 — Per-lead Applications tab**
- [ ] `ApplicationsPanel` component
- [ ] `lead-tabs.tsx` tab gated on `industryId==="education_consultancy" && lead.lead_type==="prospect"`
- [ ] `leads/[id]/page.tsx` parallel fetch + pass-through

**B4 — Global `/Applications` board**
- [ ] `FEATURES.APPLICATION_TRACKING` in `_registry.ts`
- [ ] `meta.ts`
- [ ] `pages/applications-workspace.tsx` (table + Kanban)
- [ ] `components/` (table, board, card, add-sheet w/ lead search → auto-promote, status-badge)
- [ ] `manifest.ts` register meta + sidebar item
- [ ] `shell.tsx` `GraduationCap` in imports + `INDUSTRY_ICONS`
- [ ] `applications/page.tsx` shell with gate

**B5 — Docs**
- [ ] `docs/FEATURE-CATALOG.md` row
- [ ] `docs/SESSION-LOG.md` dated entry
- [ ] `docs/STATUS-BOARD.md` on-stage-awaiting-review; carry the provisioning note if unresolved
- [ ] Archive this brief to `docs/archive/features/` once shipped

## 8. Verification (Sonnet runs; Opus re-runs the gates)

- `npm run build` clean **and** `npx eslint --max-warnings 50` clean (build-clean has red-deployed before).
- Local `npm run dev` smoke + migration on a local/throwaway DB **before any push** (dev+prod share ONE Supabase DB = prod-affecting).
- **Gate matrix** — education tenant (Admizz): `/applications` nav visible, page renders, Applications tab
  appears on a **prospect** lead + hidden on a plain lead, APIs 200. Non-education tenant: nav hidden,
  `/applications` 404s, APIs 403. Universal features (leads/pipeline/team/settings) unchanged on both.
- **Live API smoke** on throwaway Admizz data per the safe protocol (`@zunkiree.invalid` fakes, guarded
  cleanup): create lead → add application via global board → assert auto-promote to prospect → advance
  stages incl. `offer_type` + offer letter → soft-delete → cleanup. RLS: cross-tenant read returns nothing.
- **Pixel/visual smoke = Sadin.**

## 9. Out of scope (v1)
Stage editor UI (stages seeded read-only), per-country pipelines, deadline reminder automation, the Admizz
funnel dashboard (this feature provides the `status`/`stage` slugs it will later read).

---

## 11. Round 2 — Fixback (post-Opus-review, 2026-06-20)

Opus reviewed commit `592a901`. **Gates were green** (build exit 0; eslint 0 errors / 31 warnings under the
50 cap; migration NOT applied to shared DB; not pushed — stop-at-review respected). Migration + API +
wiring are sound. Three things to fix before this goes to `stage`, driven by Sadin's decisions:

**Sadin's decisions:** (1) application management must be available to counselors, admins, AND a custom
"Application Executive" position — i.e. a **configurable permission**, not hard-coded `requireAdmin`.
(2) The offer/financial **edit UI ships now**.

### Fix 1 — Configurable `canManageApplications` permission (replaces `requireAdmin` on all writes)

The Positions/RBAC system is a **fixed permission struct** (no generic key catalog). Add a new top-level
boolean, mirroring the existing `canEditLeads` precedent. Keep all layers in sync:

- **`src/lib/api/permissions.ts`:**
  - `PositionPermissions` → add `canManageApplications?: boolean;`
  - `ResolvedPermissions` → add `canManageApplications: boolean;`
  - `resolvePermissions()`: owner/admin → `true`; member **with** position → `position.canManageApplications === true`; member **without** position → counselor `true`, viewer `false`.
  - `validatePositionPermissions()` → add an optional-boolean block (copy `canEditLeads`).
  - Add helper `export function canManageApplications(p: ResolvedPermissions) { return p.canManageApplications; }`
- **`src/components/dashboard/settings/positions-manager.tsx`:** add a "Can manage applications" checkbox under the `base_tier === "member"` block; thread it through the local `PositionPermissions` interface + `buildDefaultForm` + `permissionsFromForm` + `formFromPosition` (mirror the "Can edit leads" checkbox exactly). This is what an admin toggles on for an "Application Executive" custom position.
- **New migration `058_application_manage_permission.sql`** (tracked, additive): set `canManageApplications = true` on the seeded **system Counselor** position (030) and **Branch Manager** position (053) JSONB via `jsonb_set`, so counselors/branch-managers assigned those system positions inherit it. Do NOT edit applied migrations.
- **API routes — replace `if (!requireAdmin(auth)) return apiForbidden();`** with the permission + parent-lead scope check on every write (`POST /applications`, `PATCH` + `DELETE /applications/[id]`, `POST /leads/[id]/applications`):
  1. `if (!canManageApplications(auth.permissions)) return apiForbidden();`
  2. **Parent-lead scope:** the actor may only write an application whose parent lead they can access under their `leadScope`. Reuse the exact gate the per-lead GET already runs: load the parent lead + `getLeadMembership(...)`, then for `shouldRestrictToSelf(auth.permissions)` require `lead.assigned_to === auth.userId || membership.some(m => m.assigned_to === auth.userId)`, and always `requireLeadBranchAccess(auth, lead, membership)`. Owner/admin/`leadScope:"all"` bypass. (`PATCH`/`DELETE /applications/[id]` currently load only the application — they must now also load the parent lead to run this check.)

### Fix 2 — Application detail/edit UI (ship now)

Currently an application can only be created + stage-advanced + deleted; `offer_type`, `offer_letter_url`,
`application_fee_paid`, `tuition_fee`, `deposit_paid`, `notes` (and typo fixes to university/program/intake/
country/deadline) have schema + PATCH support but **no UI**. Add an **application detail/edit sheet**:

- New component (e.g. `application-detail-sheet.tsx`) opened from a row in `ApplicationsPanel` (per-lead) and a card in the global board. Fields: university, program, intake, country, deadline, **offer_type (Conditional/Unconditional select — surface prominently once stage ≥ `conditional_offer`)**, **offer_letter_url (plain URL text input in v1)**, application_fee_paid (checkbox), tuition_fee (number), deposit_paid (checkbox), notes (textarea). Saves via `PATCH /api/v1/applications/[id]`.
- Gate all edit controls (and the existing Add/stage-advance/delete) behind `canManageApplications` passed down from the page/tab, instead of `isAdmin`. Counselors/executives with the permission see the controls; others get the read-only view.
- (Fast-follow, NOT this round: swap the offer-letter URL field for a real upload via the existing `/api/v1/upload` signed-URL flow into the `lead-documents` bucket. Log on STATUS-BOARD.)

### Fix 3 — Global board fetch must respect lead scope

`src/app/(main)/(dashboard)/applications/page.tsx` currently fetches **all** tenant applications via the
service client, so a counselor sees every student's applications (bypasses the scoping the GET API applies).
Scope the SSR fetch by the actor's `leadScope`: for `shouldRestrictToSelf`/own, restrict to applications
whose `lead_id` is in the actor's own/assigned + branch-member lead set (mirror `leadQueryScope` / the
per-lead GET logic). Owner/admin/`all` → unchanged.

### Fix 4 — Minor: PATCH must preserve POST invariants

In `PATCH /applications/[id]`, `university_name` and `program_name` are NOT NULL + required-on-POST, but the
patch loop allows `?? null` → DB 500. Reject empty/whitespace/null for those two on PATCH with a clean
validation error (and trim). (STATUS-BOARD code-review rule: "PATCH preserves POST invariants.")

### Round-2 gate (same stop-at-review rules)
- `npm run build` clean + `npx eslint --max-warnings 50` clean — paste real output.
- Migration `058` verified on a LOCAL/throwaway DB only — NOT applied to shared Supabase.
- Commit to `feature/application-tracking` only — no push, no PR, no promotion.
- Re-verify the gate matrix incl. a member with an "Application Executive" position (canManageApplications on) able to add/edit; a viewer read-only; a counselor scoped to own leads on the board.

---

## 10. Sonnet handoff prompt (copy-paste)

```
You are implementing the "Application Tracking" feature for the edgeX CRM, industry-scoped to
education_consultancy. The full brief is docs/APPLICATION-TRACKING-BRIEF.md — read it completely first,
then read the Deals feature it mirrors (src/industries/it-agency/features/deals/, supabase/migrations/046_deals.sql,
src/app/(main)/api/v1/deals/) and the travel itinerary tab pattern in src/components/dashboard/lead/lead-tabs.tsx.

You are ALREADY on branch feature/application-tracking (off origin/stage). Do all work here.

Build B1 → B2 → B3 → B4 → B5 in order, checking off the §7 task list in the brief as you go. Key rules:
- An application is a CHILD of a lead (lead_id FK); one student → many applications. Mirror Deals patterns,
  NOT the deals table.
- Migration is 057_application_tracking.sql — tracked, additive, idempotent, with RLS (get_user_tenant_ids /
  is_tenant_admin) and the 11 seeded stages for existing education_consultancy tenants. Handle (or log on
  STATUS-BOARD) the new-tenant stage-provisioning gap.
- Every API route: authenticateRequest → getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING) →
  apiForbidden, then scopedClient(auth); writes requireAdmin; counselors scoped to their own leads'
  applications; audit + event on writes.
- POST /applications auto-promotes the target lead to lead_type='prospect' if not already (audit-logged).
- Per-lead Applications tab shows only when industryId==='education_consultancy' && lead.lead_type==='prospect'.
- Add GraduationCap to BOTH the icon imports and INDUSTRY_ICONS in shell.tsx.
- Register FEATURES.APPLICATION_TRACKING in _registry.ts AND the education manifest features[] AND sidebar[].

STOP AT REVIEW. This is a hard gate:
- Commit to feature/application-tracking ONLY. Do NOT push to stage. Do NOT open/merge a PR.
- Do NOT apply the migration to the shared Supabase DB. Verify it on a LOCAL/throwaway DB only.
- Run `npm run build` and `npx eslint --max-warnings 50` and paste the real output.
- Then hand back for Opus review. Do not promote anything.
```
