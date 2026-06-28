# CLASSES — Build Brief · for Sonnet, STOP-AT-REVIEW

**Branch:** create `feature/classes` off the **latest `origin/stage`**. Work only on that branch.
**Scope:** `education_consultancy` only. it_agency / travel_agency / every other industry must stay **byte-for-byte unaffected**.
**Pattern source:** Classes is a near-clone of **Application Tracking**. Wherever this brief is vague, copy the equivalent Applications file and adapt. Key reference files are listed in **Reuse** at the bottom.
**DB target:** **STAGE only** (`dymeudcddasqpomfpjvt`). The migration FILE is committed for a later prod replay — do **NOT** touch prod.

---

## 🛑 HARD GUARDRAILS — read first
1. **STOP AT REVIEW.** Build, commit to the branch, then **STOP and report**. Do **NOT** `git push`, open a PR, or merge. Opus reviews + re-runs gates + verifies the DB independently.
2. **Migration goes to STAGE only**, applied **inside a transaction with before/after counts** (additive-only, `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`). No prod. No `DROP`/`DELETE` of existing data.
3. Commit in the **Part order below** as separate, reviewable commits.
4. Before reporting, run and paste output of `npm run build` **and** `npx eslint --max-warnings 50`. Both must be clean (≤50 warnings, 0 errors).
5. Everything is **industry-gated to education_consultancy**. Verify a non-education tenant sees no sidebar item, gets 404 on `/classes`, and 403 from the APIs.

---

## Concept (read once, then build)

Two tables, two roles — exactly the Applications split:

| Layer | Applications equivalent | Classes table | What it is |
|---|---|---|---|
| **Catalog (config)** | `application_stages` | **`classes`** | the courses Admizz offers (IELTS Prep, PTE, SAT…), managed in **Settings ▸ Classes** |
| **Per-lead record** | `applications` | **`class_enrollments`** | a lead enrolled in a class, with `fee_paid` + `fee_amount` |

- **NO stages / NO kanban.** Classes is flat. The nav is a roster grouped by class.
- **Activation gate (lead right rail):** `ClassesCard` shows when the lead is **Qualified or beyond** (qualified / prospects / applications lists; hidden in Pre-qualified & any archive list). This brief ALSO converts the existing `ApplicationsCard` gate to the same list-position model (**Prospects or beyond**) — see Part 6.
- **Fee:** `fee_paid` boolean + `fee_amount NUMERIC` only. No paid-date / no currency.
- **Default fee:** a class may carry a `default_fee` that **pre-fills** (but does not lock) the amount in the enroll dialog.
- **One active enrollment per (lead, class)** — enforced by a partial unique index.

---

## PART 1 — Migration `065_classes.sql`

Create `supabase/migrations/065_classes.sql`. Mirror `057_application_tracking.sql` style (RLS shape, `update_updated_at` trigger, partial indexes). Wrap in `BEGIN; … COMMIT;`.

### 1a. `classes` catalog
```
id           UUID PK DEFAULT gen_random_uuid()
tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
name         TEXT NOT NULL
default_fee  NUMERIC(14,2)               -- nullable
is_active    BOOLEAN NOT NULL DEFAULT true
created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
UNIQUE (tenant_id, name)
```
- Index: `idx_classes_tenant ON classes (tenant_id)`.
- RLS (mirror `application_stages`): SELECT = `tenant_id IN (SELECT get_user_tenant_ids())`; INSERT/UPDATE/DELETE = `is_tenant_admin(tenant_id)`.
- `update_updated_at` trigger (reuse the existing trigger function used by 057).

### 1b. `class_enrollments`
```
id           UUID PK DEFAULT gen_random_uuid()
tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
class_id     UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE
lead_id      UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE
fee_paid     BOOLEAN NOT NULL DEFAULT false
fee_amount   NUMERIC(14,2)              -- nullable
notes        TEXT
created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
deleted_at   TIMESTAMPTZ               -- soft delete (un-enroll)
```
- Partial indexes (all `WHERE deleted_at IS NULL`):
  - `CREATE UNIQUE INDEX uniq_class_enrollment_active ON class_enrollments (tenant_id, lead_id, class_id) WHERE deleted_at IS NULL;` ← the "one active enrollment per (lead, class)" rule.
  - `idx_class_enroll_tenant_class ON (tenant_id, class_id) WHERE deleted_at IS NULL`
  - `idx_class_enroll_tenant_lead ON (tenant_id, lead_id) WHERE deleted_at IS NULL`
- RLS (mirror `applications`): SELECT = tenant membership; INSERT/UPDATE/DELETE = `is_tenant_admin(tenant_id)`.
- `update_updated_at` trigger.
- **No counselor `assigned_to` column** — counselor scoping derives from the parent **lead's** `assigned_to` (see Part 4 GET).

