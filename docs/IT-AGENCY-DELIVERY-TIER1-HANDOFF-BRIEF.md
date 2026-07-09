# it_agency Delivery — Tier 1: Deal/Proposal → Project handoff

**For:** Sonnet executor · **Reviewed by:** Opus (stop-at-review; do NOT merge/deploy) · **Size:** M
**Branch:** new, off **latest** `origin/stage`. `git fetch origin && git switch -c feature/it-agency-deal-project-handoff origin/stage` (stage now includes migration 128).
**Migration:** yes — **129** (additive; verify `ls supabase/migrations | sort` → 128 is highest, so 129 is next-free).

---

## Why (both `/pm-it-agency` and `/coo-it-agency` ranked this #1)

Converting a won deal to a project **drops the accepted proposal entirely**. Today `convert-to-project` inserts only 8 fixed fields (`account_id`, `name`, `owner_id`, `notes`←`deal.description`, `is_billable:true`, `default_rate:null`, `status:"planning"`, `deal_id`) and **never queries `proposals`, `proposal_line_items`, or `deal_contacts`**. Every mig-128 baseline column is left NULL. So at the Qualify gate the PM **re-keys the baseline estimate, budget, rate, scope, and client contacts from memory** — when the priced, hour-loaded SOW already exists one table away. This is "estimate amnesia" built into the seam. Fix it and every downstream metric (health, variance, and later margin + AI-synth) gets more accurate for free.

**Design principle (unchanged):** *agent drafts & surfaces, human decides & commits.* Seeding **pre-fills** the Qualify panel — it does **NOT** auto-qualify. The human still reviews and commits the baseline (which stamps `qualified_at`). We're removing blank re-entry, not auto-committing a number.

---

## Migration 129 (additive, transactional, self-recording)

```sql
BEGIN;

-- Bind a seeded project back to the specific accepted proposal it was built from
-- (COO gap #2: "see the SOW you're delivering against"). Nullable; SET NULL on delete.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS project_id UUID
  REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_proposals_project_id ON proposals(project_id);

-- projects has no currency column; budget_amount/default_rate are ambiguous without one.
-- Additive, nullable; seeded from the proposal/deal at conversion. (Tier 2 margin needs this too.)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS currency TEXT;

-- REQUIRED self-record (Migration Guard, mig 123 convention)
INSERT INTO public.schema_migrations (version) VALUES ('129_deal_project_handoff.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Rollback:
--   ALTER TABLE proposals DROP COLUMN IF EXISTS project_id;
--   ALTER TABLE projects DROP COLUMN IF EXISTS currency;
```
Before/after: additive columns only, 0 rows touched. Apply dev-first (local → stage via the gated runner on merge).

---

## The seeding logic — rewrite `convert-to-project` route

**File:** `src/app/(main)/api/v1/deals/[id]/convert-to-project/route.ts`

Keep everything it does today (auth, feature gate, `scopedClient`, double-conversion guard on unique `projects.deal_id`, account resolution). **Add** before/around the project insert:

### 1. Find the accepted proposal for this deal
```
proposals WHERE deal_id = <id> AND status = 'accepted'  → pick latest accepted_at (there should be one; handle 0 gracefully)
```
If **none accepted**, skip all proposal seeding and fall back to today's behavior (do NOT block conversion). Log that no accepted proposal was found.

### 2. Load its line items + deal contacts
- `proposal_line_items WHERE proposal_id = <accepted.id>` → for `hours` and totals.
- `deal_contacts WHERE deal_id = <id>` → `(contact_id, role)`.

### 3. Seed the project insert from the proposal (draft baseline — NOT qualified)
Map exactly (all target columns confirmed in recon):

