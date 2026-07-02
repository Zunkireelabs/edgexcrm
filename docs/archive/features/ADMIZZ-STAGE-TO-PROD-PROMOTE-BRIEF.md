# BRIEF — Admizz stage → prod promote (additive merge, live)

**Scope:** Admizz tenant only (`febeb37c-521c-4f29-adbb-0195b2eede88`). Make prod the complete CRM the client uses.
**Strategy (decided):** **Additive merge** — add to prod only what it lacks; never replace/delete prod's live data. **No maintenance window** — prod stays live; a final delta re-pull at cutover catches anything collected during the work.
**Risk:** HIGHEST in the project — writes to the live client production DB. Every phase is gated, additive, with before/after counts and a restore point.

> Opus executes this directly (Sadin said "you do it"), **phase by phase with explicit GO between phases**. Nothing irreversible runs without a confirmed prod restore point.

---

## Divergence snapshot (2026-06-26, read-only)

| Table (Admizz) | prod | stage | action |
|---|---|---|---|
| leads | 593 (incl deleted) | 9,304 | **load 8,712 stage-only** (id-diff); prod-only = 1 (skipped Anush dup) |
| lead_lists | 4 (system) | 8 | create staging lists on prod |
| applications | 3 | 164 | load stage-only |
| lead_activities | 4 | 2,924 | load stage-only |
| lead_submissions | **2,002** | 1,328 | **prod has MORE — never overwrite**; load only stage-only ids |
| tenant_users | 17 | 21 | **create 4 missing staff via Admin API** |

**Schema gaps on prod (structural migrations not yet applied):** `classes` (065), `application_consent` + `pre_app_fee_*` (066), `lead_import_sources` (068), reconcile RPC changes (070/075/078), `is_staging` flag (067), Applications system list (064), perf indexes (073), `assign_education_display_ids` (084). `next_education_display_id` exists on stage but is in **no migration file** — recreate manually on prod (or rely on the inline generator in `leads/route.ts`; app code does not call the fn).

**Do NOT replay these stage-data migrations on prod** (their prod equivalent is the data-merge): 069, 072, 074, 076, 077, 079, 080, 081, 082, 083, plus 062 (travel-only).

---

## Phase 0 — Safety net (FIRST, before any write)

1. Confirm prod Supabase **PITR / restore point** is active and note the timestamp (rollback path if anything goes wrong).
2. `pg_dump` the Admizz rows on prod (leads, lead_submissions, applications, lead_activities, lead_lists, tenant_users) to an off-box file — explicit pre-promote snapshot.
3. Record baseline counts for every table above.

## Phase 1 — Schema (additive structural migrations → prod) — GATE

Apply, in order, only the **structural** migrations prod lacks, each in its own txn with before/after object checks. Adapt the two that embed stage-data assertions so they don't abort on prod:
- **067** — apply only the `ADD COLUMN is_staging`; **drop** the `UPDATE ... migration-qc` + the "expected exactly 1 staging row" assertion (no such list on prod yet).
- **064 / 071** — these create lists; fold into Phase 2 so list creation is deliberate.
Targets: 064(list)·065·066·067(col only)·068·070·073·075·078·084 + recreate `next_education_display_id`. Verify each object exists after.

## Phase 2 — FK prerequisites (so the data load can't violate references) — GATE

1. **Validate** on prod that the pipeline/stage/form_config the incoming leads reference exist (Admizz default pipeline `bc89ea61…`, stage `05b4c1aa…`, form `94f614bd…`). Create if missing.
2. **Create the 4 missing staff as real auth users via Admin API** (NOT raw SQL — they need login). Pull their email/name/role from stage `tenant_users` + `auth.users`. Build a **user-id map** `stage_user_id → prod_user_id` (Supabase mints new ids).
3. **Create staging lists on prod** for Admizz: `migration-qc`, `existing-leads-edgex`, Applications list — so the migrated leads have a home and the client's Leads Organise cockpit works. Build a **list-id map** `stage_list_id → prod_list_id`. (Decision: keep `existing-leads-edgex` name or rename for prod — default: keep, it's internal.)
4. Seed `lead_import_sources` manifest rows the cockpit expects (prod analogue of 069/074), pointing at the prod staging lists.

## Phase 3 — Data load (additive, id-diff, batched, FK order) — GATE (irreversible)

For each table, load only `stage.id ∉ prod.id`, remapping FKs via the maps from Phase 2.
Order: **leads → lead_submissions → applications → lead_activities → other child rows.**
Per-row transforms on `leads`:
- `assigned_to` / `owner_id` → user-id map (fail loudly if an id isn't mapped).
- `list_id` → list-id map.
- `display_id` → **reconcile vs prod's ADM counter**: keep stage value if no collision on prod, else mint fresh `ADM-NNN` continuing from prod max (same approach as STEP 1). Record the remap.
- exclude generated cols (`normalized_email`); preserve `idempotency_key`, `custom_fields`, `tags`, `created_at`.
Dedup guard: skip any incoming lead whose `normalized_email` already matches a **prod-origin** lead (avoid re-creating prod's own people). Batch in ≤1,000-row chunks with running counts.

## Phase 4 — Reconcile prod's own 593 leads into the list structure

Mirror what 072 did on stage: slot prod's pre-existing leads into the appropriate lifecycle/staging lists so nothing is orphaned in the new UI. Additive `list_id` set only.

## Phase 5 — Code promote + cutover

1. **Merge `stage` → `main`**, let CI run, deploy to prod (carries all feature code + the client-facing UI).
2. **Final delta re-pull**: re-run the STEP-1 id-diff prod→? actually prod→stage is done; here re-check for any **new prod leads created during Phases 1–4** and load them too (live merge tail).
3. Apply migration **084 to prod** if not already in Phase 1.

## Phase 6 — Verify & sign-off

- Counts: prod Admizz leads ≈ 9,300+ (8,712 loaded + prod's existing); applications/activities match expected; submissions ≥ 2,002 (prod's never decreased).
- Client login works; a spot-check of 5 migrated leads shows correct names/lists/assignees/IDs.
- No duplicate people; funnel/dashboard numbers sane.
- Update SESSION-LOG + FEATURE-CATALOG; archive briefs.

---

## Top risks / must-dos
- **User-id remap is mandatory** — Admin-API-created staff get new ids; every `assigned_to`/`owner_id` must be remapped or the load FK-fails / mis-assigns.
- **Never touch prod's submissions/activities/leads that already exist** — additive only, id-diff guarded.
- **display_id collisions** — prod and stage minted ADM-NNN independently; reconcile per-lead.
- **Prod is live** — re-pull the tail at cutover; dedup incoming vs prod-origin people by `normalized_email`.
- **FK order + maps** — load parents before children; fail loud on any unmapped reference.
- **next_education_display_id** absent from migrations — recreate on prod or confirm app uses the inline generator only.
