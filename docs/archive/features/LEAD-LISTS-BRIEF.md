# LEAD LISTS — Build Brief (Phase 1) · for Sonnet, STOP-AT-REVIEW

**Branch:** `feature/lead-lists` (already created off `origin/stage @ 4b23916`). Work only here.
**Scope:** `education_consultancy` only. `it_agency` and all other industries must be byte-for-byte unaffected.
**Full design + rationale:** `/Users/sadinshrestha/.claude/plans/now-what-we-need-enchanted-parrot.md` (read it). This brief is the executable subset = **Phase 1 only**.

---

## 🛑 HARD GUARDRAILS — read first

1. **STOP AT REVIEW.** Implement Phase 1, commit to `feature/lead-lists`, then **STOP and report**. Do **NOT** `git push`, open a PR, or merge anything.
2. **DO NOT APPLY THE MIGRATION.** Write the migration **file** only (`supabase/migrations/0XX_lead_lists.sql`). **Do NOT** run it — not via Supabase MCP, not via psql, not via any tool. The dev+prod Supabase DB is **shared and prod-affecting**; Sadin applies it manually after Opus review.
3. **DO NOT touch existing data.** No `DELETE`, no `DROP`, no `UPDATE` against the live DB. The migration must be **strictly additive** (CREATE TABLE / ADD COLUMN / CREATE INDEX / INSERT-seed / backfill-UPDATE-of-new-column-only).
4. **DO NOT do Phase 2 or Phase 3.** No Create-form fields, no qualify flow, no list-management UI, no counsellor cleanup, no provisioning wiring. Those are later briefs.
5. Before reporting, run and paste output of: `npm run build` **and** `npx eslint --max-warnings 50`. Both must be clean. Do not self-merge or claim done without both.

---

## What Phase 1 delivers
Lead Lists exist; every education lead lives in exactly one list; the sidebar shows them; you can filter by list and move a lead between lists. That's it.

### 1. Migration `supabase/migrations/0XX_lead_lists.sql` (file only — DO NOT RUN)
Use the next sequential number. Mirror RLS patterns from `030_positions.sql` / `057_*`.

**`lead_lists` table:**
```
id UUID PK default gen_random_uuid()
tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
name TEXT NOT NULL
slug TEXT NOT NULL
sort_order INT NOT NULL DEFAULT 0
is_system BOOLEAN NOT NULL DEFAULT false
is_archive BOOLEAN NOT NULL DEFAULT false
is_intake BOOLEAN NOT NULL DEFAULT false
color TEXT
access JSONB NOT NULL DEFAULT '{"mode":"all"}'::jsonb
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
UNIQUE (tenant_id, slug)
```
RLS: enable; SELECT policy via `get_user_tenant_ids()`; INSERT/UPDATE/DELETE via `is_tenant_admin(tenant_id)`. Add `updated_at` trigger if the repo has a shared one (check `030`/`057`).

**`leads` additive columns** (all nullable / defaulted — additive only):
- `list_id UUID REFERENCES lead_lists(id) ON DELETE SET NULL`
- `destinations TEXT[] NOT NULL DEFAULT '{}'`
- `field_of_study TEXT`
- `degree_level TEXT`
- `archive_reason TEXT`
- Index `CREATE INDEX ... ON leads (tenant_id, list_id)`.

**Seed (education tenants only):** for each tenant where `industry_id = 'education_consultancy'`, insert the 4 system lists (idempotent — guard with `ON CONFLICT (tenant_id, slug) DO NOTHING`):
| name | slug | sort_order | flags |
|---|---|---|---|
| Pre-qualified | `pre-qualified` | 1 | `is_intake=true` |
| Qualified | `qualified` | 2 | — |
| Prospects | `prospects` | 3 | — |
| Archived | `archived` | 4 | `is_archive=true` |
All `is_system=true`, `access='{"mode":"all"}'`.

**Backfill (new column only):** `UPDATE leads SET list_id = (Prospects list of its tenant) WHERE list_id IS NULL AND lead_type='prospect' AND tenant of education`; then `... = (Pre-qualified list) WHERE list_id IS NULL AND <education tenant>`. Only writes `list_id`; never touches other fields. Non-education leads stay `list_id=NULL`.

> Include a short reversible-rollback comment block at top (drop columns/table). Note in the file header: "ADDITIVE ONLY — apply manually after review."

### 2. Feature scaffold
- `src/industries/education-consultancy/features/lead-lists/meta.ts` → `leadListsMeta` with `id: FEATURES.LEAD_LISTS, industries: [INDUSTRIES.EDUCATION_CONSULTANCY]`.
- Add `LEAD_LISTS: "lead-lists"` to `FEATURES` in `src/industries/_registry.ts`.
- Register `{ meta: leadListsMeta }` in `education-consultancy/manifest.ts` `features[]`.