| project column | source | conversion |
|---|---|---|
| `brief` | `proposals.notes` (SOW scope narrative) | — |
| `baseline_estimate_minutes` | `SUM(proposal_line_items.hours)` | **× 60, rounded** (proposal hours are NUMERIC; column is INTEGER minutes) |
| `current_estimate_minutes` | same as baseline | baseline == current at qualify start |
| `budget_amount` | `proposals.total` | — |
| `default_rate` | `proposals.total ÷ SUM(hours)` | only if `SUM(hours) > 0`, round 2dp; else `null` |
| `currency` | `proposals.currency` ?? `deals.currency` | — |
| `deal_id` | (already set) | — |

**Do NOT fabricate** `engagement_model`, `target_end_date`, `start_date`, `definition_of_done` — no clean source in the proposal; leave NULL for the human to set at Qualify. (Optional hint: you *may* infer `engagement_model` from `proposal_line_items.billing_type` if unambiguous — but if fuzzy, leave NULL. Don't guess.) Keep `notes` ← `deal.description` as today (distinct from `brief`).

### 4. Bind the proposal to the new project
After insert, `UPDATE proposals SET project_id = <newProject.id> WHERE id = <accepted.id>`.

### 5. Copy deal contacts → project contacts
`project_contacts` has an **identical shape + role enum** to `deal_contacts` (`primary|technical|billing|other`) — straight copy: insert `(project_id, contact_id, role)` for each deal contact. Use `ON CONFLICT (project_id, contact_id) DO NOTHING`. This carries the **billing contact** forward (needed for Tier-2 invoicing).

### 6. Stamp provenance in the decision ledger
Record a `project_events` row via `recordProjectEvent(db, …)` capturing the causal link (this is the institutional-memory value COO/PM both flagged):
- add a new `ProjectEventType` value, e.g. **`baseline_seeded_from_proposal`**, to the union in `src/types/database.ts` **and** a timeline icon in `timeline-panel.tsx` (follow the existing `milestone_rejected` precedent — union entry + icon map).
- `summary`: e.g. `"Baseline seeded from PROP-#### — 120h / $X"`; `payload`: `{ deal_id, proposal_id, baseline_minutes, budget_amount, default_rate, currency, contacts_copied: n }`; `subjectType: "proposal"`, `subjectId: proposal.id`.

All writes go through `scopedClient(auth)`. Sequential writes (no multi-table txn), matching the codebase's existing junction-table pattern — order: insert project → update proposal.project_id → insert contacts → record event. If a later step fails, the project still exists (acceptable; conversion is not lost); log failures.

---

## Optional stretch (only if time; else follow-up) — surface the SOW in the cockpit

Now that `proposals.project_id` links them, add a small **"Source proposal"** read-only reference in the cockpit Overview (near Brief/Qualify): proposal number + total + a link to the proposal. Delivers COO gap #2 fully. If it adds real surface, ship as a separate PR — the core handoff is the priority.

---

## Acceptance checklist (Opus reviews)

- [ ] Migration 129 applied dev-first; additive; self-record line present; passes Migration Guard.
- [ ] Convert a won deal **with** an accepted proposal → new project has: brief (from SOW notes), baseline & current estimate = round(Σ hours × 60), budget = proposal total, default_rate = total÷hours, currency set, deal contacts copied (incl. billing), `proposals.project_id` bound, and a `baseline_seeded_from_proposal` ledger event on the Timeline.
- [ ] The seeded project is **NOT** auto-qualified (`qualified_at` still NULL — human commits at Qualify).
- [ ] Convert a deal with **no** accepted proposal → falls back to today's behavior, conversion succeeds, no crash.
- [ ] Hours→minutes conversion correct (e.g. 120.0 hours → 7200 minutes); rate math correct; `SUM(hours)=0` → `default_rate` null (no divide-by-zero).
- [ ] Double-conversion guard still holds (unique `projects.deal_id`).
- [ ] All queries via `scopedClient`; tenant isolation intact; `npm run build` + tsc + lint clean.
- [ ] Stop at review — do NOT merge/deploy.

## Non-goals
No invoicing (Tier 2). No cost rate/margin (Tier 2). No project-currency conversion math. No editing of proposals/line-items here. No auto-creation of tasks/milestones from line items (a reasonable *future* extension — flag it if you see the seam, but out of scope now).
