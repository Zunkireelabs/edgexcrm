# it_agency Delivery — Tier 0: "Make the shipped engine truthful"

**For:** Sonnet executor · **Reviewed by:** Opus (stop-at-review; do NOT merge/deploy) · **Size:** S (three small fixes)
**Branch:** new, off **latest** `origin/stage` (the combined delivery branch is merged + deleted). `git fetch origin && git switch -c feature/it-agency-delivery-tier0 origin/stage`
**Migration:** none.

---

## Why

The delivery cockpit shipped a full deterministic **health / %-complete / est-vs-actual reconciliation** engine — but three inputs are either un-enterable or wrong, so the engine quietly degrades. These are correctness fixes on already-shipped surfaces. All three also enrich the structured signal a future AI-synth will read.

Do all three in one PR (they're small and thematically one thing). Each is independent — if one balloons, split it out and flag me.

---

## Fix 1 — Task-level estimate capture in the cockpit UI  *(the important one)*

**Problem:** the `tasks` table has `estimated_minutes` and **both API routes already persist it** — POST `src/app/(main)/api/v1/projects/[id]/tasks/route.ts:126-127`, PATCH `src/app/(main)/api/v1/tasks/[id]/route.ts:115-116`. But the cockpit **add-task form exposes only title + assignee**, so new tasks are created with `estimated_minutes = null`. Result: `computePctComplete` falls back to `count(done)/count(*)` and the Reconciliation "Est." column renders "—". **The engine is starved at the entry point. No API change needed — pure UI wiring.**

**Do:**
1. **`src/industries/it-agency/features/project-board/components/cockpit/tasks-section.tsx`** — add an **"Est. hours"** number input to the add-task form (currently ~lines 127-160; only title `Input` + `AssigneePicker` today). Add `newTaskEstimate` state (~line 27); include `estimated_minutes: Math.round(hours * 60)` in the POST body (~line 52); reset on success (~lines 58-59) and on cancel (~lines 151-155). Empty input → omit `estimated_minutes` (stays null).
2. **Unit consistency:** the existing edit dialog in the time-tracking `TaskRow` (`src/industries/it-agency/features/time-tracking/components/task-row.tsx:226-236`) currently labels this **"Est. minutes."** Standardize on **hours** everywhere: change that field to "Est. hours" (÷60 to display, ×60 on PATCH) so add and edit speak the same unit. Agencies estimate in hours, not minutes. Downstream (`health.ts`, reconciliation) already works in minutes — no change there.
3. **Parity (do if cheap, else split to a follow-up):** the workspace `tasks-view.tsx` has its own inline-editing `TaskRow` (lines 353-472) with no estimate column. Add an "Est." column + inline number edit → `patchTask(id, { estimated_minutes })`, mirroring the existing `handleDueDateChange` pattern (parent lines 205-212). If this adds meaningful surface, ship it as a separate small PR rather than bloating Tier 0.

**Verify:** add a task with an estimate in the cockpit → Reconciliation "Est." column shows it; %-complete becomes estimate-weighted (not done-count). Edit dialog shows the same hours value.

---

## Fix 2 — Utilization period-scoping bug

**Problem:** `src/app/(main)/api/v1/resourcing/utilization/route.ts` computes utilization as **all-time billable hours ÷ one week's capacity** — a period mismatch that inflates the headline metric. The `time_entries` query (lines 72-76) has **no date filter**; the week range (`weekStart`/`weekEnd`, computed line ~94 via `currentWeekRange`) is used only for leave/holiday subtraction in the denominator, never for the numerator.

**Do:**
- Move the `weekStart`/`weekEnd` computation (currently ~lines 86-94) **above** the `time_entries` query (line 72).
- Add a date filter to that query scoping it to the same week: `.gte("<date_col>", weekStart).lte("<date_col>", weekEnd)`. **Verify the actual date column name on `time_entries`** (recon flagged this — likely `work_date`, but confirm against the `020_time_tracking.sql` schema before writing it).
- Numerator (billable + `approval_status === "approved"`, lines 78-82) and denominator (net weekly capacity) now cover the same Mon–Sun week.

**Scope guard:** this is the *correctness fix only*. The "utilization trend over time" enhancement (PM#2's second half) is a separate follow-up — do **not** add a period selector here.

**Verify:** a user with old billable entries but none this week now reads ~0% for the week, not an inflated all-time number.

---

## Fix 3 — Board-card HealthDot accuracy

**Problem:** `src/industries/it-agency/features/project-board/components/health-dot.tsx` calls the authoritative `computeProjectHealth` but feeds it **wrong inputs**: `actualMinutes` = a billable-only proxy (`billableMinutes` prop), `targetEndDate: null` (**due-date clause dropped**), `pctComplete: 0` (**hardcoded**). So board RAG can disagree with the cockpit's authoritative dot. The board list API (`src/app/(main)/api/v1/projects/route.ts` GET) returns base columns but **not** the two derived inputs `actual_minutes` and `pct_complete` (those exist only on the cockpit GET `projects/[id]/route.ts:51-77`).

**Do:**
1. **`src/app/(main)/api/v1/projects/route.ts` GET** — after loading the project rows, batch-compute per project (in **one** `time_entries` query and **one** `tasks` query over all listed project ids via `.in("project_id", ids)`, aggregated in JS — avoid N+1):
   - `actual_minutes` = SUM of `time_entries.minutes` (all entries, **not** billable-filtered — match the cockpit's definition at `projects/[id]/route.ts:60-63`).
   - `pct_complete` = `computePctComplete` over each project's tasks (reuse `src/lib/projects/health.ts`).
   Attach both to each project row in the response.
2. **`health-dot.tsx`** — accept and pass **real** values: `actualMinutes: project.actual_minutes`, `targetEndDate: project.target_end_date` (stop passing null), `pctComplete: project.pct_complete`. Drop the `billableMinutes` proxy prop.
3. **`project-card.tsx:169`** + **`use-projects.ts`** — update the `<HealthDot>` call site and remove the now-unused `hoursMap`/billable-summary plumbing that only fed the proxy (confirm nothing else uses it before deleting).

**Why both inputs are needed (don't half-fix):** `pctComplete` is hardcoded 0 today, so simply passing a real `target_end_date` without real `pct_complete` would flag **every** past-due project red even if it's 100% done (past-due-incomplete branch fires whenever `pctComplete < 100`). Correctness requires both.

**Perf note:** this adds two aggregate queries to the board list endpoint. Keep them batched (`.in(...)` + JS reduce), not per-row. If the board is large, confirm the list endpoint stays fast; flag me if it regresses.

**Verify:** a project whose board dot and cockpit dot previously disagreed now matches; a 100%-complete-but-past-due project is **not** red on the card.

---

## Acceptance checklist (Opus reviews)

- [ ] `npm run build`, `npx tsc --noEmit`, `npx eslint src` clean.
- [ ] Fix 1: cockpit add-task form has Est. hours; new task's estimate flows to Reconciliation + estimate-weighted %-complete; add/edit both in hours.
- [ ] Fix 2: correct date column verified against schema; weekly numerator matches weekly denominator; old-entry user reads ~0% this week.
- [ ] Fix 3: board dot == cockpit dot for a sample project; batched queries (no N+1); 100%-done-past-due project not red.
- [ ] No API auth/scoping regressions (all these routes keep `authenticateRequest` + `getFeatureAccess` + `scopedClient`).
- [ ] Stop at review — do NOT merge/deploy.

## Non-goals
No new tables/migrations. No utilization trend/period-selector. No task sprints/dependencies. No estimate on the universal (non-it_agency) task surfaces beyond what's listed.
