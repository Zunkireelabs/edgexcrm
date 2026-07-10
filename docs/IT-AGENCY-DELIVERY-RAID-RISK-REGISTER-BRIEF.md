# IT-Agency Delivery — RAID: Structured Risk Register (BUILD BRIEF)

**For:** Sonnet executor session · **Branch:** `feature/it-agency-delivery-tier0` (stack on it — do NOT branch off stage) · **Industry:** `it_agency` (scoped) · **Migration:** **136** (local-only) · **Stop at review** — build uncommitted, Opus verifies + commits.

**Reviewed + scoped by Opus with Sadin.** Adds the "R" of RAID: a **structured risk register** on the project cockpit. Today "risk" exists only as a free-text paragraph inside weekly status reports — nothing tracked, scored, owned, or statused. This adds a first-class register: each risk has a **probability × impact score**, a **mitigation plan**, an **owner**, and a **lifecycle** (open → mitigating → closed / occurred), writing to the `project_events` decision ledger like every other cockpit concern.

**Why it's a clean build:** it's a carbon copy of the existing **Issues** triple (hook + panel + list/create API + per-row PATCH + `recordProjectEvent`). Reuse that pattern exactly — you are adding a fourth sibling next to Issues / Milestones / Change-Requests in the Delivery tab.

---

## 0. Scope decision (locked — do NOT re-litigate)

