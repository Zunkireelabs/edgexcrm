# PULSE — Build Brief, Slice 1: numbers and rule-based signals (no LLM)

**Ticket:** EDGEX-82 (Plane). **Branch:** `feature/EDGEX-82-pulse` (this brief and the mockups are already committed on it).
**Lead/reviewer:** Opus session (`edgexcrm-69`). **Executor:** you. **Industry:** `education_consultancy` only.
**Stop point:** a PR open to `stage`, CI green, and your report posted. **Do not merge. Do not apply anything to any shared DB.**
The CLAUDE.md "Do Not Touch The Database" rule applies: migrations ship as files in the PR, and you verify them on the
**local** Supabase stack only.

---

## 0. Read first
1. `CLAUDE.md`: industry-module rules, tenant isolation, the two RPC/PostgREST pitfalls (`!inner` embeds, `count:exact`).
2. The AI-native principles (PR #663, not yet on stage):
   `git show origin/feature/EDGEX-81-ai-native-principles:docs/reference/07-AI-NATIVE-PRINCIPLES.md`.
   Pulse is the first feature built to it.
3. **The mockups. They are the spec.** In `docs/pulse-mockup/`:
   - `v2-s1-main.png`: the page. **Build it with every AI element removed** (see §7).
   - `v2-s3-ai-off.png`: **what the briefing and Needs-you slots actually look like in this slice.**
   - `v2-s4-person.png`: the person drawer, **without** the "Orca's read" card.
   - `v1-s3-evidence-drawer.png`: the drawer that opens when you click any number.
   - `v2-s2-ai-design-language.png`: for awareness only. Do not build the AI pieces now, but don't block them either (§9).
   - `pulse-v2.html`: open it in a browser for the exact spacing and colours. Tokens come only from `src/app/globals.css`.
4. Reuse the existing deterministic education reporting:
   - `src/industries/education-consultancy/features/team-performance/`: timezone helper `fetch-tenant-timezone.ts`, window parsing `resolve-window-param.ts`, thresholds pattern `thresholds.ts`.
   - Migrations `241`–`249`: the RPC style, scoping, and the canonical "touched" definition and its test.

## 1. What Pulse is
Pulse is a new page that answers the owner/admin's questions, **per person, for a time window**:
1. Stage moves, by destination stage.
2. Status changes.
3. Notes: new, plus edited.
4. New leads received.
5. Prospects, students who reached Applications, and applications filed.

On top of that it shows **what changed** (rule-based "Key changes") and **what needs the owner** (rule-based "Needs you").
Every number is clickable and opens the exact leads and events behind it.

**In scope:**
- the migration
- the audit-tagging code change
- the RPCs and API
- the rules engine
- the page, the evidence drawer, the person drawer
- the sidebar entry
- tests

**Out of scope** (separate tickets, don't do these):
- any LLM call
- the Home card
- fixing the old Overview's zero cards
- counsellor or role-adaptive views
- scheduled briefings and notifications

## 2. Binding definitions (these are the product; don't reinterpret them)

**Window.** `[from, to)`, computed in the **tenant timezone**. Presets: `24h` (rolling), `7d`, `30d`, and `custom` (whole days,
tenant tz). **Previous** = the window of equal length immediately before it. **Usual** (per person, per metric) = the mean of
the 4 equal-length windows before the current one. Show it as "usual N" or as a ±% delta, exactly like the mockup.

**Actor (the "Did" columns)** = `audit_logs.user_id`.

**Holder (the "Owns" columns)** = the person holding the lead when the event happened. Resolve it in this order:
1. `changes.holder.new` (written on stage moves since the holder change).
2. `changes.assigned_to.new` in the same audit row.
3. Otherwise the lead's assignee as of that time. Reconstruct it from the latest prior `assigned_to` audit change. If you can't, fall back to the current `leads.assigned_to` and **count how often that fallback fires** (report it).

**Stage move** = `audit_logs` row with `entity_type='lead'`, `action IN ('lead.updated','lead.graduated')`, and
`changes ? 'list'`.
- Destination = `changes.list.new`, a list **name**.
- From this PR on, also read `changes.list_ids` (§4) and prefer ids when present.
- Map names to the tenant's current `lead_lists` rows by name. If a name no longer matches any list, bucket it as "Other stage" and count it.
- **Forward** = the destination `sort_order` is greater than the origin's.
- **Back** = it is smaller.
- **Out** = back, or the destination is the archived list.
- Admin-only lists (Migration QC etc.) are excluded everywhere, matching the existing admin-only list rule.

**Status change** = an audit row where `changes ? 'status'` and the old value ≠ the new value.

**Notes.** `lead_notes` has no `tenant_id`: join through `leads.tenant_id`.
- **New** = `created_at` in the window.
- **Edited** = `edited_at` in the window and `edited_at > created_at + 1 minute`. We only store the *last* edit, so the label is "edited in window".
- **Exclude** AI-written notes (`ai_tool_call_id IS NOT NULL`) and notes on soft-deleted leads.

**Calls** = `lead_activities.activity_type = 'call'` by `user_id`.

**New leads received** = the person became the assignee in the window. That means an audit change where `changes.assigned_to.new = person` and old ≠ new, **plus** leads created in the window with `assigned_to = person`.
- Find how initial assignment by form routing and auto-assignment is recorded. If it isn't audited, read `leads.created_at` + `assigned_to`.
- Make sure the two sources never double-count.

**Prospects (Owns)** = stage moves *into* the Prospects list in the window, attributed to the **holder**, counted once per lead.

**Students reached Applications (Owns)** = the same rule for the Applications list. This is the headline conversion.

**Applications filed (Owns)** = `applications.created_at` in the window, `deleted_at IS NULL`, attributed to `applications.assigned_to`. Fall back to the lead's holder if that is null.

**Bulk moves.** These are not counted in anyone's "Did" columns. They are shown in the "Not in scores" bar instead.
- **From this PR on:** the bulk route writes `changes.via = 'bulk'` (§4).
- **Historical heuristic** (before the tag existed): a stage-move audit row counts as bulk if the same actor wrote ≥ 20 stage-move rows within the same 60-second bucket. Keep the threshold in config.
- "Received" counts still include bulk *assignments*: they reflect what the person got.

**Funnel strip:**
- New leads in = `leads.created_at` in the window, not deleted. Exclude bulk imports; find the existing import-batch marker. If none exists, say so in your report, but don't invent one.
- Show forward and out counts between consecutive core stages (Pre-qualified → Qualified → Prospects → Applications).
- Show the 1.5× applications-per-student figure as filed ÷ students.

**Scope.** Owner and admin only, for now. They see all branches, with the existing branch selector in the top bar applying as a
filter. Everyone else gets 403/404.

## 3. Migration `280_education_pulse.sql`
280 is the next free number (check `origin/stage` and open PRs again right before you commit).
- Follow `_TEMPLATE.sql`: transactional, additive, a rollback line, expected before/after counts, and "Applied: stage HELD / prod HELD".
- **Index:** a partial index on `audit_logs (tenant_id, created_at)` `WHERE entity_type = 'lead' AND action IN ('lead.updated','lead.graduated')`. Report the stage `audit_logs` row count from local data and the lock implications. If it's large, raise it in your report; don't silently switch to `CONCURRENTLY`, because the runner is transactional.
- An index for notes-by-time if `EXPLAIN` shows you need one (`lead_notes(created_at)` or `(user_id, created_at)`).
- **RPCs:** model them on `education_relay_aggregates` (mig 241), with the same security pattern, `search_path`, and grants.
  - `education_pulse_person_stats(p_tenant_id, p_from, p_to, p_branch_id NULL)`: one row per user with every scoreboard column, including the stage-move breakdown as JSON keyed by destination list, plus the bulk tallies.
  - `education_pulse_funnel(p_tenant_id, p_from, p_to, p_branch_id NULL)`.
  - `education_pulse_events(p_tenant_id, p_from, p_to, p_user_id NULL, p_metric TEXT, p_detail TEXT NULL, p_limit, p_offset)`: the rows behind any number, for the drawer (lead id, display id, name, from → to, when, actor, holder).
  - **"Usual"** = 4 extra windows. Compute it with one RPC call over the full 5-window span returning per-window buckets, not 5 round-trips, if you can do that cleanly. Otherwise explain why not.
- **Performance gate:** `EXPLAIN ANALYZE` on local data with Admizz-scale volume. The full page's queries must total **under 1.0s**. Put the plans in your report.

## 4. Code change: make the audit trail exact going forward
- In the shared stage-move audit helper (`src/lib/leads/stage-move-audit.ts`) and **every** writer of `changes.list`, also write `changes.list_ids = { old, new }`. The writers are:
  - `apply-lead-patch.ts`
  - `leads/bulk/route.ts`
  - `archived-leads/[id]/restore`
  - `class-enrollments`
  - `check-in`
  
  Grep for `changes.list =` and confirm the list is complete.
  - Keep the existing `list` (names) unchanged: System Activity reads it.
  - **Don't** touch `previousValues` (the undo source).
- In `leads/bulk/route.ts`, add `changes.via = 'bulk'`.
- Unit tests for both, following the existing audit tests.

## 5. API (industry-scoped)
`src/app/(main)/api/v1/pulse/...` → the handlers live in the feature folder. Every route:
`authenticateRequest()` → `getFeatureAccess(auth.industryId, FEATURES.PULSE)` (403) → owner/admin check (403) → `scopedClient(auth)`.
- `GET /api/v1/pulse?window=7d|24h|30d|custom&from&to&branch=`: returns the scoreboard, funnel, previous/usual values, bulk bar and computed signals (§6), in one call.
- `GET /api/v1/pulse/events?...`: the drawer rows, paginated.
- `GET /api/v1/pulse/people/[userId]?window=`: the person drawer (KPIs against usual, daily series, recent events).

## 6. Signals engine (rules, no LLM)
`features/pulse/lib/signals.ts`: **pure functions** taking the computed numbers and returning signals. Each signal is:

```
{ id, kind, severity: 'high'|'medium'|'info', title, detail, evidence: { metric, value, baseline },
  subject: { type: 'person'|'stage'|'branch'|'team', id }, drill: <events query params>, action?: 'reassign'|'open' }
```

Thresholds live in `tenants.config.pulse_thresholds` with code defaults, following the `team-performance/lib/thresholds.ts` pattern:

| Signal | Rule (default) | Goes to |
|---|---|---|
| Activity drop | person's calls+notes+moves ≤ 40% of usual **and** usual ≥ 10 | Key changes + Needs you (reassign) + **red** row flag |
| Untouched new leads | reuse `education_intake_alarm` (mig 242): leads older than 48h with no touch | Needs you (reassign) |
| Over capacity | leads received ≥ 1.8× usual **and** ≥ 20 | **amber** row flag + Key changes |
| Stage leak | out-rate from a stage ≥ 2× previous **and** ≥ 10 leads | Key changes |
| Top mover | largest positive delta on Students reached Applications (or Prospects) | Key changes (green) |
| Biggest drop | largest negative KPI delta, broken down by branch | Key changes |

- At most 4 Key changes and 4 Needs-you items, sorted by severity and then magnitude.
- **"Reassign"** opens the **existing** lead bulk-reassign flow, pre-filtered to those leads. Add **no new write path**.

## 7. UI: match the mockup, minus AI
- Feature folder `src/industries/education-consultancy/features/pulse/`, with `meta.ts`.
- Add `FEATURES.PULSE = "pulse"` in `_registry.ts`.
- Register it in the education manifest.
- Sidebar: label "Pulse", icon `"Activity"` (register it in `INDUSTRY_ICONS` if missing), `minRoles: ["owner","admin"]`, placed **first in the Intelligence section, above Dashboards**.
- Page shell `src/app/(main)/(dashboard)/pulse/page.tsx`: `getFeatureAccess → notFound()`, plus a role check.

**Build exactly these regions from `v2-s1-main.png`:**
1. **Header:** title, subtitle with the window dates, window tabs (24h / 7d / 30d / Custom), role filter, Export (CSV of the scoreboard).
2. **Briefing slot:** render it as **`v2-s3-ai-off.png`** shows: a plain card titled "Key changes this week", the info icon, no gradient, and the lines from §6.
   - Omit the "Turn on Orca" note.
   - Build the card as `PulseBriefingCard` with a `source: "rules" | "ai"` prop. Only `"rules"` is implemented now.
3. **Needs you:** the same layout as the mockup, with the "by rule" label, a red/amber/blue left bar, and Open/Reassign buttons. No "Review & approve" yet.
4. **Funnel strip:** four stages, the connectors with conversion % and the "out" chip, and sparklines.
   - Sparklines come from the per-day series of the same RPC data. **No AI note.**
5. **Team scoreboard:**
   - **Layout:** the column groups ACTIVITY / RESULTS, grouped by position (TeleCaller / Executive / Counsellor / App Executive, from `tenant_users` position), and a Sort control.
   - **Each cell:** an in-cell magnitude bar (relative to the column max) and a "usual N" or ±% sub-line.
   - **Each row:** a trend line against usual.
   - **Bottom:** the "Not in scores" bulk bar.
   - **Rule flags** use a **red** (drop) or **amber** (capacity) left edge, never violet. Violet and the gradient spark are reserved for AI.
   - **Omit:** the AI row notes, the note-quality dots and their legend, and the AI icon in the Notes header.
6. **Evidence drawer** (`v1-s3-evidence-drawer.png`): every number in the funnel, scoreboard, Key changes and Needs you opens it.
   - It shows a paginated events list and an "Open all N in Leads" link, using the existing leads filter/query params where possible.
   - **No dead numbers.**
7. **Person drawer** (`v2-s4-person.png`): opens when you click a name. It shows 4 KPI tiles against usual, the daily activity chart with the dashed "usual" line, and the "What they did" timeline. **Omit the Orca card.**
8. **States:** loading skeletons, an empty state (`v1-s5-home-and-empty.png`, right side), and an error state.
   - **Responsive:** below 1440px the scoreboard scrolls horizontally with a sticky Person column.

Use the existing shadcn/ui components, lucide icons and recharts (or plain SVG for the sparklines). Don't add new dependencies.

## 8. Tests (all must run in `npm run test`)
- `signals.test.ts`: every rule, its threshold edges, and the ordering/caps.
- Definition tests:
  - forward/back/out from `sort_order`
  - holder resolution order
  - bulk heuristic (exactly 20 vs 19 in 60s)
  - notes exclusions (AI notes, deleted leads)
  - the received-leads de-duplication
- Window/timezone tests with a **non-Kathmandu timezone** (e.g. `America/Los_Angeles`) so day-boundary bugs can't hide (we've been bitten before).
- Route tests: non-education tenant → 403; viewer/counsellor → 403; owner/admin → 200. Also the page shell → `notFound()` for other industries.
- The audit change: `list_ids` and `via` are present on each writer.

## 9. AI touchpoints (required section; the AI layer itself is deferred)
- **Observe / Hold accountable:** built now as **rules** (§6). Every signal carries evidence and a drill-down, so a later LLM layer can read signals and never raw rows.
- **Explain / Recommend / Act:** deferred. Leave the seams:
  - the `PulseBriefingCard source` prop
  - the signals as typed JSON
  - a `pulse_ai` flag check stubbed to `false` behind `src/lib/ai/flag.ts`
- **Note quality:** deferred. Don't build the dots.
- **Guardrails:** owner/admin only, tenant-scoped, works fully with AI off (this slice *is* the AI-off mode).
- Add a "Pulse AI layer" row to the touchpoint register in the PR description. Don't edit doc 07 on this branch.

## 10. Verify before opening the PR (non-negotiable; see the memories on local verification)
1. Apply mig 280 to the **local** Supabase only. Seed or use `admizz-local` with realistic volume.
2. `npm run build`, `npx eslint --max-warnings 50`, `npm run test`: all green.
3. Click through `npm run dev` as an owner of an education tenant and as a non-education tenant. Screenshot every region and
   put each next to its mockup scene with a **gap list**. Cross-check 3 numbers by hand against raw SQL.
4. Report the `EXPLAIN ANALYZE` totals (< 1.0s) and the holder-fallback rate.
5. Open the PR to `stage`, titled `EDGEX-82: Pulse — team activity report (slice 1, no LLM)`. The body includes the AI-touchpoints section, the screenshots, and the gap list.
6. Move EDGEX-82 to **In Review** in Plane with the PR link. **Stop. Do not merge.** The Opus session reviews and re-runs the gates independently.

## 11. Open questions: stop and ask Opus. Don't guess.
- If you find no bulk-import marker for "New leads in".
- If initial assignment isn't recorded anywhere you can read.
- If the `audit_logs` index looks risky to build inside a transaction at stage/prod scale.
- If list names in historical audit rows don't match current lists for more than 5% of moves.
