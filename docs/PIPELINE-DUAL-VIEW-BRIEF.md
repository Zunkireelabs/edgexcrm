# Brief: Bring back the classic multi-pipeline board (dual-view `/pipeline`)

**Status:** Not started — context/design brief only.
**Owner:** unassigned.
**Read first:** `CLAUDE.md` §"Read first, every session" and §"Industry Scoping Rules" before touching any of the files below.

---

## 1. Why this doc exists

Sadin asked (2026-08-03) "where's the pipeline feature with the dropdown to switch pipelines and create stages?" — pointing at a screenshot of the current `/pipeline` page for the `it_agency` tenant, which shows a flat, non-switchable board (New Prospect / Raw / Cleaned / In Outreach columns, no dropdown, no way to add a stage).

Short answer: **that feature was never deleted.** It's fully implemented and sitting in the codebase today, unused. This doc explains why it stopped rendering, what exists to reuse, and what it would take to bring it back — as a **coexisting view**, not a replacement — plus a second, larger idea Sadin floated: repurposing the same pipeline system for non-lead entities (e.g. an Applications pipeline for education_consultancy, the way Deals already has its own pipeline for it_agency).

---

## 2. History (how we got here)

- **`016_multi_pipeline.sql`** (early in the project) added the `pipelines` + `pipeline_stages` tables and the classic UI: a dropdown to switch between multiple named pipelines per tenant, a "+ Create Pipeline" action, and a stage editor (add/rename/reorder/delete stages, set colors, mark terminal stages). This was the **only** `/pipeline` experience for a long time.
- Later, the **Lead Lists** feature shipped (`project_lead_lists.md` in memory) — a different, list-based lifecycle model (Pre-qualified → Qualified → Prospects → Applications → Archived for education; later a 3-tier Funnel→Stage→Status model for it_agency's "two funnels" split, PR #199, migration 154). Lead Lists is **read-only by design** — no drag-and-drop stage editing — and is driven by `lead_lists` rows instead of `pipelines`/`pipeline_stages`.
- `src/app/(main)/(dashboard)/pipeline/page.tsx` was given an early branch:
  ```ts
  const hasLeadLists = getFeatureAccess(tenant.industry_id, FEATURES.LEAD_LISTS);
  if (hasLeadLists) {
    return <ListFunnelBoard .../>;   // <-- the flat, non-switchable board
  }
  // ...otherwise fetch pipelines + render <PipelineSelector> + <KanbanBoard mode="stage">
  ```
- **All three current tenants have `LEAD_LISTS` enabled** in their manifests (`src/industries/education-consultancy/manifest.ts`, `src/industries/it-agency/manifest.ts`, `src/industries/travel-agency/manifest.ts` all import and register `leadListsMeta`). So in practice, **every tenant today always takes the `hasLeadLists` branch** — the classic multi-pipeline board is 100% unreachable code, even though nothing about it is broken.

This was a deliberate, incremental product decision each time (Lead Lists → then it_agency funnels on top of it) — not a bug, not an accidental revert. But the net effect is the classic board quietly became dead code, which is presumably what confused Sadin into thinking it had been "reverted."

---

## 3. What exists today (don't rebuild, reuse)

All of this is intact, compiles, and was working the last time it rendered — it's just not on any live route path currently.

| File | Role |
|---|---|
| `src/components/pipeline/PipelineSelector.tsx` | Dropdown to switch the active pipeline (reads/writes `?pipeline=` query param), "+ Create Pipeline" entry point, settings gear. |
| `src/components/pipeline/CreatePipelineModal.tsx` | Create a new named pipeline for the tenant. |
| `src/components/pipeline/PipelineSettingsModal.tsx` | Rename/deactivate/delete a pipeline; entry point into stage editing. |
| `src/components/pipeline/StageEditor.tsx` | Add/rename/reorder/delete stages within a pipeline, set stage color, mark a stage terminal. |
| `src/components/pipeline/KanbanBoard.tsx` (`mode="stage"`) | The actual drag-and-drop board keyed by `pipeline_stages`, as opposed to `mode="list"` used elsewhere for Lead Lists-driven boards. |
| `src/components/pipeline/MoveToPipelineModal.tsx` | Move a lead from one pipeline to another. |
| `src/lib/supabase/queries.ts` — `getPipelines`, `getPipelineStages` | Data fetchers already used by the `else` branch of `pipeline/page.tsx`. |
| `supabase/migrations/016_multi_pipeline.sql` | `pipelines` (tenant_id, name, slug, is_default, position, is_active) + `pipeline_stages` (tenant_id, name, slug, position, color, is_default, is_terminal) — both RLS-enabled, no schema changes needed for Phase 1. |

The current `else` branch in `pipeline/page.tsx` (lines ~130–213 as of commit `832cdf03`) is a complete, working reference implementation of "fetch pipelines → pick selected pipeline → fetch stages + per-stage lead pages via `getLeadAggregates`/`getLeadsPage` → render `<PipelineSelector>` + `<KanbanBoard mode="stage">`." Read it before writing anything new — it already handles the perf-sensitive parts (per-stage pagination, exact counts via migration 194's `lead_aggregates()`, the F8 stale-view remount-on-switch fix from commit `63bdae20`).

---

## 4. Phase 1 — dual view (small, safe, additive)

**Goal:** let any tenant toggle between the current flat funnel board and the classic multi-pipeline board, instead of the funnel board permanently hiding the classic one. No DB schema changes.

### Design

1. Add a `view` search param to `/pipeline`: `?view=funnel` | `?view=pipeline`.
   - Default when unset: `hasLeadLists ? "funnel" : "pipeline"` — preserves exactly today's behavior for anyone who doesn't touch the toggle.
2. In `pipeline/page.tsx`, replace the current `if (hasLeadLists) { ...return... }` early-return with a branch on the resolved `view`, still only fetching the data needed for whichever view is active (don't double-fetch both branches on every request — same cost profile as today).
3. Add a small client component, e.g. `PipelineViewToggle.tsx` — a two-option segmented control ("Funnel Board" / "Pipeline Board") next to the `<h1>Pipeline</h1>` header. On click, navigates via `router.push` with the `view` param updated (same query-param-driven pattern `PipelineSelector` already uses for `?pipeline=`).
4. Only render the toggle when `hasLeadLists` is true. (Tenants without Lead Lists already only have the classic board — no second view to offer them, no toggle needed.)

### Acceptance criteria

- As an it_agency user (Zunkiree Labs), `/pipeline` still defaults to the funnel board exactly as today.
- Clicking "Pipeline Board" shows the classic dropdown + stage editor board, fully functional: switch pipelines, create a new pipeline, add/edit/reorder/delete stages, drag leads between stages.
- Switching back to "Funnel Board" works and shows the same data as before.
- `npm run build` clean; manual smoke on both views; existing Lead Lists / funnel behavior unchanged.

### Explicitly out of scope for Phase 1

Anything below — this is Phase 2, and needs a real design pass (ideally Opus-reviewed, per this repo's two-session workflow) before any code is written.

---

## 5. Phase 2 — repurposing pipelines for non-lead entities (bigger, needs a design decision first)

Sadin's idea: use the same pipeline/stage mechanic for other entities — e.g., an **Applications pipeline** for `education_consultancy` (tracking a student's application through stages), conceptually parallel to how `it_agency` already has a **Deals pipeline**.

### There is already a precedent in this codebase — and it answers the main design question

`it_agency`'s Deals feature does **not** reuse the leads `pipelines`/`pipeline_stages` tables. It has its own fully parallel clone:

- `supabase/migrations/047_deal_pipelines.sql` — a **separate** `deal_pipelines` table, same shape as `pipelines` from migration 016 (tenant_id, name, slug, is_default, position, is_active), same RLS pattern (`is_tenant_admin` for insert/update/delete, `get_user_tenant_ids()` for select).
- `src/industries/it-agency/features/deals/components/deal-pipeline-selector.tsx`, `create-deal-pipeline-modal.tsx`, `deal-pipeline-settings-modal.tsx` — near-identical UI clones of `PipelineSelector`/`CreatePipelineModal`/`PipelineSettingsModal`, just pointed at `deal_pipelines` instead of `pipelines`.

**So the established pattern in this codebase is: clone the pipeline system per entity, don't build one generic polymorphic pipeline engine.** That's a real trade-off worth stating explicitly before starting Phase 2:

- **Pro clone-per-entity (matches existing Deals precedent):** no risky schema migration on the shared `pipelines`/`pipeline_stages`/`leads.pipeline_id` tables that every existing tenant already depends on; Applications pipelines can evolve independently (different stage semantics, different terminal-stage rules) without touching lead pipelines; fastest to ship since `CreatePipelineModal`/`StageEditor`/`KanbanBoard` are all easily parametrizable — they already take `tenantId`/`pipelineId` as props, not hardcoded to leads.
- **Con:** more duplicated code long-term (3 near-identical table+UI clones once Applications exists: leads, deals, applications) — the same "promote, don't copy" tension flagged elsewhere in `CLAUDE.md`, except here the codebase has already chosen to copy once (Deals) rather than generalize, so a second copy is at least consistent with precedent rather than a new pattern.
- **Alternative (not yet attempted anywhere in this codebase):** a single generic `entity_pipelines`/`entity_pipeline_stages` pair with an `entity_type` column (`'lead' | 'deal' | 'application'`) and a polymorphic `entity_id`, with `KanbanBoard` taking an entity-agnostic data-fetching interface. More correct long-term, meaningfully more upfront work and risk (touches the two highest-traffic tables in the schema), and no precedent in this repo to model it on.

### Recommendation

Given this repo's own precedent (Deals), the pragmatic Phase 2 path is: **clone the pattern for Applications** — a new `application_pipelines` + reuse of `pipeline_stages`' shape scoped to applications (own table, own RLS, own selector/create/settings/stage-editor components under `src/industries/education-consultancy/features/applications/` or wherever the existing Applications feature already lives — check `docs/FEATURE-CATALOG.md` for its current location first). This is a genuinely new industry-scoped (or shared, if Sadin wants it available beyond education) feature and should go through the normal classification + migration + manifest process in `CLAUDE.md`'s "How to scope a new feature" section, not be bolted onto the Phase 1 toggle work.

**Do not start Phase 2 implementation without an explicit go-ahead** — it involves a new migration and a real product decision (clone vs. generalize) that Sadin should confirm, ideally via the Opus planning session per this repo's workflow.

---

## 6. Quick reference for whoever picks this up

- Current `/pipeline` route: `src/app/(main)/(dashboard)/pipeline/page.tsx`
- Feature gate in question: `FEATURES.LEAD_LISTS` in `src/industries/_registry.ts`, checked via `getFeatureAccess()` in `src/industries/_loader.ts`
- All three tenants (Zunkiree Labs, Mobilise = it_agency; Admizz = education_consultancy) currently have `LEAD_LISTS` on — verified by grepping `leadListsMeta` in each `manifest.ts`.
- Classic board components: `src/components/pipeline/*` (untouched, working, just unrouted)
- Funnel board component: `src/components/pipeline/ListFunnelBoard.tsx`
- Deals precedent for Phase 2: `supabase/migrations/047_deal_pipelines.sql` + `src/industries/it-agency/features/deals/components/deal-pipeline-*.tsx`