### 1c. `canManageClasses` permission seed (mirror `058`)
```sql
UPDATE positions
SET permissions = jsonb_set(permissions, '{canManageClasses}', 'true')
WHERE slug IN ('counselor','branch-manager')
  AND tenant_id IN (SELECT id FROM tenants WHERE industry_id = 'education_consultancy');
```
(owner/admin get write access implicitly via the role check in the resolver — see Part 2.)

### 1d. Do NOT seed any classes
The catalog starts empty; admins add classes in Settings. (Note for reviewers: same "new tenants created later aren't auto-seeded" gap that all these features share — out of scope here.)

**Apply to stage** in a txn, paste before/after: `SELECT count(*) FROM classes;` `SELECT count(*) FROM class_enrollments;` and the `positions` rows showing `canManageClasses=true` for the two education positions.

---

## PART 2 — Permissions plumbing

In `src/lib/api/permissions.ts` (model on the existing `canManageApplications` machinery):
1. Add `canManageClasses?: boolean` to the permissions interface/type.
2. Add it to the per-role defaults (owner/admin → true; counselor/branch-manager pick up the seeded value; viewer → false), matching how `canManageApplications` is defaulted/resolved.
3. Export a `canManageClasses(permissions)` helper mirroring `canManageApplications`.
4. Include it in whatever validator/allowlist controls which permission keys positions may set (so the Positions Manager can toggle it).

---

## PART 3 — Feature registration

1. `src/industries/_registry.ts`: add `CLASSES: "classes"` to `FEATURES` (in the education-scoped block, next to `APPLICATION_TRACKING`).
2. Create `src/industries/education-consultancy/features/classes/meta.ts`:
   ```ts
   import { FEATURES, INDUSTRIES } from "../../../_registry";
   import type { FeatureMeta } from "../../../_types";
   export const classesMeta: FeatureMeta = {
     id: FEATURES.CLASSES,
     industries: [INDUSTRIES.EDUCATION_CONSULTANCY],
   };
   ```
3. `src/industries/education-consultancy/manifest.ts`: import `classesMeta`, push `{ meta: classesMeta }` onto `features[]`, and add a sidebar entry **after** the Applications one:
   ```ts
   { featureId: FEATURES.CLASSES, href: "/classes", label: "Classes", icon: "BookOpen" },
   ```
4. `src/components/dashboard/shell.tsx`: ensure `"BookOpen"` is registered in `INDUSTRY_ICONS` (add the lucide import + map entry if missing). **Icon is a string in the manifest — never a component import.**

---

## PART 4 — API routes

All routes: `authenticateRequest()` → `getFeatureAccess(auth.industryId, FEATURES.CLASSES)` else `apiForbidden()`. Use `scopedClient(auth)` for tenant queries where practical; otherwise `createServiceClient()` **with** explicit `.eq("tenant_id", auth.tenantId)` (match how the Applications routes do it). Writes also require `canManageClasses(auth.permissions)`.

### 4a. Catalog — `src/app/(main)/api/v1/classes/route.ts`
- **GET**: read gate. Return catalog rows ordered by `name`. `?all=true` includes inactive; default `is_active=true` only. **Attach an `enrollmentCount`** per class (active, `deleted_at IS NULL`) — mirror how `lead-lists` GET attaches per-list lead counts.
- **POST**: gate + `canManageClasses`. Fields: `name` (required), `default_fee` (optional number ≥ 0), `is_active` (default true). Handle unique-violation `23505` → friendly "A class with that name already exists." Audit log + emit `class.created`.

### 4b. Catalog item — `src/app/(main)/api/v1/classes/[id]/route.ts`
- **PATCH**: gate + `canManageClasses`. Updatable: `name`, `default_fee`, `is_active`. Tenant-scope check.
- **DELETE**: gate + `canManageClasses`. **409 if it has any active enrollment** (mirror the lead-lists non-empty 409 message). Hard delete only when empty.

