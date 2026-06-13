# DEALS PHASE 2 — Multiple Pipelines + Board Filters — Sonnet Build Brief

> **Source of truth:** this brief. Builds ON TOP of Phase 1 (`docs/DEALS-BRIEF.md`, already on branch `feature/deals`).
> **You are the executor (Sonnet).** Continue on `feature/deals`, **STOP AT REVIEW** — no merge, no stage/main push, and **do NOT apply migration 047 to the shared Supabase DB** (Opus applies it after review, same as 046). Read `CLAUDE.md` first.

---

## 0. Hard rules (unchanged from Phase 1)

1. **Branch:** keep working on `feature/deals` (Phase 1 is here, unmerged). `git pull --rebase origin feature/deals` first.
2. **STOP AT REVIEW.** Commit + push the **branch** only. No merge, no stage/main, **no applying 047 to shared Supabase** (it's a shared/prod DB — Opus handles it on Sadin's GO).
3. **Migration additive + idempotent.** Apply 047 ONLY to a local/throwaway DB for your own testing.
4. **Both gates green before handing back:** `npm run build` clean **AND** `npx eslint --max-warnings 50` with **0 errors**.
5. **Do NOT modify the live leads pipeline.** You will *mirror* the lead pipeline components/routes into the deals feature, NOT edit or generalize the shared ones (`src/components/pipeline/*`, `src/app/(main)/api/v1/pipelines/*`). The leads board is load-bearing on prod — leave it exactly as-is.
6. **Tenant isolation:** `scopedClient(auth)` everywhere; `.update()/.delete()` always carry a caller filter (e.g. `.eq("id", x)`) beyond the auto `tenant_id`.
7. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## 1. What you're building

Phase 1 gave Deals a single implicit pipeline (a `deal_stages` table, no pipeline grouping). Phase 2 makes deal pipelines **multiple + configurable**, exactly like the leads pipeline, plus a **board filter toolbar**. The leads system is the working precedent — **mirror it into the deals feature**.

**Result on the `/deals` board (it_agency tenant):**
- A **pipeline switcher dropdown** in the header (like the leads "Sales Outreach" selector) + an admin **settings gear** → manage stages (add/rename/reorder/delete, color, mark Won/Lost terminal, set default) + a **"Create pipeline"** flow (templates: default / copy-from-existing / empty).
- A **filter toolbar**: Search (deal name), Owner, Deal Type, Priority, Created-date; **Sort** (created/updated/name/amount/close date); **Export CSV**; per-stage **amount totals** (already built in Phase 1).
- Each deal belongs to one pipeline; the board shows the selected pipeline's stages + deals.

**Locked decisions:** dedicated deal pipeline tables (NOT shared with leads); filters adapted to deal fields (no Source/Industry — use Deal Type + Priority instead).

---

## 2. Migration — `supabase/migrations/047_deal_pipelines.sql`

Next number after `046`. Mirror the leads multi-pipeline migration `016_multi_pipeline.sql` and the single-default trigger `ensure_single_default_pipeline()` from the migration that defines it (grep for it). Additive + idempotent.

**Steps (order matters):**

1. **Create `deal_pipelines`** (mirror `pipelines` from `016`):
   `id`, `tenant_id` FK→tenants CASCADE, `name` VARCHAR(100), `slug` VARCHAR(100), `description` TEXT, `is_default` BOOLEAN DEFAULT false, `position` INT DEFAULT 0, `is_active` BOOLEAN DEFAULT true, `created_at`, `updated_at`, `UNIQUE(tenant_id, slug)`. Indexes on `tenant_id` and `(tenant_id, is_default) WHERE is_default`. RLS: SELECT `get_user_tenant_ids()`, INSERT/UPDATE/DELETE `is_tenant_admin(tenant_id)`. `updated_at` trigger.

2. **Single-default trigger:** create `ensure_single_default_deal_pipeline()` mirroring `ensure_single_default_pipeline()` (on INSERT/UPDATE when `is_default=true`, unset other `deal_pipelines` for the tenant). Attach the trigger.

3. **Add `pipeline_id` (nullable for now):**
   - `ALTER TABLE deal_stages ADD COLUMN IF NOT EXISTS pipeline_id UUID REFERENCES deal_pipelines(id) ON DELETE CASCADE;`
   - `ALTER TABLE deals ADD COLUMN IF NOT EXISTS pipeline_id UUID REFERENCES deal_pipelines(id);`
   - Index `deal_stages(pipeline_id)`, `deals(tenant_id, pipeline_id) WHERE deleted_at IS NULL`.

