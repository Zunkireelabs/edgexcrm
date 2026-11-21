# it_agency Delivery Workflow — PHASE 1 BUILD BRIEF (for Sonnet)

**Planner:** Opus. **Executor:** you (Sonnet). **Reviewer:** Opus (re-runs every gate independently; do not self-merge, do not apply to stage/prod, do not open PRs — stop at "ready for review" on the local branch).

**What this is:** Phase 1 of a best-in-class Delivery / Project-Management workflow for the `it_agency` industry, dogfooded in the Zunkiree Labs tenant. Locked design spec (read it): the six-stage workflow **Brief → Qualify → Tasks → Execute → Review → Report**, where every stage writes a structured "decision-exhaust" record that accretes into institutional memory. **Phase 1 = human discipline + the memory-capture seam. NO AI.** The base captures clean structured signal; Phase 2/3 AI reads it later.

**Principle that governs every choice:** *the workflow captures **decisions**, not just state.* Capture must be clean, structured, and machine-legible from day one — even though nothing reads it for intelligence yet.

---

## 0. Hard guardrails (non-negotiable — read `CLAUDE.md` + `docs/dev-collab/DEV-WORKFLOW-AND-DEPLOYMENT.md` first)

- **Branch:** NEW branch off the LATEST `origin/stage`. Do **NOT** stack on `feature/ui-updates-it-agency`.
  ```bash
  git fetch origin && git switch -c feature/it-agency-delivery-workflow origin/stage
  ```
