# APPLICATIONS BATCH — Build Brief · for Sonnet, STOP-AT-REVIEW

**Branch:** create `feature/applications-polish` off the **latest `origin/stage`** (fetch first). Work only there.
**Scope:** `education_consultancy` Application Tracking feature only. Gate everything new on `FEATURES.APPLICATION_TRACKING` + `canManageApplications` where it mutates. Other industries unaffected.
**Feature lives at:** `src/industries/education-consultancy/features/application-tracking/`. API: `src/app/(main)/api/v1/applications/`.

---

## 🛑 HARD GUARDRAILS
1. **STOP AT REVIEW.** Build, commit, report. No `git push`, no PR, no merge.
2. **Item B has a migration — FILE ONLY, DO NOT APPLY** (no psql/Supabase MCP). Opus applies it to the shared DB after review, with Sadin's GO.
3. Commit in **logical commits**: `A` (form restyle), `B` (agents + dates: migration file + API + settings + form/detail wiring), `C` (card click), `D` (rail fix). Keep them separate so each is reviewable.
4. Before reporting: `npm run build` + `npx eslint --max-warnings 50`, both clean (0 errors, ≤50 warnings). Paste outputs. (Note: the true warning count is ~26 — don't report inflated numbers.)
5. Don't touch the shared `ContactCard` component for item D (it's used by the leads rail too) — fix the layout on the applications side.

---