4. **Backfill:** for every tenant that already has `deal_stages` (the it_agency tenants seeded by 046), create ONE default pipeline and link everything:
   ```sql
   INSERT INTO deal_pipelines (tenant_id, name, slug, is_default, position)
   SELECT DISTINCT tenant_id, 'Sales Pipeline', 'sales-pipeline', true, 0
   FROM deal_stages
   ON CONFLICT (tenant_id, slug) DO NOTHING;

   UPDATE deal_stages ds SET pipeline_id = dp.id
   FROM deal_pipelines dp
   WHERE dp.tenant_id = ds.tenant_id AND dp.is_default = true AND ds.pipeline_id IS NULL;

   UPDATE deals d SET pipeline_id = dp.id
   FROM deal_pipelines dp
   WHERE dp.tenant_id = d.tenant_id AND dp.is_default = true AND d.pipeline_id IS NULL;
   ```

5. **Swap the `deal_stages` uniqueness from per-tenant to per-pipeline** (two pipelines may each have a "Qualification" slug):
   - Drop the auto-named constraint from 046's inline `UNIQUE(tenant_id, slug)` — it's `deal_stages_tenant_id_slug_key` (verify the exact name with `\d deal_stages` on your local DB before writing the DROP).
   - `ALTER TABLE deal_stages ADD CONSTRAINT deal_stages_pipeline_slug_key UNIQUE (pipeline_id, slug);`

6. **Enforce NOT NULL after backfill:** `ALTER TABLE deal_stages ALTER COLUMN pipeline_id SET NOT NULL;` (deals.pipeline_id can stay nullable defensively, but backfill fills all existing rows; new deals always set it — see §5).

> `is_default` on `deal_stages` is now **per pipeline** (one default stage per pipeline), exactly like `pipeline_stages`.

---

## 3. Lazy-seed update — `src/lib/deals/stages.ts`

Phase 1's `ensureDealStages` seeded loose stages. Replace it with **`ensureDealPipeline(db, tenantId)`** that, if the tenant has zero `deal_pipelines`, creates the default "Sales Pipeline" **and** its 6 stages linked via `pipeline_id`. Keep the `DEFAULT_DEAL_STAGES` const. Return the default pipeline id. Keep the error-surfacing pattern (already hardened — check `.error`, throw). Update both callers (`GET /api/v1/deals`, the deals POST) and the deal-stages route to use it. This guarantees new tenants (created after the migration) get a working pipeline on first board load.

---

## 4. New API routes — mirror the leads pipeline routes into `deal-pipelines`

**Mirror exactly** from `src/app/(main)/api/v1/pipelines/**` (the explore inventory lists every route). For each: swap `pipelines`→`deal_pipelines`, `pipeline_stages`→`deal_stages`, `leads`→`deals`, `lead_count`→`deal_count`; gate with `getFeatureAccess(auth.industryId, FEATURES.DEALS) → apiForbidden()` (NOT the `canSeeNav("/pipeline")` check the leads routes use); writes require `requireAdmin`; `scopedClient`; audit + events (`deal_pipeline.*`).

Create under `src/app/(main)/api/v1/deal-pipelines/`:
- **`route.ts`** — `GET` (list deal_pipelines + `stage_count` + `deal_count`, ordered by position) / `POST` (create with `template: 'default'|'copy'|'empty'`, `copy_from_id?`; default template seeds the 6 standard stages; copy duplicates another deal pipeline's stages).
- **`[id]/route.ts`** — `GET` (pipeline + its stages with per-stage `deal_count`) / `PATCH` (name, is_default, description) / `DELETE` (guards: cannot delete the default, cannot delete one with deals, cannot delete the last pipeline; cascade stages).
- **`[id]/stages/route.ts`** — `POST` add stage (name, color, is_terminal, terminal_type, is_default; auto slug unique per pipeline; next position).
- **`[id]/stages/[stageId]/route.ts`** — `PATCH` (name/color/is_terminal/terminal_type/is_default; clearing is_terminal nulls terminal_type) / `DELETE` (guards: stage has deals → block; last stage → block; only Won or only Lost terminal → block; if deleted stage was default, promote first remaining).
- **`[id]/stages/reorder/route.ts`** — `POST` `{ stage_ids: [...] }` → validate all belong to this pipeline, write positions 0..n.

**Update the existing `GET /api/v1/deal-stages`** to accept `?pipeline_id=` and return that pipeline's stages (call `ensureDealPipeline` first; if no `pipeline_id` given, use the tenant's default pipeline).

---

## 5. Update existing Phase-1 deals routes