### 4c. Enrollments (nav) — `src/app/(main)/api/v1/class-enrollments/route.ts`
- **GET**: read gate. Filters: `class_id`, `lead_id`. Join `classes` (name) + `leads` (display name, `assigned_to`). Exclude `deleted_at IS NOT NULL`. **Counselor scoping**: mirror Applications GET — when `shouldRestrictToSelf(auth)`, restrict to enrollments whose **parent lead** is assigned to `auth.userId`.
- **POST** (enroll from the Classes nav, student picked via search): gate + `canManageClasses`. Fields: `lead_id` (required), `class_id` (required), `fee_paid` (bool, default false), `fee_amount` (number, nullable), `notes` (optional).
  - Validate class belongs to tenant and `is_active`. Validate parent lead in tenant + branch access (`requireLeadBranchAccess` / `getLeadMembership`, same as Applications POST).
  - Reject duplicate active enrollment (the partial unique index will also catch it → return a friendly 409).
  - **Auto-move side effect (mirror Applications' auto-promote-to-prospect):** if the lead's current list is below Qualified (NULL/`pre-qualified`, i.e. sort_order < the Qualified system list's sort_order), **move it to the tenant's Qualified list** — set `leads.list_id` to the Qualified list and write the human-readable activity row (`changes.list = {old, new}`) exactly like the lead-lists move path (Phase 2). Do **not** touch `lead_type` (that flips only at Prospects). If the lead is already Qualified+, no move.
  - Audit log + emit `class.enrolled`.

### 4d. Enrollment item — `src/app/(main)/api/v1/class-enrollments/[id]/route.ts`
- **GET** (read gate, scope check), **PATCH** (gate + canManage; updatable `fee_paid`, `fee_amount`, `notes`), **DELETE** (gate + canManage; **soft delete** via `deleted_at = now()` = un-enroll).

### 4e. Lead-scoped — `src/app/(main)/api/v1/leads/[id]/classes/route.ts` (mirror `leads/[id]/applications`)
- **GET**: enrollments for that one lead (join class name), excluding deleted.
- **POST** (enroll from the lead right-rail): same insert shape as 4c **minus the auto-move** (the rail only shows for Qualified+ leads, so they're already in the funnel). Returns 201.

---

## PART 5 — Settings ▸ Classes manager

Clone `src/components/dashboard/settings/agents-manager.tsx` → `classes-manager.tsx`:
- List rows from `GET /api/v1/classes?all=true`: name, `default_fee` (formatted, "—" if null), Active/Inactive badge.
- **+ Add class** / **Edit** shared `<Dialog>`: **Name*** (Input), **Default fee** (number Input, optional), **Active** (toggle — inline like agents `is_active`). Save → `POST /api/v1/classes` or `PATCH /api/v1/classes/[id]`.
- **Delete**: `confirm()` → `DELETE`; surface the 409 "has enrollments" message cleanly.
- Mount in `src/app/(main)/(dashboard)/settings/page.tsx` behind `getFeatureAccess(tenant.industry_id, FEATURES.CLASSES)` (same shape as the Agents manager mount, `id="classes"` on the Card). `sonner` toasts throughout.

---

## PART 6 — Classes nav page + roster

### 6a. Route shell — `src/app/(main)/(dashboard)/classes/page.tsx`
Server component. Mirror `applications/page.tsx`:
- `getFeatureAccess(tenant.industry_id, FEATURES.CLASSES)` else `notFound()`.
- Build the accessible-lead-id scope set the same way the Applications page does (`leadQueryScope` + `leadIdsVisibleToAssignee` / `leadIdsForBranch`) so counselors/branch users only see their own.
- Fetch the catalog (with counts) + enrollments (scoped) and render `<ClassesWorkspace>` passing `canManage`.

### 6b. `src/industries/education-consultancy/features/classes/pages/classes-workspace.tsx` (client)
Master–detail (NOT a kanban):
- **Left**: class list ordered by name, each row = name + enrolled count badge; selecting one sets the active class. A "Manage classes →" link (admin) deep-links to `/settings#classes`.
- **Right**: roster table for the selected class — columns **Student · Fee (Paid/Unpaid + amount) · Enrolled date · Counselor**. Student row → `Link` to the lead detail page. Empty state when a class has no enrollments.
- **[ Enroll student ]** button (only if `canManage`) opens `<EnrollStudentSheet>` (with debounced student search via `/api/v1/leads?search=` like `add-application-sheet.tsx`). On success, refresh the roster.

### 6c. Enroll sheets (`features/classes/components/`)
- `enroll-student-sheet.tsx` (nav): student search (required) + class select (defaults to the currently-selected class, still editable) + **Fee paid? toggle** + **Amount** (shown only when paid; pre-filled from the class's `default_fee`) + optional notes → `POST /api/v1/class-enrollments`.
- `add-enrollment-to-lead-sheet.tsx` (lead rail): `leadId` prop (no student search) + class select + same fee toggle/amount/notes → `POST /api/v1/leads/{leadId}/classes`.

---

## PART 7 — Lead right rail: `ClassesCard` + unify both gates

### 7a. Compute funnel position in the lead-detail server page
Wherever `lead-detail-v2.tsx` is rendered from (its server page/loader), resolve the lead's **current list** and the tenant's system lists, then pass two booleans as props:
- `classesActive` = lead's current list is **non-archive** AND `sort_order >= (Qualified list).sort_order`.
- `applicationsActive` = (lead's current list is non-archive AND `sort_order >= (Prospects list).sort_order`) **OR** `lead.lead_type === "prospect"` (belt-and-suspenders for legacy prospects).
- If `list_id` is NULL → both false.

Resolve the Qualified/Prospects thresholds by **slug** from the tenant's `lead_lists` (don't hardcode `sort_order` numbers — list order is renumberable; we just renumbered them in mig 064).

### 7b. Rewire the right column in `src/components/dashboard/lead/lead-detail-v2.tsx` (~line 676)
Current: `lead_type === "prospect" ? <ApplicationsCard/> : <ManagementPanel/>`. Change to use the new props, **education-gated**:
- `applicationsActive` → render `<ApplicationsCard/>`; else `<ManagementPanel/>` (unchanged behavior, just keyed off the list instead of `lead_type`).
- **Additionally** render `<ClassesCard/>` (stacked) when `classesActive`. So: Qualified ⇒ ManagementPanel + ClassesCard; Prospects+ ⇒ ApplicationsCard + ClassesCard.
- Non-education tenants: no change at all (skip both new branches; keep today's behavior).

### 7c. `ClassesCard` — `features/classes/components/classes-card.tsx`
Clone `applications-card.tsx`: on mount fetch `GET /api/v1/leads/{leadId}/classes`; render a count badge + each enrollment (class name, Paid/Unpaid badge, amount). `canManage` shows a "+" opening `add-enrollment-to-lead-sheet.tsx`. Allow toggling fee paid / un-enroll inline via `PATCH`/`DELETE /api/v1/class-enrollments/{id}` (small menu or buttons), then refetch.

---

## Reuse (don't reinvent) — copy these and adapt
- Migration shape / RLS / triggers: `supabase/migrations/057_application_tracking.sql`, permission seed: `058_application_manage_permission.sql`.
- Permissions machinery + `canManageApplications` helper: `src/lib/api/permissions.ts`.
- API routes: `src/app/(main)/api/v1/applications/route.ts` + `[id]/route.ts`, `src/app/(main)/api/v1/leads/[id]/applications/route.ts`, `agents/route.ts` (catalog CRUD + role gate). Counselor scoping: `shouldRestrictToSelf`, `leadQueryScope`, `leadIdsVisibleToAssignee`, `leadIdsForBranch`. Branch access: `requireLeadBranchAccess`, `getLeadMembership`. Catalog-delete-409 pattern: `lead-lists/[id]/route.ts`.
- List-move activity wording (for the auto-move): the Phase-2 list-move path in `PATCH /api/v1/leads/[id]/route.ts` (writes `changes.list = {old,new}`) + `getSystemActivityDescription` in `activities-panel.tsx`.
- Settings manager: `src/components/dashboard/settings/agents-manager.tsx` + its mount in `settings/page.tsx`.
- Workspace/nav + lead-id scope build: `src/industries/education-consultancy/features/application-tracking/pages/applications-workspace.tsx` + `app/(main)/(dashboard)/applications/page.tsx`.
- Lead rail card + create sheets: `applications-card.tsx`, `add-application-sheet.tsx` (student search), `add-application-to-lead-sheet.tsx` (lead context).
- Sidebar icon registry: `INDUSTRY_ICONS` in `shell.tsx`.

---

## Self-check before reporting (paste results)
- [ ] `npm run build` clean · `npx eslint --max-warnings 50` clean.
- [ ] Migration 065 applied to **stage only**, in a txn, with before/after counts pasted. No prod. No DROP/DELETE.
- [ ] Education-gated everywhere: as an education tenant the Classes sidebar item shows, `/classes` renders, APIs 200; as a non-education tenant the item is hidden, `/classes` 404s, APIs 403.
- [ ] `ClassesCard` shows on Qualified/Prospects/Applications leads, hidden on Pre-qualified & Archived. `ApplicationsCard` still shows for Prospects+ (now list-gated) — verify a prospect still sees it (no regression).
- [ ] Enroll from nav auto-moves a Pre-qualified lead to Qualified (one clean "Moved from … to Qualified" activity row); enroll from the rail does not move.
- [ ] Fee toggle: amount appears only when "paid", pre-fills from class `default_fee`. Can't double-enroll same (lead, class).
- [ ] it_agency / travel_agency leads & lead-detail rail unchanged.
- [ ] Report: what you built, files touched, decisions, the two gate outputs + migration counts. Then **STOP**.

## Hand back to Opus
Commit (commit-msg hook rewrites co-author), stop. Opus re-runs both gates, reviews the diff, verifies the stage DB independently (tables/RLS/counts/isolation), then pushes + PRs to stage.