### 3. AuthContext.positionId
- In `src/lib/api/auth.ts`, add `positionId: string | null` to `AuthContext` and populate it from `tenant_users.position_id` (it's already fetched for permission resolution — thread it through). Needed for per-list access checks.

### 4. Lists API — `src/app/(main)/api/v1/lead-lists/route.ts` + `[id]/route.ts`
- All handlers: `authenticateRequest()` → `getFeatureAccess(auth.industryId, FEATURES.LEAD_LISTS)` else `apiForbidden()` → use `scopedClient(auth)`.
- `GET` — returns lists **visible to the caller** (owner/admin see all; member sees `access.mode==="all"` OR `auth.positionId ∈ access.positionIds`), ordered by `sort_order`, **each with a `count`** of leads in that list within the caller's lead scope (respect `leadQueryScope` so a counselor's counts reflect own-leads). Return via `apiSuccess`.
- `POST` (admin only via `requireAdmin`) — create custom list (name, sort_order, color, access). slug = slugify(name)+uniqueness. `is_system=false`.
- `PATCH `[id]`` / `DELETE [id]` (admin) — edit/reorder/delete; **block delete/slug-change on `is_system`**; block delete if any lead has that `list_id` (return a clear 409). On delete of a non-empty custom list — disallow for Phase 1 (require it be empty).
- Validate `access` shape: `{"mode":"all"}` | `{"mode":"allow","positionIds": string[]}`.

### 5. Leads GET list filter
- `src/app/(main)/api/v1/leads/route.ts` GET + SSR `getLeads` in `src/lib/supabase/queries.ts`: accept a `list` (slug) param. Resolve slug→list_id within tenant; **enforce access** (caller must be able to see that list else 403/empty); `.eq("list_id", id)`.
- **Master view** (`/leads`, no `list` param) for **education** = exclude archived: `list_id NOT IN (archive list ids)` (or `is_archive=false` via join). For non-education, behavior unchanged.

### 6. Dynamic nav group
- `src/app/(main)/(dashboard)/layout.tsx` (Server Component): for education tenants, fetch the caller's accessible `lead_lists` (reuse the API's access logic or a shared helper) and pass as a new prop (e.g. `leadLists`) to `DashboardShell`.
- `src/components/dashboard/shell.tsx`: render an "All Leads" `SidebarGroup` using the existing `SidebarGroupRender` (the Insights group is the live precedent). Parent → `/leads`; children → `/leads?list=<slug>` in `sort_order`; an admin-only "+ add list" child that opens the create dialog (the dialog itself is Phase 2 — for Phase 1 the "+ add list" item may be omitted or a disabled stub; do NOT build the full management UI).
- Remove the flat `Contacts` `SidebarItem` from `education-consultancy/manifest.ts`. Redirect `/contacts` → `/leads?list=prospects` for education (keep it_agency `/contacts` intact — check the existing industry branch in `contacts/page.tsx`).
- Active-state: parent active on `/leads` with no `list`; child active when its slug matches the `list` searchParam. No new icons needed (reuse `Users`).

### 7. Leads page reads `?list=`
- `src/app/(main)/(dashboard)/leads/page.tsx`: read `searchParams.list`, pass to `getLeads`, show the list's name as the heading + the count. No `list` = master ("All Leads", non-archived).

### 8. Move-to-list action
- For **education only**, replace the lead/prospect `LeadTypeToggle` (`src/components/dashboard/leads/columns-registry.tsx:45-76`) and the detail-panel lead/prospect control with a **"Move to…" list selector** (dropdown of the caller's accessible lists). it_agency keeps the existing `LeadTypeToggle` unchanged.
- Moving to an **archive** list must prompt for a **Drop Reason** (free text or the seeded reason options) → writes `archive_reason`.
- PATCH `src/app/(main)/api/v1/leads/[id]/route.ts`: add `list_id` + `archive_reason` to the write allowlist. On a list change, **mirror `lead_type`**: into Prospects list → `lead_type='prospect'`; out of Prospects → `lead_type='lead'` (keeps existing education prospect-conditional UI working). Audit-log the move (use the existing `audit_logs` write path that the application activity-timeline reads, so the move shows in the lead timeline).

### 9. Types
- `src/types/database.ts`: add `list_id`, `destinations`, `field_of_study`, `degree_level`, `archive_reason` to `Lead`; add a `LeadList` interface.

---

## Reuse (don't reinvent)
- RBAC helpers: `src/lib/api/permissions.ts` (`resolvePermissions`, `leadQueryScope`, `shouldRestrictToSelf`; add a `canAccessList(p, list, positionId)` helper modeled on `canAccessPipeline`).
- Nav: `SidebarGroup`/`SidebarGroupRender` in `shell.tsx`; types in `src/industries/_types.ts`; `getIndustrySidebarItems` in `_loader.ts`.
- `scopedClient(auth)`, `getFeatureAccess`, `FEATURES`, `apiSuccess/apiForbidden/...`.
- Migration/RLS precedents: `030_positions.sql`, `057_*`, `058_*`.

## Self-check before reporting (paste results)
- [ ] `npm run build` clean.
- [ ] `npx eslint --max-warnings 50` clean.
- [ ] Migration file present but **NOT applied** anywhere.
- [ ] Grep confirms no `git push`/PR/merge performed; only commits on `feature/lead-lists`.
- [ ] it_agency path untouched (Contacts + `LeadTypeToggle` unchanged for non-education).
- [ ] Report: what you built, files touched, anything ambiguous you decided, and the two gate outputs. Then STOP.

## Hand back to Opus
Commit (the commit-msg hook rewrites co-author automatically), then stop. Opus re-runs both gates, reviews the diff, and only then is the migration applied (by Sadin) and the branch pushed.