RAID = Risks / Assumptions / Issues / Dependencies. **v1 builds the Risk register only.** Rationale: **Issues already exist** (`project_issues`, full workflow) = the "I"; **Assumptions + Dependencies** have no home and are lower-value → **deferred** (§8). Do not fold Issues into this new table or duplicate them. The panel is titled **"Risks"** (RAID's R).

---

## 1. Decisions locked

| # | Decision | Ruling |
|---|---|---|
| 1 | Table | New `project_risks` (dedicated), mirroring `project_issues` shape + RLS exactly. |
| 2 | Scoring | `probability` ∈ {low,medium,high} × `impact` ∈ {low,medium,high}. **Score computed in app** (not stored): low/med/high → 1/2/3, `score = p*i` ∈ {1,2,3,4,6,9} → band **Low (≤2) / Medium (3–4) / High (6) / Critical (9)**. Register sorts by score desc. |
| 3 | Lifecycle | `status` ∈ {open, mitigating, closed, occurred}. No strict state machine (mirror issues — PATCH just sets status). On transition **into** a terminal state (`closed` or `occurred`) that wasn't terminal before → stamp `resolved_at = now()` + emit the terminal event. |
| 4 | Owner | `owner_id` → `auth.users` (a tenant member); validated on write like issues' `assigned_to`. |
| 5 | Events | Emit `risk_raised` on create; `risk_closed` on →closed; `risk_occurred` on →occurred. Add all three to `ProjectEventType` + the timeline icon map. |
| 6 | Gate/scope | it_agency, `FEATURES.PROJECT_BOARD`; GET = feature-gate only, POST/PATCH = `+ requireAdmin`; `scopedClient`. Identical to issues. No universal files. |

---

## 2. Migration — `supabase/migrations/136_project_risks.sql`

> **136 is correct.** Local chain: 133 invoicing, 134 handoff (renamed from 129 at rebase), 135 timer. Additive, transactional, idempotent, with the `schema_migrations` self-record line (mirror `128_delivery_workflow.sql`'s `project_issues` block + any migration ≥123 for the self-record convention). **Apply locally only** via `scripts/migrate-apply.sh local`.

Model it **exactly** on the `project_issues` DDL in `128_delivery_workflow.sql` (lines ~154–197): same tenant/project FKs (CASCADE), same RLS (SELECT = `tenant_id IN (SELECT get_user_tenant_ids())`; INSERT/UPDATE/DELETE = `is_tenant_admin(tenant_id)`), same `updated_at` trigger, same index shape.

Columns:
```
id            UUID PK DEFAULT gen_random_uuid()
tenant_id     UUID NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE
project_id    UUID NOT NULL REFERENCES projects(id)  ON DELETE CASCADE
title         TEXT NOT NULL
description   TEXT
probability   TEXT NOT NULL DEFAULT 'medium' CHECK (probability IN ('low','medium','high'))
impact        TEXT NOT NULL DEFAULT 'medium' CHECK (impact IN ('low','medium','high'))
mitigation    TEXT                                   -- the response / mitigation plan
owner_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL
status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','mitigating','closed','occurred'))
review_date   DATE                                   -- optional next-review date
opened_at     TIMESTAMPTZ NOT NULL DEFAULT now()
resolved_at   TIMESTAMPTZ                            -- stamped when status → closed/occurred
created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
```
Index: `(tenant_id, project_id, status)`. Attach the standard `updated_at` trigger. Rollback: `DROP TABLE project_risks;`.

---

## 3. API routes (mirror the issues routes precisely)

Preamble on all: `authenticateRequest` → `apiUnauthorized`; `getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)` → `apiForbidden`; `scopedClient(auth)`. POST/PATCH add `requireAdmin(auth) → apiForbidden`. Validate with `validate`/`required`/`isIn`/`maxLength`. Every mutation records a `project_event` via `recordProjectEvent(db, {...})`.

### 3a. `src/app/(main)/api/v1/projects/[id]/risks/route.ts` (copy `projects/[id]/issues/route.ts`)
- **GET** — list risks for the project (scoped), ordered `opened_at desc` (client re-sorts by score). Feature-gate only.
- **POST** (admin) — body `{ title (required, ≤255), description?, probability (isIn low/med/high), impact (isIn low/med/high), mitigation?, owner_id?, review_date? }`. Verify the project belongs to the tenant; if `owner_id` given, verify it's a tenant member (mirror how issues validates `assigned_to`). Insert with `status:'open'`, `opened_at` default. Record `recordProjectEvent(db, { projectId, eventType: "risk_raised", actorId: auth.userId, summary: \`Risk raised: ${title}\`, payload: { risk_id, probability, impact }, subjectType: "risk", subjectId: risk.id })`. Return 201.

### 3b. `src/app/(main)/api/v1/risks/[id]/route.ts` (copy the top-level `issues/[id]/route.ts` PATCH)
- **PATCH** (admin) — accepts `title, description, probability, impact, mitigation, owner_id, status, review_date` (validate enums; verify `owner_id` membership if present). Load current row (scoped) → 404 if missing.
  - Build the patch from provided fields only.
  - **Terminal-transition logic (mirror issue-resolve):** if `status` is provided and is `closed` or `occurred`, and the current status is NOT already terminal (`closed`/`occurred`), set `resolved_at = now()` and emit the matching event: `closed` → `risk_closed` (summary `Risk closed: ${title}`), `occurred` → `risk_occurred` (summary `Risk occurred: ${title}`), each `subjectType:"risk", subjectId:id, payload:{ from, to }`. If moving OUT of terminal back to open/mitigating, clear `resolved_at = null` (reopen) and emit no terminal event.
  - Return the updated row.

(No dedicated resolve/close endpoints — status flows through PATCH, exactly like issues.)

---

## 4. Types — `src/types/database.ts`

- Add:
  ```ts
  export type RiskLevel = "low" | "medium" | "high";
  export type RiskStatus = "open" | "mitigating" | "closed" | "occurred";
  export interface ProjectRisk {
    id: string;
    tenant_id: string;
    project_id: string;
    title: string;
    description: string | null;
    probability: RiskLevel;
    impact: RiskLevel;
    mitigation: string | null;
    owner_id: string | null;
    status: RiskStatus;
    review_date: string | null;
    opened_at: string;
    resolved_at: string | null;
    created_at: string;
    updated_at: string;
  }
  ```
- Add to the `ProjectEventType` union (next to `issue_raised`/`issue_resolved`): `"risk_raised" | "risk_closed" | "risk_occurred"`.

---

## 5. Scoring helper — `src/industries/it-agency/features/project-board/lib/risk.ts` (new)

```ts
import type { RiskLevel } from "@/types/database";
const RANK: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3 };
export function riskScore(p: RiskLevel, i: RiskLevel): number { return RANK[p] * RANK[i]; }
export type RiskBand = "Low" | "Medium" | "High" | "Critical";
export function riskBand(score: number): RiskBand {
  if (score >= 9) return "Critical";
  if (score >= 6) return "High";
  if (score >= 3) return "Medium";
  return "Low";
}
```
(Band → color, in the panel: Low green · Medium amber · High orange · Critical red.)

---

## 6. Hook + Panel + wiring (mirror the issues triple)

### 6a. `hooks/use-project-risks.ts` (new — copy `use-project-issues.ts`)
`useProjectRisks(projectId)` → `{ risks, loading, createRisk, updateRisk, refetch }`. `createRisk(payload)` → POST `/api/v1/projects/${projectId}/risks`; `updateRisk(id, patch)` → PATCH `/api/v1/risks/${id}`; both `await load()` on success, toast on failure. `load()` GETs the list.

### 6b. `components/cockpit/risks-panel.tsx` (new — copy `issues-panel.tsx`)
- Receives `risks`, `loading`, `isAdmin`, `team` (for the owner picker), `onCreate`, `onUpdate` as props (dumb panel; hook lives in the tab — same as issues).
- Sort rows by `riskScore(probability, impact)` **desc**. Each row: title, a **score badge** (`{band}` colored by band, with a compact `P·I` hint), owner name, status; secondary line like issues (`{status} · opened {age}`). Show `mitigation` when present (muted).
- Create form (admin): title, description, **Probability** select, **Impact** select (a live band badge preview is a nice touch), mitigation textarea, **Owner** picker (reuse `AssigneePicker` from `../assignee-picker` like the other panels), optional review_date. Disable while submitting.
- Inline **status** control per row (admin): a select `open / mitigating / closed / occurred` → `onUpdate(id, { status })`. Optionally inline-edit prob/impact via `onUpdate`.
- Match the existing panel visual idiom (Card + list rows + `SEVERITY_DOT`-style color for the band).

### 6c. Wire into `components/cockpit/delivery-tab.tsx`
- Instantiate `useProjectRisks(projectId)` alongside the existing `useProjectIssues` etc.
- Add `<RisksPanel .../>` to the Delivery tab grid. **Suggested placement:** pair **Risks next to Issues** (both are problem registers — risk = potential, issue = actual); keep Milestones + the full-width Change-Requests panel as-is. Use your judgment on the exact grid arrangement, but the RAID/register cluster should read together.
- Pass `team` (already loaded in the tab for assignee pickers) to `RisksPanel`.
- On any create/update, call the tab's `onEventRecorded()` (as the other panels do) so the Timeline refreshes.

### 6d. Timeline — `components/cockpit/timeline-panel.tsx`
Add `risk_raised`, `risk_closed`, `risk_occurred` to the `EVENT_ICON` map with sensible lucide icons (e.g. `risk_raised` → `ShieldAlert` or `TriangleAlert`; `risk_closed` → `ShieldCheck`; `risk_occurred` → `ShieldX` or `Flame`). Import any new icons.

---

## 7. Edge cases (encode + comment)

- **Terminal reopen:** moving `closed`/`occurred` → `open`/`mitigating` clears `resolved_at` and emits no terminal event (comment it).
- **`occurred` vs `closed`:** `occurred` = the risk materialized (bad outcome, often becomes an Issue — see §8 deferred promotion); `closed` = avoided/no-longer-a-threat. Both terminal, both stamp `resolved_at`, but distinct events.
- **Owner deleted:** `owner_id` is `ON DELETE SET NULL` (risk survives, owner blanks) — mirror issues' `assigned_to`.
- **Non-admin:** can GET/read the register (feature-gate) but POST/PATCH → 403 (admin-only), matching issues + the DB RLS.
- **Non-it_agency tenant:** 403 on all routes.
- **Score is derived, never persisted** — changing prob/impact via PATCH re-derives the band on next render; no stored score to drift.

---

## 8. Deferred (note only)
Assumptions + Dependencies registers (same table pattern with a `category` discriminator, or sibling tables — a later additive migration); **risk → issue promotion** (when a risk is marked `occurred`, a "Log as issue" that prefills the Issues create form — mirror the existing issue→change-request prefill in `delivery-tab.tsx`); risk matrix heatmap view; per-risk review reminders (cron on `review_date`); client-visible risk summary; risk roll-up on the portfolio view.

---

## 9. Verification (Sonnet does locally; Opus re-runs)

1. `npm run build` clean; `npx eslint --max-warnings 0` clean on all new/changed files.
2. Apply `136_project_risks.sql` locally; **re-run to confirm idempotency**; exactly one `136_project_risks.sql` row in `schema_migrations`; **confirm 134 was NOT used.**
3. **Dogfood** (local `admin@edgex.local`/it_agency, a project cockpit → Delivery tab):
   - **Add a risk** (probability High × impact High) → appears in the Risks panel with a **Critical** red badge, sorted to the top; a lower P×I risk sorts below with the right band; Timeline shows `risk_raised`.
   - **Assign an owner** (from the team picker) → persists and displays.
   - **Status → mitigating** → updates, no terminal event. **Status → closed** → `resolved_at` stamps, Timeline shows `risk_closed`. Create another → **occurred** → Timeline shows `risk_occurred`. **Reopen** a closed risk → `resolved_at` clears, no new terminal event.
   - Edit probability/impact → the band/badge + sort order re-derive correctly.
4. **Negatives:** non-admin it_agency user → GET risks 200 (read), POST/PATCH 403; non-it_agency tenant → 403; missing title → 422; `owner_id` that isn't a tenant member → rejected.
5. Confirm **Issues / Milestones / Change-Requests panels still render and function** unchanged in the Delivery tab (no regression from the new panel/grid).

---

## 10. Definition of done / hand-back
- `project_risks` (mig 136, mirrors `project_issues` RLS/shape) + `/api/v1/projects/[id]/risks` (GET/POST) + `/api/v1/risks/[id]` (PATCH) with `risk_raised`/`risk_closed`/`risk_occurred` events + terminal-transition `resolved_at` logic.
- `ProjectRisk`/`RiskLevel`/`RiskStatus` types + `ProjectEventType` additions + `lib/risk.ts` scoring.
- `use-project-risks` hook + `RisksPanel` (P×I score badge, owner, status lifecycle) wired into `delivery-tab.tsx` next to Issues; timeline icons.
- **No universal files. My-Tasks/other surfaces untouched.** Build + lint clean; §9 dogfood + negatives pass — especially the score→band sort, the terminal-event/`resolved_at` logic, and no regression to the sibling panels.
- **STOP. Do not commit, PR, push, or touch stage/prod.** Report: files changed, whether the migration used 136 (not 134), dogfood results (scoring, lifecycle events, reopen), negatives, any deviations. Opus reviews the diff, re-runs gates, commits on this branch.
