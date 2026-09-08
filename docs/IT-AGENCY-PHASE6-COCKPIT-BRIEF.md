# IT-Agency Delivery — Phase 6: Cockpit Progressive Disclosure (BUILD BRIEF)

**For:** Sonnet executor session · **Branch:** cut fresh off `origin/stage` as `feature/it-agency-phase6-cockpit` · **Industry:** `it_agency` (scoped) · **Migration:** **NONE** · **Stop at review** — Opus verifies, Sadin merges.

Phase 6 is the last card of the six-phase delivery round (1–5 shipped and are live on prod: #500, #501, #515, #518). It was logged as "cockpit redesign" and never specified. This brief specifies it.

---

## 0. Why this round exists — read before touching anything

A read-only production probe on 2026-09-08 measured the delivery surface for every `it_agency` tenant. Ten projects, all Zunkiree Labs, four months of history:

| Signal | Reality on prod |
|---|---|
| Milestones | **0. Across all ten projects.** |
| Tasks | 20 total (six on the busiest project, zero on two) |
| Time entries | 12 total, ten of them on two projects |
| Internal projects (mig 224) | 0 — every project has an `account_id` |
| Activity | Nothing created between 2026-07-07 and 2026-09-08 |

The project names are real client work (CMS TNC corporate website, BathroomFort, Fifa World Cup 2026 campaign page, UK Education Expo). **The work is real; it is not being run in EdgeX.** Someone creates the project row, then manages the delivery somewhere else.

Zero milestones is the load-bearing fact. Milestones feed the approvals inbox, the milestone lifecycle state machine, milestone-triggered invoicing, and part of the health engine. All shipped, all on prod, **all with no input rows in production.**

**The conclusion this round acts on: the cockpit does not have a layout problem, it has a demand problem.** It asks for an immutable baseline estimate, a Definition of Done, an engagement model and a milestone plan before it gives anything back. So Phase 6 is **subtraction and deferral, not rearrangement, and absolutely not new features.**

> **Sonnet: do not add capabilities in this round.** If you find yourself designing a new panel, a new endpoint, or a new table, you have misread the brief. Every change below either hides something empty, softens something demanding, or fixes something dishonest.

---

## 1. Decisions locked — do NOT re-litigate

| # | Decision | Ruling |
|---|---|---|
| 1 | Migration | **None.** Every change is presentation-layer. The data model is correct; the demands it makes are not. |
| 2 | Deletion | **Nothing is deleted or made unreachable.** This is progressive disclosure. Every panel and every action that exists today must still be reachable in at most one click. Phases 1–3 fixed a discoverability problem — do not recreate it. |
| 3 | Qualify | **Optional enhancement, never a gate.** It never blocks work and never occupies the top of the page by default. |
| 4 | Health | **Never claim "On track" without evidence.** |
| 5 | Task surface rule | Unchanged (FEATURE-CATALOG `home` row). The cockpit Overview shows a *capped summary* linking into the Tasks tab. Do **not** add a second full task list to Overview. |
| 6 | Tabs | All five tabs stay. Hiding tabs trades one discoverability bug for another. Fix what is *inside* them. |
| 7 | Permissions | Untouched. `canManageProjects` / `canManageBilling` gating stays exactly as it is. |

---

## 2. The five changes

### 2.1 — The health banner must stop lying (`components/cockpit/health-banner.tsx`)

`health-banner.tsx:24` reads `project.health ?? "green"`. A brand-new project with zero tasks, zero hours and no baseline renders a **green "On track"** badge as the first element on the page. It is the most prominent thing in the cockpit and it is asserting a fact nobody established.

Add a "no signal yet" state. A project has signal when **either** `qualified_at IS NOT NULL` **or** `actual_minutes > 0`. With no signal:

- render a neutral (muted/slate, not green/amber/red) strip,
- label it **"Not started"**, no RAG icon,
- suppress the progress bar and the `0% / 0.0h` stat cluster entirely — zeros against nothing are noise,
- keep the strip compact; it is a placeholder, not a banner.

With signal, behaviour is exactly as today. `health_override` still wins whenever it is set — an explicit human judgement always outranks this rule.

### 2.2 — Overview leads with work, not ceremony (`pages/project-cockpit.tsx:110-116`)

Today the Overview tab renders, in order: `AiSummaryCard` (flag-gated) → `BriefEditor` → **`QualifyPanel`** → `TasksSummaryCard`. On an unqualified project the Qualify panel is a six-field amber form that dominates the screen, and the tasks — the only thing anyone actually wants — are pushed below it.

Reorder to: `AiSummaryCard` (unchanged) → **`TasksSummaryCard`** → `BriefEditor` → `QualifyPanel`.

`TasksSummaryCard` gets a **"+ New task"** affordance in its header, reusing the existing `TaskCreateDialog` (`components/task-create-dialog.tsx`, shipped in #500) with the project pre-selected. Gate it exactly as `TasksSection` gates task creation today — do not invent a new permission rule. A project's Overview must let you add a task without leaving the page or clearing a gate.

### 2.3 — Qualify becomes an offer, not a wall (`components/cockpit/qualify-panel.tsx`)

The unqualified branch (`qualify-panel.tsx:127-208`) renders an always-open amber card headed "Qualify this project", warning that the baseline is immutable and scope changes must flow through change requests. Amber means *something is wrong*; nothing is wrong with a project that hasn't been estimated.

Replace the always-open form with a **collapsed, neutral-bordered single row**:

- Title: **"Set a baseline (optional)"**
- Sub-line: **"Adds budget tracking, variance and % complete to this project."** — say what you *get*, not what you must surrender.
- A "Set baseline" button expands the existing form in place. **The form itself is unchanged** — same six fields, same `canSubmit` rule (`dod` non-empty AND `baselineHours > 0`), same `onQualify` payload. Only its default visibility and framing change.
- The immutability warning moves from the card description to helper text *inside* the expanded form, next to the submit button, where it is a fact at the point of decision rather than a threat at the point of arrival.

The `canManageProjects === false` branch (`:105-115`) keeps its amber styling but the copy changes from "An admin needs to commit the baseline estimate and Definition of Done before work starts" — which is false, work is not blocked — to something accurate: **"No baseline set. An admin can add one to enable budget and variance tracking."**

The `qualified_at` branch (`:56-102`) is unchanged apart from §2.5.

### 2.4 — The Delivery tab stops showing four empty boxes (`components/cockpit/delivery-tab.tsx:104-148`)

`DeliveryTab` unconditionally renders Issues, Risks, Milestones and Change Requests in a 2×2 grid. On all ten production projects that is four empty cards and a "Commit plan" button.

When **all four** collections are empty and none is still loading, render **one** compact empty state instead of the grid:

- one line of copy: *"No delivery records yet. Add one when the project needs it."*
- four buttons — **Add milestone · Log issue · Raise risk · Request change** — each opening the create affordance that already exists inside the corresponding panel. Lift the create dialogs/forms so they can be triggered from here; **do not duplicate any create logic.** If a panel's create UI is not currently liftable, render that panel alone in its collapsed state rather than copy-pasting its form.
- Gate the buttons on `canManageProjects`, matching each panel's existing rule. A non-manager with nothing to see gets the copy line only.

As soon as **any** collection is non-empty, render the current 2×2 grid exactly as today — but omit the individual panels that are still empty, so a project with two milestones and nothing else shows one panel, not four. The empty ones remain addable from a small "Add" control in the tab header.

The "Commit plan" button keeps its current position and `canManageProjects` gate.

### 2.5 — Currency: the cockpit is hardcoded to dollars, Zunkiree bills in NPR

`src/lib/currency.ts` already exports `formatMoney(amount, currency = "NPR")`. Three cockpit call sites ignore it:

| File:line | Today | Fix |
|---|---|---|
| `qualify-panel.tsx:191` | `<Label>Budget ($)</Label>` | Label reads `Budget ({project.currency ?? "NPR"})` |
| `qualify-panel.tsx` qualified-summary budget row | `${project.budget_amount.toLocaleString()}` | `formatMoney(project.budget_amount, project.currency)` |
| `milestones-panel.tsx:121` | `` ` · $${m.amount.toLocaleString()}` `` | `formatMoney(m.amount, <project currency>)` |

`project-cockpit.tsx:145` already threads `project.currency ?? "NPR"` into `InvoicesPanel` — follow that precedent exactly. `QualifyPanel` already receives `project`; `MilestonesPanel` will need the currency passed down from `DeliveryTab` (which does not currently hold the project — thread it from `ProjectCockpitPage`, which does, rather than adding a fetch).

---

## 3. Explicitly OUT of scope

Do not build, and do not "while I was in there" any of these:

- Tab count badges (needs a counts endpoint — a separate round).
- Any change to milestones, issues, risks, CRs, invoices, status reports or reconciliation **as features** — their panels' internals, APIs and data model are untouched.
- The approvals inbox, milestone lifecycle transitions, invoicing, `commit-plan`.
- Merging, splitting, renaming or removing any of the five tabs.
- The `/projects` workspace (Board/Table/Tasks/Members) — this round is `/projects/[id]` only.
- Sprints, task dependencies, project templates, close/archive, portfolio roll-up. All still open on the roadmap; none is this round.
- The RBAC middle tier (deferred out of #500 and still deferred).
- Anything touching universal files or another industry.

---

## 4. Docs to update in the same PR

- **`docs/FEATURE-CATALOG.md`** — `project-board` row: append the Phase 6 progressive-disclosure pass.
- **`docs/FEATURE-ROADMAP.md`** — three corrections, all of which are stale today and one of which nearly cost a wasted round:
  1. **Line 70 says "Risk register / RAID 'R' (M) ← next pick". It is BUILT AND ON PROD** (`supabase/migrations/136_project_risks.sql`, `api/v1/projects/[id]/risks/route.ts`, `api/v1/risks/[id]/route.ts`). Mark it shipped.
  2. The **Tier 0–4 lines still read "BUILT ON BRANCH / pending merge"** — they merged via #160/#167/#168. Line 204 already says so; correct the tier lines themselves.
  3. Move Phase 6 to shipped and record the probe findings from §0 as the evidence base, so the next session picks from measurement rather than from this document.
- **`docs/SESSION-LOG.md`** — dated entry, including the §0 numbers. They are the most valuable output of this round.
- Archive this brief to `docs/archive/features/` on merge.

---

## 5. Verification — required before the PR

Per `feedback_no_pr_without_local_verification`: green unit tests are not evidence for a UI round.

Gates: `npm run lint` (**not** `npx eslint`) · `npx tsc --noEmit` · `npm run test` · `npm run build` — all clean.

On local dev (`npm run dev`, local Supabase at `127.0.0.1:54321`, an `it_agency` tenant), **screenshot all four**:

1. A **brand-new empty project** — must show "Not started" (no green, no 0%/0.0h cluster), tasks at the top with a working "+ New task", and the collapsed one-line baseline offer. This is the money shot: it is the screen Zunkiree Labs abandoned.
2. The **Delivery tab on that same project** — one empty state with four add buttons, not four empty cards.
3. A project with **one milestone and nothing else** — Delivery shows the milestones panel only, with the other three still addable.
4. A **qualified project with a budget** — the health banner behaves exactly as it does today, and every money value reads in NPR.

Also confirm by clicking, and state it in the report: nothing that was reachable before this round is unreachable after it (decision #2).

**Stop at review. Do not merge.**