- **Local only.** Apply the migration to your **local** Supabase (OrbStack) only. Do NOT touch stage or prod. Do NOT push, PR, or merge. Leave the branch local for Opus review.
- **Migration-before-code.** The schema migration (Slice 1) lands and applies locally before any API/UI code that depends on it.
- **One globally-unique migration number.** Next free ascending number is **128**. Verify with `ls supabase/migrations | sort | tail`. Do not reuse 110/112 (already duplicated) or any existing number.
- **Migration hygiene (CI-enforced — `scripts/check-migrations.sh`):** additive-only, `BEGIN/COMMIT`-wrapped, **every statement idempotent** (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP POLICY IF EXISTS` then `CREATE POLICY`, CHECK constraints behind a `DO`-block existence guard). **MUST include the self-record line** (see Slice 1) or the Migration-Guard CI check fails the PR. Include a rollback block + before/after row counts in the header comment. Copy `supabase/migrations/_TEMPLATE.sql` as your starting shape.
- **Tenant isolation.** Every new table: `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE` + RLS (`get_user_tenant_ids()` for SELECT, `is_tenant_admin(tenant_id)` for mutations). Every new/changed route uses `scopedClient(auth)` — never raw `createServiceClient`. `scopedClient.update()/.delete()` must always carry a caller filter (e.g. `.eq("id", …)`) beyond the auto-injected `tenant_id`.
- **Feature gate.** New delivery routes/pages gate with `getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)` → `apiForbidden()` / `notFound()`. Mutations also require `requireAdmin(auth)` (admin-first; role/client scoping is a later phase).
- **Industry-module pattern.** All new UI lives under `src/industries/it-agency/features/project-board/` (extend the existing feature). Page route shells under `src/app/(main)/(dashboard)/projects/…` stay thin (auth + gate → delegate to the feature component).
- **Do not overload the audit `emitEvent`.** `@/lib/api/audit` → `emitEvent()` writes to the generic `events` audit table. Our decision ledger is a **separate domain table** `project_events` with its own helper (Slice 2). Keep them distinct.
- **Verify per slice** (all four, every slice): `npm run build` clean · `npx tsc --noEmit` clean · `npx eslint --max-warnings 50 <changed files>` clean · **hands-on local** `npm run dev`, logged in as `admin@zunkireelabs.com / edgexdev123` (owner) on the Zunkiree Labs it_agency tenant. If leads/projects look empty, clear the stale `edgex_branch` cookie (DevTools → Application → Cookies) or use incognito.

---

## 1. Data model (APPROVED — build exactly this)

Decisions locked by Sadin: **change requests = separate table**; **health = deterministic rule + manual override**; **budget = hours-drive health/reconciliation, capture `budget_amount` but no currency margin in P1**; **all 5 new tables ship in Phase 1**.

### 1a. Extend `projects` (all additive, all nullable — 0-row backfill risk)

| Column | Type | Notes |
|---|---|---|
| `brief` | TEXT | First-class living description. |
| `engagement_model` | TEXT | CHECK in (`fixed_bid`,`time_materials`,`retainer`,`staff_aug`) via DO-guard; nullable. |
| `definition_of_done` | TEXT | Captured at qualify. |
| `baseline_estimate_minutes` | INTEGER | **Immutable** committed estimate, set once at qualify. |
| `current_estimate_minutes` | INTEGER | Running = baseline + Σ approved change deltas. |
| `budget_amount` | NUMERIC(12,2) | Optional captured target budget. Not driving health in P1. |
| `start_date` | DATE | |
| `target_end_date` | DATE | |
| `health_override` | TEXT | CHECK in (`green`,`amber`,`red`) via DO-guard; NULL ⇒ use the rule. |
| `health_note` | TEXT | Why amber/red. |
| `qualified_at` | TIMESTAMPTZ | The gate stamp. Non-null ⇒ baseline committed. |
| `qualified_by` | UUID | `REFERENCES auth.users(id) ON DELETE SET NULL`. |

- **`% complete` — DO NOT store.** Derive in the API: estimate-weighted `Σ estimated_minutes(status=done) ÷ Σ estimated_minutes`; if no estimates present, fall back to `count(done) ÷ count(*)`.
- **Health rule (deterministic, computed at read; NOT AI):** effective = `health_override` if set, else:
  `red` if `actual_minutes > 1.10 × current_estimate_minutes` **OR** (`target_end_date < today` AND pct_complete < 100); `amber` if `actual_minutes > 0.90 × current_estimate_minutes`; else `green`. (`actual_minutes` = Σ `time_entries.minutes` for the project.) Put this in a shared server util so API + UI agree.

### 1b. `project_events` — the decision/event ledger (CROWN JEWEL, append-only)

```
id            UUID PK default gen_random_uuid()
tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE
event_type    TEXT NOT NULL           -- free TEXT (NOT an enum): new kinds never need a migration
actor_id      UUID   REFERENCES auth.users(id) ON DELETE SET NULL   -- who committed the decision (NULL=system)
summary       TEXT                    -- human-legible one-liner
payload       JSONB NOT NULL DEFAULT '{}'::jsonb   -- structured machine-legible record
subject_type  TEXT                    -- 'task' | 'milestone' | 'change_request' | 'status_report' | 'issue' | NULL
subject_id    UUID                    -- join-free provenance to the entity
occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
```
- **Indexes:** `(tenant_id, project_id, occurred_at DESC)` and `(tenant_id, event_type)`.
- **RLS — deliberately append-only:** SELECT policy `tenant_id IN (SELECT get_user_tenant_ids())`; INSERT policy `is_tenant_admin(tenant_id)`. **NO UPDATE and NO DELETE policy** — the ledger is immutable even to admins. (Do not add them.)
- Phase 1 does not read this for intelligence; it just accretes and is rendered as the project's memory/activity timeline.

### 1c. `project_milestones` — deliverable acceptance (extends Approvals past timesheets)

```
id UUID PK · tenant_id (FK,CASCADE) · project_id (FK,CASCADE)
title TEXT NOT NULL · description TEXT · due_date DATE · sort_order INT NOT NULL DEFAULT 0
amount NUMERIC(12,2)                                   -- optional milestone billing value (later)
status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','submitted','accepted','rejected'))
accepted_at TIMESTAMPTZ · accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL · rejection_reason TEXT
created_at · updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
```
Standard RLS quad. Index `(tenant_id, project_id, sort_order)`. Accept ⇒ emits `milestone_accepted`.

### 1d. `project_issues` — client queries / issues surface (Execute)

```
id UUID PK · tenant_id (FK,CASCADE) · project_id (FK,CASCADE)
title TEXT NOT NULL · description TEXT
kind     TEXT NOT NULL DEFAULT 'query'    CHECK (kind IN ('query','issue','blocker'))
severity TEXT NOT NULL DEFAULT 'medium'   CHECK (severity IN ('low','medium','high'))
status   TEXT NOT NULL DEFAULT 'open'     CHECK (status IN ('open','in_progress','resolved','closed'))
source   TEXT NOT NULL DEFAULT 'internal' CHECK (source IN ('internal','client'))   -- client bolt-on seam
raised_by_label      TEXT                 -- admin-first free text ("Northwind")
raised_by_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL   -- future client-portal actor
assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL
opened_at   TIMESTAMPTZ NOT NULL DEFAULT now()   -- drives SLA-age "open 61h"
resolved_at TIMESTAMPTZ
created_at · updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
```
Standard RLS quad. Index `(tenant_id, project_id, status)`. (Confirm the `contacts` table + PK name before referencing; if the FK is awkward cross-tenant, keep `raised_by_contact_id` as a plain UUID with no FK and note it.) Optional events `issue_raised` / `issue_resolved`.

### 1e. `project_change_requests` — scope-change gate (Review); amends the baseline

```
id UUID PK · tenant_id (FK,CASCADE) · project_id (FK,CASCADE)
title TEXT NOT NULL · description TEXT
classification TEXT NOT NULL DEFAULT 'new_scope' CHECK (classification IN ('in_scope','new_scope'))
estimate_delta_minutes INTEGER NOT NULL DEFAULT 0     -- may be negative
budget_delta_amount    NUMERIC(12,2)
status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected'))
client_approved BOOLEAN NOT NULL DEFAULT false
origin_issue_id UUID REFERENCES project_issues(id) ON DELETE SET NULL   -- a query that became a CR
decided_at TIMESTAMPTZ · decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
created_at · updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
```
Standard RLS quad. Index `(tenant_id, project_id, status)`. **Approve** ⇒ in ONE scoped write path: set status/decided_*, add `estimate_delta_minutes` to `projects.current_estimate_minutes`, emit `change_request_approved`. Emit `change_request_proposed` on create and `change_request_rejected` on reject too (free TEXT event_type — cheap, valuable memory).

### 1f. `project_status_reports` — the Report artifact (Report)

```
id UUID PK · tenant_id (FK,CASCADE) · project_id (FK,CASCADE)
report_date DATE NOT NULL DEFAULT current_date · period_start DATE · period_end DATE
health_snapshot TEXT CHECK (health_snapshot IN ('green','amber','red'))
summary TEXT                                   -- P1 human-written narrative
pct_complete_snapshot   INTEGER
hours_actual_snapshot   INTEGER
hours_estimate_snapshot INTEGER
is_client_visible BOOLEAN NOT NULL DEFAULT false   -- client bolt-on seam (unused in P1)
published_at TIMESTAMPTZ · published_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
created_at · updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
```
Standard RLS quad. Index `(tenant_id, project_id, report_date DESC)`. On **publish**: freeze the snapshot metric fields from live data, stamp `published_*`, emit `status_published`. Retro lessons are captured as `retro_lesson` **events only** (no table in P1).

---

## 2. The event contract (Slice 2 wires these; this is the memory spec)

A tiny server helper — `recordProjectEvent(db, { projectId, eventType, actorId, summary, payload, subjectType, subjectId })` — inserts one `project_events` row using the same `scopedClient` as the state change, in the same request. Every gate action below emits exactly one event. **Do not reuse `@/lib/api/audit` `emitEvent`.**

| event_type | Emitted when | payload (JSONB) shape |
|---|---|---|
| `brief_captured` | project `brief` transitions empty → non-empty | `{ brief_length }` |
| `scope_baseline_set` | qualify action | `{ estimate_minutes, dod, engagement_model, target_end_date, budget_amount }` |
| `plan_committed` | "Commit plan" action | `{ task_count, planned_minutes }` |
| `change_request_proposed` | CR created | `{ change_request_id, delta_minutes, classification }` |
| `change_request_approved` | CR approved | `{ change_request_id, delta_minutes, classification, client_approved }` |
| `change_request_rejected` | CR rejected | `{ change_request_id, reason? }` |
| `task_reconciled` | task reconcile/close action | `{ task_id, est_minutes, actual_minutes, variance_pct }` |
| `milestone_accepted` | milestone accepted | `{ milestone_id, amount }` |
| `issue_raised` / `issue_resolved` | issue created / resolved | `{ issue_id, kind, severity }` |
| `status_published` | status report published | `{ status_report_id, health, pct_complete, hours_actual, hours_estimate }` |
| `retro_lesson` | retro lesson added | `{ lesson, category }` |

`actor_id` = `auth.userId`. `summary` = short human sentence (e.g. `"Scope committed at 132h"`). `subject_type/subject_id` point at the row the event is about.

---

## 3. Slice plan (each independently verifiable — build/tsc/eslint/hands-on)

### Slice 1 — Schema (`supabase/migrations/128_delivery_workflow.sql`)
- `projects` ALTER (§1a) + `project_events` (§1b) + `project_milestones` (§1c) + `project_issues` (§1d) + `project_change_requests` (§1e) + `project_status_reports` (§1f), all RLS + indexes.
- Idempotent throughout; CHECK constraints behind DO-guards; **self-record line** at the end:
  ```sql
  INSERT INTO public.schema_migrations (version) VALUES ('128_delivery_workflow.sql')
    ON CONFLICT (version) DO NOTHING;
  ```
- Header: before/after counts (all new tables `0 rows`; `projects` `+12 columns, 0 rows touched`) + rollback block (`DROP TABLE IF EXISTS … CASCADE;` for the 5 tables + `ALTER TABLE projects DROP COLUMN IF EXISTS …` for the 12 columns).
- Apply locally (psql / `scripts/migrate-apply.sh local`). **Verify:** all 5 tables exist, RLS enabled, `project_events` has SELECT+INSERT policies only (no UPDATE/DELETE), `projects` has the 12 new columns. Run the RLS check as the real `admin@zunkireelabs.com` JWT, not just service-role.
- **Gate:** build/tsc/eslint clean (schema-only slice: no app code yet — confirm migration applies twice cleanly = idempotent).

### Slice 2 — API + event-emit seam
Add the `recordProjectEvent` helper, then the routes (all: `authenticateRequest` → `getFeatureAccess(…, PROJECT_BOARD)` → `requireAdmin` for mutations → `scopedClient`; validate with `@/lib/api/validation`; standard `apiSuccess/apiError/...`):
- `PATCH /api/v1/projects/[id]` — extend to accept `brief, engagement_model, budget_amount, start_date, target_end_date, health_override, health_note`. Emit `brief_captured` on empty→non-empty brief.
- `POST /api/v1/projects/[id]/qualify` — set `definition_of_done, baseline_estimate_minutes, current_estimate_minutes(=baseline), qualified_at, qualified_by`. Emit `scope_baseline_set`.
- `POST /api/v1/projects/[id]/commit-plan` — emit `plan_committed` with task roll-up (compute from `tasks`).
- `GET /api/v1/projects/[id]/reconciliation` — derived per-task (est vs Σ time_entries.minutes by task_id) + project roll-up (`actual/estimate`, variance). No new storage.
- `GET /api/v1/projects/[id]/events` — the memory timeline (ordered `occurred_at DESC`).
- `POST /api/v1/projects/[id]/retro-lessons` — emit `retro_lesson` (no table).
- Milestones: `GET|POST /api/v1/projects/[id]/milestones`, `PATCH|DELETE /api/v1/milestones/[id]`, `POST /api/v1/milestones/[id]/accept`, `POST /api/v1/milestones/[id]/reject`.
- Issues: `GET|POST /api/v1/projects/[id]/issues`, `PATCH /api/v1/issues/[id]` (status/resolve → emit `issue_resolved` on resolve).
- Change requests: `GET|POST /api/v1/projects/[id]/change-requests` (create emits `change_request_proposed`), `POST /api/v1/change-requests/[id]/approve` (mutates `projects.current_estimate_minutes` + emits `change_request_approved`, one write path), `POST /api/v1/change-requests/[id]/reject`.
- Status reports: `GET|POST /api/v1/projects/[id]/status-reports`, `POST /api/v1/status-reports/[id]/publish` (freeze snapshots + emit `status_published`).
- Extend `GET /api/v1/projects/[id]` to return the derived `pct_complete` + effective `health` (shared util).
- **Gate:** build/tsc/eslint clean; hands-on via curl or the running app — qualify a project, approve a CR, confirm a `project_events` row lands for each and `current_estimate_minutes` moves on CR approve.

### Slice 3 — Qualify + Control UI (project cockpit shell)
- **Create the project detail page** (does not exist yet): `src/app/(main)/(dashboard)/projects/[id]/page.tsx` — thin shell (auth + `getFeatureAccess → notFound`) delegating to a new cockpit component under `src/industries/it-agency/features/project-board/pages/project-cockpit.tsx`.
- Cockpit **answer-first** layout per the spec: header (account/model/owner/due), **health RAG banner** + hours-vs-estimate bar + `% complete` KPIs, **Brief** editor, **Qualify gate** panel (commit baseline estimate + DoD + target dates → calls `/qualify`). Before qualify: show an un-qualified state nudging the gate.
- Add a per-card **health dot** + hours-vs-est mini-bar on the board (`workspace.tsx` / `project-card.tsx`).
- Design system: Tailwind v4 + shadcn/ui, match existing project-board components. Calm, not a wall of tickets.
- **Gate:** build/tsc/eslint clean; hands-on — open a real Zunkiree project, set a brief (see `brief_captured` in the events endpoint), commit a baseline, watch RAG/bar render.

### Slice 4 — Client issues + milestone acceptance UI
- Cockpit **Client queries & issues** panel (list, add, resolve; SLA-age from `opened_at`; severity dots) + **Milestones** panel (list/add/reorder; submit → accept/reject).
- Change-request affordance: promote an issue to a CR (`origin_issue_id`), CR list with approve/reject; on approve the cockpit's current-estimate + variance update.
- **Gate:** build/tsc/eslint clean; hands-on — raise an issue, accept a milestone, approve a CR; confirm each event in the timeline and the estimate delta applied.

### Slice 5 — Reconciliation + Status report + Memory timeline UI *(trim line if needed)*
- **Estimate-vs-actual reconciliation** table (per-task est vs actual + roll-up) with a per-task "reconcile" action → `task_reconciled`.
- **Status report** composer (auto-filled snapshots + human summary) → save draft → publish; list of past reports.
- **Institutional-memory timeline** panel rendering `GET …/events` (the decision exhaust made visible) + a simple retro-lesson capture form.
- **Gate:** build/tsc/eslint clean; hands-on — publish a status report, add a retro lesson, verify the full event stream reads back in order.

---

## 4. Report back to Opus (do not merge)
For each slice: the diff summary, the exact commands you ran for all four gates + their output (paste it — I re-run independently and do not trust self-reports), the migration file, and a short "how I verified in the live local app as `admin@zunkireelabs.com`" note (what you clicked, what you saw, which `project_events` rows appeared). Flag any deviation from this spec and why. Leave the branch local and unpushed for review.

---

## 5. Out of scope for Phase 1 (do NOT build)
Any AI/agent/LLM, cockpit *synthesis* (Phase 1 health is the deterministic rule, not AI), auto-drafted status text, slippage/scope-creep alerts, plain-English → structured capture, retrieval of past projects, client-portal/role exposure (admin-first only), currency margin math, milestone billing invoices, notifications. These are Phase 2/3 and fit the Orca/KB layer later.