- **`POST /api/v1/deals`:** resolve `pipeline_id` then `stage_id`: if `body.pipeline_id` given use it, else the tenant's default deal pipeline; `stage_id` = `body.stage_id` (must belong to that pipeline) else that pipeline's default stage. Set `pipeline_id` on the insert. (Mirror the leads `resolveLeadPipelineAndStage` intent but simpler — a small inline resolver is fine.)
- **`GET /api/v1/deals`:** add a `pipeline_id` filter (the board lists one pipeline at a time).
- **`PATCH /api/v1/deals/[id]`:** allow `pipeline_id` change (moving a deal to another pipeline → reset `stage_id` to that pipeline's default stage unless a valid `stage_id` in the new pipeline is supplied). Stage-change-within-pipeline (the board drag) is unchanged from Phase 1.

---

## 6. Queries — `src/lib/deals/` (or `src/lib/supabase/queries.ts`)

Mirror `getPipelines` / `getPipelineStages` / `getLeadsForPipeline` / `getTeamMembers` (in `src/lib/supabase/queries.ts`) as `getDealPipelines(tenantId)`, `getDealPipelineStages(tenantId, pipelineId)`, `getDealsForPipeline(tenantId, { pipelineId })` (cap ~500, join account/contact names; owner-scope not required since deal writes are admin-only, but keep the read tenant-scoped). Reuse the existing `getTeamMembers` for the Owner filter.

---

## 7. UI — mirror lead pipeline components into the deals feature

**Build these in `src/industries/it-agency/features/deals/components/` — mirror, don't import, the lead ones.** Source files to copy patterns from (do NOT edit them):
- `src/components/pipeline/PipelineSelector.tsx` → `DealPipelineSelector` (dropdown of deal pipelines; localStorage key `deal_pipeline_selected_${tenantId}`; `?pipeline=` URL param; Default badge; stage/deal counts; admin "Create pipeline" + settings gear).
- `src/components/pipeline/PipelineSettingsModal.tsx` → `DealPipelineSettingsModal` (rename, set default, dnd stage reorder, add/edit/delete stages with guards).
- `src/components/pipeline/StageEditor.tsx` → `DealStageEditor` (name, 8-color picker, type Regular/Won/Lost).
- `src/components/pipeline/CreatePipelineModal.tsx` → `CreateDealPipelineModal` (name + template default/copy/empty).

**Board + workspace:**
- Wire `DealPipelineSelector` into the `DealsWorkspace` header next to the Board/List toggle + Add Deal.
- Resolve the selected pipeline server-side in the `/deals` page shell, mirroring `src/app/(main)/(dashboard)/pipeline/page.tsx` (URL `?pipeline=` → else default), and pass `pipelines`, the selected pipeline's `stages`, and its `deals` + `teamMembers` into the workspace.
- **Filter toolbar** on the board (use the existing `src/components/ui/filter-dropdown.tsx`): **Search** (deal name), **Owner** (team members), **Deal Type**, **Priority**, **Created date** (today/week/month). Client-side filtering like `PipelineBoard.tsx`. Active-filter count + Clear.
- **Sort:** created / updated / name / **amount** / **close date**, asc/desc.
- **Export CSV:** columns Name, Account, Contact, Amount, Currency, Stage, Owner, Close date, Status (mirror the leads board export).
- The existing `DealBoard` drag (PATCH `stage_id`) and per-stage amount totals stay; just scope the board to the selected pipeline's stages.

---

## 8. Filter mapping (leads → deals)

| Leads control | Deal equivalent | Field |
|---|---|---|
| Search | Search | `deals.name` (ilike) |
| Counselor | **Owner** | `deals.owner_id` (+ "Unassigned") |
| Source | **Deal Type** | `deals.deal_type` (distinct values from data) |
| Industry | **Priority** | `deals.priority` (low/medium/high) |
| Created date | Created date | `deals.created_at` |
| Sort | Sort | + `amount`, `close_date` |
| Export | Export | deal columns above |
| Pipeline switcher | Pipeline switcher | `deal_pipelines` |

---

## 9. Verification (before handoff)

1. `npm run build` clean + `npx eslint --max-warnings 50` 0 errors.
2. Apply `047` to your **local** DB only. `npm run dev` as a Zunkiree (it_agency) admin:
   - Board shows the default "Sales Pipeline" with the 6 stages + Phase-1 deals intact (backfill worked).
   - Pipeline switcher: create a new pipeline (default template) → switch to it → empty board with its stages; create one via **copy** → stages duplicated; **settings gear** → add/rename/reorder/delete a stage (guards fire: can't delete a stage with deals / last stage / only Won).
   - Create a deal while pipeline B is selected → it lands in B's default stage (`pipeline_id` = B).
   - Filters: Search, Owner, Deal Type, Priority, Created date all narrow the board; Sort by amount + close date; Export downloads the right rows.
   - Drag a deal to Closed Won/Lost → `status` flips (Phase-1 behavior intact).
3. **Isolation:** education tenant → `/deals` 404, `/api/v1/deal-pipelines` 403.
4. **RLS / role:** a member (viewer/counselor) sees the board read-only; pipeline CRUD + stage CRUD endpoints → 403.
5. **No leads regression:** the leads `/pipeline` board + its pipeline selector/settings behave exactly as before (you didn't touch shared files).

---

## 10. Handoff back to Opus

Push `feature/deals` (Phase 1 + Phase 2 together). State: new commits, both gate results (paste the eslint summary), the §9 checklist results, anything deferred, and confirm you did **not** apply 047 to shared Supabase, **not** merge, **not** push stage/main. Opus reviews, re-runs gates, applies 047 to the shared DB on Sadin's GO, then we discuss promotion.

> Note: after Opus applies 047 to the shared DB, the deals data already created in Phase-1 testing gets backfilled into the default pipeline automatically (migration step 4).
