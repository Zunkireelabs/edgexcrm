# SONNET BRIEF — Per-List Stages + List/Kanban Toggle

> In-flight feature brief. Opus planned; a separate Sonnet session executes. Do not treat as shipped.

## STOP-AT-REVIEW CONTRACT (read first)
- Build on a NEW feature branch cut off the LATEST `stage` (`git fetch && git checkout -b feature/list-stages stage`).
- Do NOT merge to stage/main. Do NOT apply the migration to the shared stage or prod Supabase DBs.
  Run it ONLY against a local/throwaway Postgres for your own verification. Hand the migration file
  back for Opus review; Opus + Sadin apply it dev-first.
- Produce a report (what you changed, files touched, build/lint output, manual verification notes).
  Opus re-runs gates independently and reviews before anything lands.

## DATABASE INDEPENDENCE (context)
Stage (`dymeudcddasqpomfpjvt`) and prod (`pirhnklvtjjpuvbvibxf`) are SEPARATE Supabase projects.
This feature copies NO lead data between them. The migration is schema + a self-contained backfill that
operates only on the leads already present in whichever DB it runs against. Dev-first: local throwaway →
stage (verify) → prod at promotion. The same .sql runs independently per environment.

## GOAL
Each Lead List (Pre-qualified, Qualified, Prospects, Applications, … per tenant/industry) gets its OWN
set of stages — like a pipeline does. On the leads page (`/leads?list=<slug>`), add a List ⇄ Kanban
toggle; Kanban groups THAT list's leads into columns by THAT list's stages (drag to change stage).
A "Manage stages" entry point on the same page opens the existing Pipeline Settings modal scoped to the
list. The lead-detail "Stage" dropdown must show ONLY the current list's stages (fixes the core bug where
it shows all global-pipeline stages).

## ARCHITECTURE (decided — do not redesign)
Reuse the existing pipeline engine. Each list owns one pipeline 1:1; the lead's stage is `leads.stage_id`
within that list's pipeline. List-pipelines are flagged and HIDDEN from the global Pipeline page.

- `lead_lists.pipeline_id` (NEW, nullable FK → pipelines) — the list's own pipeline.
- `pipelines.list_id` (NEW, nullable FK → lead_lists ON DELETE CASCADE) — back-ref; marks a pipeline as
  list-bound. `list_id IS NULL` = a normal standalone pipeline (the global Pipeline page only shows these).
- `leads.stage_id` / `leads.pipeline_id` (EXISTING) — now point at the lead's LIST pipeline + a stage in it.

### Confirmed consequence (intended — Sadin signed off)
The existing standalone "Admizz Pipeline" (`list_id IS NULL`) stays but its board will show 0 leads,
because all leads' `pipeline_id` moves to their list-pipeline. This is intended — the global Pipeline page
is being decoupled to repurpose later. Do not try to keep it populated.

## SCOPE
- ALL industries (lead-lists is a universal feature). No `getFeatureAccess` gating.
- Seed each list-pipeline with this generic starter set (admins refine per list):
  **New (is_default=true) · Contacted · Follow-up · Done**  (positions 0/1/2/3).
  Do NOT use education-specific names — this runs for travel_agency / it_agency too.

## DB MIGRATION (next sequential number — verify latest in supabase/migrations/, likely 088)
Additive only, single transaction, with before/after row counts logged. Respect existing RLS (no new
tables, so no new policies needed; new columns inherit table RLS). Make it idempotent / re-run safe
(skip lists that already have `pipeline_id`).
1. `ALTER TABLE lead_lists ADD COLUMN pipeline_id UUID REFERENCES pipelines(id) ON DELETE SET NULL;`
2. `ALTER TABLE pipelines ADD COLUMN list_id UUID REFERENCES lead_lists(id) ON DELETE CASCADE;`
   Add index on `pipelines(list_id)` and on `lead_lists(pipeline_id)`.
3. For EVERY row in `lead_lists` (all tenants), create one pipeline:
   - `name` = list.name, `slug` = slugify(list.slug + '-pipeline'), `tenant_id` = list.tenant_id,
     `is_default = false`, `is_active = true`, `list_id` = list.id.
   - Set `lead_lists.pipeline_id` to the new pipeline.
   - Seed 4 `pipeline_stages` (positions 0/1/2/3): New (is_default=true), Contacted, Follow-up, Done.
     Distinct slugs scoped to the pipeline. Do NOT mark won/lost (see validation relax below).
4. Backfill leads: for each lead with a `list_id`, set `leads.pipeline_id` = its list's new pipeline and
   `leads.stage_id` = that pipeline's default ("New") stage. Keep `leads.status` synced to that slug.
   (Leads with NULL list_id: leave untouched.)
5. Log counts: lists processed, pipelines created, stages created, leads backfilled.

## BACKEND / API
Reuse existing stage CRUD verbatim — already keyed by pipeline_id:
- `GET/POST /api/v1/pipelines/{id}/stages`, `PATCH/DELETE /api/v1/pipelines/{id}/stages/{stageId}`,
  `POST /api/v1/pipelines/{id}/stages/reorder`, `GET /api/v1/pipelines/{id}` — all work as-is.

Changes required:
1. **Exclude list-pipelines from the global Pipeline page.** In `getPipelines`
   (src/lib/supabase/queries.ts ~286) and `GET /api/v1/pipelines`
   (src/app/(main)/api/v1/pipelines/route.ts:17), filter `list_id IS NULL`.