## Item A — Restyle the New Application form
**File:** `src/industries/education-consultancy/features/application-tracking/components/add-application-sheet.tsx`.
Match the **Add Lead** sheet's look (`src/components/dashboard/add-lead-sheet.tsx`):
- Sheet width `sm:max-w-xl`; body as a flex column with a scrollable middle and the footer (Cancel / Create) pinned at the bottom (mirror Add Lead's structure).
- **Section headers** (`<h3 className="text-sm font-medium text-gray-900">`): e.g. **"Student"**, **"Application Details"** (University, Program, Intake Term, Country, Stage, Deadline), **"Agent & Dates"** (the new B fields).
- **Small muted labels** (`<Label className="text-xs text-gray-600">`) everywhere.
- **Two-column grid** (`grid grid-cols-2 gap-4`) for paired fields (University/Program, Intake/Country, Stage/Deadline, Applied date/Intake-start date).
- Keep all existing fields + behavior (student search, required validation, POST payload). Pure presentation + the new B fields.

## Item B — Agents (tenant-managed list) + application dates
### B1 — Migration FILE only `supabase/migrations/061_agents_and_application_dates.sql` (DO NOT APPLY)
- **New `agents` table** (mirror RLS pattern from 057/059):
  ```
  id UUID PK default gen_random_uuid()
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
  name TEXT NOT NULL
  agent_type TEXT NOT NULL DEFAULT 'agent' CHECK (agent_type IN ('agent','super_agent'))
  is_active BOOLEAN NOT NULL DEFAULT true
  created_at/updated_at TIMESTAMPTZ default now()
  UNIQUE (tenant_id, name)
  ```
  RLS: SELECT `get_user_tenant_ids()`; INSERT/UPDATE/DELETE `is_tenant_admin(tenant_id)`. `update_updated_at` trigger. Index `(tenant_id)`.
- **`applications` additive columns:**
  - `agent_id UUID REFERENCES agents(id) ON DELETE SET NULL`
  - `applied_date DATE`
  - `intake_start_date DATE`
- Header comment + rollback block. **No seed** (agents are tenant-created). Additive only.

### B2 — Agents API `src/app/(main)/api/v1/agents/route.ts` + `[id]/route.ts`
- `GET` (active agents for the tenant, for the form dropdown + manager), `POST` (create), `PATCH`/`DELETE` (`[id]`).
- All gated: `authenticateRequest()` → `getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)` else `apiForbidden()`; mutations `requireAdmin`. Use `scopedClient(auth)`. Validate `agent_type ∈ {agent, super_agent}`.

### B3 — Settings ▸ Agents manager
- New `src/components/dashboard/settings/agents-manager.tsx`, modeled on `lead-lists-manager.tsx` (self-contained, client-side fetch). CRUD rows: name + type (Agent / Super-Agent) + active toggle.
- Mount in `src/app/(main)/(dashboard)/settings/page.tsx`, **feature-gated**: `getFeatureAccess(tenantData.tenant.industry_id, FEATURES.APPLICATION_TRACKING) && <AgentsManager />` (settings page is already admin-gated).

### B4 — Wire fields into the application forms + API + detail
- **New Application form** (`add-application-sheet.tsx`) and **Add-application-from-lead** (`add-application-to-lead-sheet.tsx`): add an **Agent** select (options from `GET /api/v1/agents`, show name + type; allow "None"), an **Applied date** (`type="date"`), and an **Intake/Start date** (`type="date"`). Include them in the POST payload.
- **Create allowlist** — `src/app/(main)/api/v1/applications/route.ts` POST insert block (~lines 170–188): add `if (body.agent_id) … / if (body.applied_date) … / if (body.intake_start_date) …`.
- **Update allowlist** — `src/app/(main)/api/v1/applications/[id]/route.ts` PATCH `updatable` array (~lines 122–135): add `agent_id`, `applied_date`, `intake_start_date`.
- **Detail page Details panel** (`pages/application-detail.tsx`): show + inline-edit Agent, Applied date, Intake/Start date alongside the existing detail fields (follow the existing editable-details pattern there).
- (Don't clutter the board card with the new dates — detail panel is enough.)

## Item C — Whole application card opens the detail page
**File:** `components/application-card.tsx`. Today only the small `ExternalLink` icon opens `/applications/[id]`.
- Make the **whole card** open the detail: add `onClick` on the card root that calls `onOpenDetail?.(application)` (the board already passes `onOpenDetail` → `router.push('/applications/[id]')`). Keep the existing **student-name `<Link>`** to `/leads/[id]` with its `e.stopPropagation()` (so clicking the name still goes to the lead). The `ExternalLink` icon can stay or be removed (your call — but card-click must work).
- **Preserve drag:** the card is a dnd-kit `useSortable` draggable; the sensor uses `activationConstraint: { distance: 5 }`, so a click that doesn't move ≥5px won't start a drag and the `onClick` fires. Verify drag-to-reorder still works after adding `onClick`.
- A11y: give the card `role="button"`, `tabIndex={0}`, and Enter/Space handling to open detail.

## Item D — Fix action-icons overflow in the application detail rail
**Cause:** the shared `ContactCard` icon row (Note/Email/Call/Task/More) is ~264px wide (5× `h-10 w-10` + `gap-4`), but the application detail **left rail is only 240px** (`pages/application-detail.tsx`, the `lg:grid-cols-[240px_1fr_280px]` grid).
- **Fix on the applications side only:** widen the left rail track so the shared `ContactCard` fits (e.g. `240px` → `~290px`; pick a value that fits the icon row without overflow, matching how roomy the leads rail is). **Do NOT modify `src/components/dashboard/lead/contact-card.tsx`** (shared with leads).

---

## Reuse / reference
- Form styling target: `src/components/dashboard/add-lead-sheet.tsx` (sections, muted labels, grid, sticky footer).
- Settings manager template: `src/components/dashboard/settings/lead-lists-manager.tsx` (+ its API shape).
- Migration/RLS pattern: `057_application_tracking.sql`, `059_lead_lists.sql`.
- App API allowlists: `applications/route.ts` POST insert block; `applications/[id]/route.ts` `updatable` array.
- Card: `components/application-card.tsx`; board passes `onOpenDetail` from `applications-board.tsx`.

## Self-check before reporting
- [ ] New Application form visually matches Add Lead (sections, muted labels, 2-col, sticky footer); all existing fields still submit.
- [ ] Agents: migration FILE present (NOT applied); `/api/v1/agents` CRUD admin-gated + feature-gated; Settings ▸ Agents manager works; agent + both dates selectable on create and editable on detail; create/update allowlists include the 3 fields.
- [ ] Clicking anywhere on a board card opens `/applications/[id]`; student-name still opens the lead; drag-to-reorder still works; keyboard-openable.
- [ ] Application detail action-icons row no longer overflows; `ContactCard` untouched; leads rail unaffected.
- [ ] build + eslint clean. Commits A/B/C/D separate. Migration not applied. No push/PR. Then STOP and report (files, decisions, gate outputs).

## Hand back to Opus
Commit, stop. Opus re-runs gates, reviews, applies migration 061 with Sadin's GO, Sadin verifies on local dev, then merge.
