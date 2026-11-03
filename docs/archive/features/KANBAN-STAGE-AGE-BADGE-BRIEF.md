# Brief: Kanban card "days" badge should track stage/status change only, not any edit

## Context

Kanban lead card (`src/components/pipeline/LeadCard.tsx`) shows a red/amber "14d" clock badge.
Currently it's `getDaysInStage(lead.updated_at)` — days since the `leads.updated_at` column last
changed. `leads.updated_at` is auto-bumped by a DB trigger (`trigger_leads_updated_at`,
`supabase/migrations/001_initial_schema.sql:101-103`) on **any** UPDATE to the leads row — editing
a tag, reassigning, editing a custom field, etc. all reset it. That's wrong: the badge should mean
"how long has this lead been sitting in its current stage/status," not "when was any field last
touched."

## Requirement (from Sadin)

1. The clock badge should reset **only** when the lead moves to a new pipeline stage (`list_id`)
   or a new `status`. Any other field edit (note, tag, custom field, assignment, etc.) must NOT
   reset it.
2. Separately, show — to the **left of the clock badge** in the card footer — a small
   "last changed" indicator reflecting the existing broad `updated_at` (any change, any field).
   Two distinct signals side by side: stage-age (right, colored) + last-touched (left, neutral).

## Plan

### 1. Migration — new column `supabase/migrations/195_leads_stage_changed_at.sql`

```sql
BEGIN;
ALTER TABLE leads ADD COLUMN stage_changed_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Backfill: best guess is current updated_at, since we have no history of past stage moves.
UPDATE leads SET stage_changed_at = updated_at;
COMMIT;
```

No RLS changes needed (existing leads RLS covers all columns). Additive + reversible (drop column
to roll back). Follow the standard migration checklist in `docs/dev-collab/DEV-WORKFLOW-AND-DEPLOYMENT.md`
(stage first, verify, then prod at promotion — never hand-apply prod without per-action approval).

### 2. Backend — set `stage_changed_at` only on stage/status change

Every write path that can change `list_id` or `status` on a lead must explicitly set
`stage_changed_at: new Date().toISOString()` in that same update payload, **conditionally** —
only when the incoming patch actually changes `list_id` or `status` vs. the current row (compare
before writing, same pattern likely already used for other conditional side-effects in these files).

Known call sites (grep to confirm none were missed — search `.from("leads")` + `.update(` across
`src/app/(main)/api/v1/leads/`):

- `src/lib/leads/apply-lead-patch.ts` (~line 784-786) — the funnel for single-lead PATCH
  (`/api/v1/leads/[id]`). This handles status dropdown changes and stage/list moves along with
  everything else — needs a diff check: if `patch.list_id !== undefined && patch.list_id !== current.list_id`
  OR `patch.status !== undefined && patch.status !== current.status`, add `stage_changed_at` to the
  update payload.
- `src/app/(main)/api/v1/leads/bulk/route.ts` (~line 292-295, bulk PATCH handler) — bulk stage/list
  move, bulk status change. Same conditional logic.
- `src/app/(main)/api/v1/leads/[id]/branches/[branchId]/route.ts` (~line 194) — branch-level
  assignment; check if this path ever changes `status`/`list_id` (likely not — assignment only —
  confirm and skip if so).
- `src/app/(main)/api/v1/leads/[id]/check-in/route.ts` (~line 179, 303) — check-in triage update
  and auto-promote-on-check-in; the auto-promote (moving a lead to Prospects) IS a stage change —
  must set `stage_changed_at`.
- `src/app/(main)/api/v1/leads/[id]/convert/route.ts` (~line 140) — convert lead to contact;
  check whether this changes `status`, set `stage_changed_at` if so.
- Drag-and-drop kanban move — find the frontend drag handler in
  `src/components/pipeline/` (kanban board component, not LeadCard.tsx itself) and confirm it goes
  through the same PATCH endpoint / `apply-lead-patch.ts` funnel (it should — verify, don't
  duplicate the logic client-side).

Do NOT touch: notes, checklists, collaborators, consent, activities/call-logs, merge/merge-undo,
AI insights scoring (`leads/[id]/insights/route.ts`) — none of these should set `stage_changed_at`
(AI insights already correctly excluded from the "stage" concept; leave `updated_at` trigger as-is
for those, that's the "any change" signal).

### 3. API response / types

- Add `stage_changed_at: string` to the `Lead` / `PipelineLead` interface in
  `src/types/database.ts` (near line 538, `PipelineLead extends Lead`).
- Find the kanban board's per-column lead-fetch query (grep `PipelineLead` usage under
  `src/app/(main)/(dashboard)/leads/` and its API route) and add `stage_changed_at` to the
  `.select()` column list — it's a new column, won't come back unless explicitly selected.

### 4. Frontend — `src/components/pipeline/LeadCard.tsx`

- Line 42-45 `getDaysInStage(updatedAt)` — rename param usage to read `lead.stage_changed_at`
  instead of `lead.updated_at` at the call site (line 90: `getDaysInStage(lead.stage_changed_at)`).
  Keep the function itself generic (it just takes an ISO date string).
- Add a second small "last changed" text to the LEFT of the clock badge in the footer
  (`div` at line 224-230, `flex items-center gap-1.5` container that currently only holds the
  clock badge + phone/email action chips). New element goes first in that flex row, before the
  clock badge div:
  ```tsx
  <span className="text-[10px] text-muted-foreground" title={`Last changed ${formatDate(lead.updated_at)}`}>
    {formatRelativeDays(lead.updated_at)}
  </span>
  ```
  Add a small `formatRelativeDays` helper near the other formatters (line 59-67) — reuse the same
  day-diff math as `getDaysInStage` but render neutral text like `"Updated 2d ago"` / `"Updated today"`
  (no color coding, no urgency styling — this one is informational only, not a staleness alarm).
  Keep it compact so the footer row doesn't wrap on narrow kanban columns — test at the card's
  actual rendered width, not just full-screen.

### 5. Verify before shipping

- `npm run build` clean.
- Manual: move a lead to a new stage → badge resets to "Today", left-side "last changed" also
  shows "Today" (both changed together, expected — a stage move IS an update).
- Manual: add a note / edit a tag / edit a custom field on a lead WITHOUT moving stage → badge
  stays at its prior day count, left-side "last changed" text resets to "Today" (this is the
  key behavior split to verify).
- Manual: bulk-move a multi-select of leads to a new stage → all badges reset.
- Manual: drag-drop a card to a new column → badge resets (confirms drag-drop routes through the
  same patch path that sets `stage_changed_at`).
- Check existing kanban tests (`grep -rl "getDaysInStage\|LeadCard" src/**/*.test.ts*`) — update
  any that assert on `updated_at`-driven badge behavior.

### Open question for Sadin (flag, don't decide silently)

Backfill sets `stage_changed_at = updated_at` for all existing rows on migration day — meaning
every existing lead's badge will show whatever `updated_at`-based age it already had (no artificial
reset for old leads). This is the only sane backfill without real stage-history data. Note it in
the PR description so it's not mistaken for a bug when every card doesn't suddenly go green.