2. **Relax won/lost terminal validation for list-pipelines.** In PipelineSettingsModal.tsx (~354) and the
   stage DELETE guards (.../stages/[stageId]/route.ts:128-225): when the pipeline has `list_id != null`,
   do NOT require ≥1 won + ≥1 lost stage.
3. **Lead-detail stage change must send `stage_id`, not `status`.** Currently lead-detail-v2.tsx:349-369
   PATCHes `{ status: slug }`; slugs collide across pipelines now. Switch to `{ stage_id }`. In the leads
   PATCH route (src/app/(main)/api/v1/leads/[id]/route.ts:180-218), validate the incoming `stage_id`
   belongs to the lead's CURRENT list pipeline; reject otherwise.
4. **List move resets stage.** When `PATCH /api/v1/leads/[id]` changes `list_id`, also set
   `leads.pipeline_id` = destination list's pipeline and `leads.stage_id` = that pipeline's default stage
   (sync `status`). In the existing list_id block (leads/[id]/route.ts ~313-354). Add an activity/audit
   line for the reset if cheap.

## FRONTEND
1. **List ⇄ Kanban toggle** on `/leads`. Add `?view=list|kanban` (default `list`) alongside `?list=<slug>`.
   Button in the leads-table top action row next to "Edit columns" (leads-table.tsx ~1003). Label flips:
   "Kanban view" in list mode, "List view" in kanban mode.
2. **Per-list Kanban** — reuse PipelineBoard.tsx + PipelineColumn.tsx. Feed it the LIST's pipeline
   (`lead_lists.pipeline_id`) and the list's leads (loaded by `list_id`). Grouping stays by `stage_id`.
   Drag-drop already PATCHes `{ stage_id }` — keep it. In leads/page.tsx: when `view=kanban`, load the
   active list's pipeline + stages and render the board instead of `<LeadsTable>`. Keep the same header
   (count, filters, Add Lead) above both views.
3. **Manage stages entry point** — admin-only button/gear on the leads page (near the toggle, in kanban
   mode) that opens PipelineSettingsModal.tsx targeted at the list's pipeline. Add a "list-stage mode"
   prop that HIDES: Pipeline Name field, "Set as default pipeline", "Delete Pipeline", and the won/lost
   banner. Expose only Add/Edit/Delete/Reorder Stage. NOT via the global Pipeline nav.
4. **Lead-detail Stage dropdown** (key-info-section.tsx:195-229) must receive the CURRENT list's pipeline
   stages. Trace the `stages` prop through lead-detail-v2.tsx (~591) and leads/[id]/page.tsx and source
   stages from `list → lead_lists.pipeline_id → pipeline_stages`.

## INTERACTIONS TO VERIFY (don't silently break)
- "All Status" filter chip (leads-table.tsx ~1207) filters by status slug — now list-specific. Confirm
  sane behavior (ideally filters within the active list's stages). Note in report; don't over-engineer.
- list-stepper.tsx + qualify dialog still work; only change is the server-side stage reset on move.
- Counselor scoping, branch scoping, recycle-bin/archive views unaffected — verify in both view modes.

## OUT OF SCOPE (do NOT touch)
- The standalone global Pipeline nav page UI (leave it; it goes empty by design).
- Retiring/repurposing the Pipeline page.
- Server-side pagination for the kanban (existing 1000-row paging is fine; if a list has >1000 leads the
  board may truncate — log it, don't fix here).

## VERIFICATION (before reporting back)
- `npm run build` clean + `npx eslint --max-warnings 50` clean.
- Run the migration on a LOCAL throwaway Postgres; confirm before/after counts; spot-check leads got
  list-scoped stage_id.
- `npm run dev` (points at stage DB — do NOT mutate it via the migration; UI testing only):
  as admin, on Pre-qualified → toggle to Kanban → see this list's stages as columns → drag a card →
  stage persists. Open Manage stages → add/rename/reorder/delete. Open a lead → Stage dropdown shows ONLY
  this list's stages. Move a lead to the next list → stage resets to new list's "New". Confirm a second
  list has independent stages.
- Confirm the global Pipeline page still loads (board empty is expected) and does NOT list the new
  list-pipelines in its selector.

## KEY FILES (from codebase map)
- Migrations: supabase/migrations/ (002 pipeline_stages, 016 multi_pipeline, 059 lead_lists, 064 applications)
- queries: src/lib/supabase/queries.ts (getLeads:70, getPipelines:286, getPipelineStages:266, getLeadsForPipeline:347)
- Leads page/table: src/app/(main)/(dashboard)/leads/page.tsx, src/components/dashboard/leads-table.tsx
- Board: src/components/pipeline/PipelineBoard.tsx, PipelineColumn.tsx, PipelineSettingsModal.tsx, StageEditor.tsx
- Lead detail: src/app/(main)/(dashboard)/leads/[id]/page.tsx, src/components/dashboard/lead/lead-detail-v2.tsx, key-info-section.tsx
- Leads API: src/app/(main)/api/v1/leads/[id]/route.ts
- Stage API: src/app/(main)/api/v1/pipelines/[id]/stages/** , src/app/(main)/api/v1/pipelines/route.ts
- Stepper: src/components/dashboard/leads/list-stepper.tsx
