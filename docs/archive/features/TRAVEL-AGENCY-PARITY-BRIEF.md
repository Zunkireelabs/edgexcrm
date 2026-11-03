# Travel Agency Feature Parity — Build Brief

**Author:** Opus (planner) · **Executor:** Sonnet · **Date:** 2026-06-21
**Branch:** `feature/travel-agency-parity` (branch off `origin/stage`)
**Goal:** Bring four Admizz (education) features to the `travel_agency` industry for a **live Arya Travels pitch today**, demoed on **stage/dev** (`dev-lead-crm.zunkireelabs.com`). No prod promotion required for the pitch.

---

## ⚠️ Process rules (read first — non-negotiable)

1. **STOP AT REVIEW. Do NOT merge, do NOT push to stage, do NOT apply any migration.** Hand the branch back to Opus for review. Opus applies migrations to the shared DB in a transaction with before/after counts. (You have overstepped this gate before — don't.)
2. **dev + prod share ONE Supabase DB.** Every DB write is prod-affecting. Migrations are **additive-only** (INSERT/UPDATE/ALTER ADD), never DROP/DELETE, always `ON CONFLICT DO NOTHING` / idempotent.
3. **Do NOT break Admizz (education).** Every change must keep education behavior **byte-identical**. This is the #1 review criterion. After every "promote to `_shared`" move, `grep` for the old import path and confirm zero stragglers; `npm run build` must be clean.
4. **Promote, don't copy** (per CLAUDE.md): move shared features into `src/industries/_shared/features/` with `git mv` to preserve history, then update both education's and travel's manifests to opt in. No cross-industry imports, no copy-paste folders.
5. **Sidebar icons are string names**, not `LucideIcon` imports (serialization boundary). Register any new icon name in `INDUSTRY_ICONS` in `src/components/dashboard/shell.tsx` if missing.
6. **New tenant-touching queries** use `scopedClient(auth)`. Don't add raw `createServiceClient()` calls.
7. **Gates run through the loader**, not string checks. Prefer `getFeatureAccess(industryId, FEATURES.X)` over `industry_id === "..."`. Where you must relax an existing `isEducation` string gate, replace it with a feature-access check (details per workstream).
8. Run **both** gates before handoff: `npm run build` (clean) **and** `npx eslint --max-warnings 50` (report the *actual* warning count).

---

## Scope (4 workstreams)

| # | Workstream | Type | Risk | Blast radius |
|---|---|---|---|---|
| 1 | **Dashboard leak fix** (global `/dashboard` StatsCards + charts) | Industry-neutral refactor | Low | All non-education tenants (it_agency/Mobilise/travel) — education redirects away, so **zero education risk** |
| 2 | **Email** (Gmail unified inbox/compose) → `_shared`, opt travel in | Promote, no rename | Low–Med | Education (must stay identical) + travel |
| 3 | **Check-in** (walk-in capture) → `_shared`, opt travel in, light rename | Promote + config | Low–Med | Education + travel |
| 4 | **Lead Lists** (lifecycle buckets) → generic mechanism for travel + seed | Relax gates + seed | Med | Education + travel |

**Out of scope (do NOT build):** Campaigns (education-specific prediction-leaderboard, intentionally skipped), the full Insights dashboard-builder (`/insights`), study-abroad structured fields (destinations/field_of_study/degree_level) for travel.

---

## Reference facts (verified against current code + shared DB, 2026-06-21)

- **Arya Travels tenant** exists in the shared DB: `id = a47a0000-0000-4000-8000-000000000001`, slug `arya-travels`. It is **NOT in any seed script/migration** (was applied directly). It has **0 lead_lists, 11 leads (all `list_id IS NULL`)**.
- **Travel pipeline stages** (mig `043`): `New Inquiry → Qualifying → Itinerary Sent → Revising → Booked (terminal won, green #22c55e) → Lost (terminal lost, red #ef4444)`. Arya leads carry the stage **slug** in `leads.status` (e.g. `new-inquiry`, `booked`), NOT the legacy `new/contacted/enrolled/rejected` enum.
- **`leads.list_id`** (and `destinations`, `field_of_study`, `degree_level`, `archive_reason`) were added to the `leads` table **un-gated** in mig `059` — they already exist for travel leads. So workstream 4 is **data-only** (seed + backfill), no `ALTER`.
- **Travel manifest** (`src/industries/travel-agency/manifest.ts`) currently registers only `itineraryMeta` + shared `formBuilderMeta`; sidebar = Itineraries, Forms. AI config is empty (`{}`).
- **Latest migration is `061`.** New migration → `062`.

---

## Workstream 1 — Dashboard leak fix (do this first; it's the safest, highest-visibility win)

**Problem:** `src/app/(main)/(dashboard)/dashboard/page.tsx` is the global dashboard for all **non-education** tenants (education redirects to `/insights/dashboards` at line 13 — leave that redirect alone). It renders:
- `StatsCards` (`src/components/dashboard/stats-cards.tsx`) — hardcodes 5 cards keyed on the **legacy** statuses `total/new/contacted/enrolled/rejected`, with an **"ENROLLED" card + `GraduationCap` icon** (lines 3, 11). For travel (status = stage slugs) this shows Total=11 and **four zero cards** labeled NEW/CONTACTED/ENROLLED/REJECTED. Embarrassing.
- `LeadsByCounselorChart` (`src/components/dashboard/charts/`) — title "Leads by Counselor", education term.

**Fix — make StatsCards pipeline-stage-driven (industry-neutral):**
1. The dashboard page already fetches `stages` (`getPipelineStages`). Pass `stages` into `StatsCards`.
2. Derive cards from the tenant's actual stages instead of hardcoded legacy statuses. Recommended card set:
   - **Total** (all leads)
   - **New** — the default/first stage (`is_default` or `position === 0`)
   - **In Progress** — non-terminal, non-default stages (sum)
   - **Won** — terminal stage with the "won" color/flag; **label = that stage's name** (Booked for travel, Enrolled for education-if-it-ever-rendered, Closed for it_agency)
   - **Lost** — terminal "lost" stage; label = its name (Lost / Rejected)
   - Count leads by mapping `lead.stage_id → stage`, falling back to matching `lead.status` against the stage `slug` (travel data uses slugs in `status`). Don't hardcode `enrolled/rejected`.
   - Pick icons that aren't education-specific (drop `GraduationCap`; use e.g. `CheckCircle2` for Won, `XCircle` for Lost, `Users`/`UserPlus`/`Activity` for the rest).
3. Keep the existing click-to-filter behavior working (the filter currently emits a status key; keep it functional, mapping to stage where applicable — if filter wiring gets complex, it's acceptable for the cards to stay informational for now, but say so explicitly in handoff).
4. **Rename the chart:** `LeadsByCounselorChart` title "Leads by Counselor" → **"Leads by Team Member"** (industry-neutral). Grep for the title string; update only the display label, not the component name/props unless trivial.

**Constraints:**
- `grep` for `StatsCards` usages first — confirm the global dashboard is the only consumer (if education's Insights uses a *separate* widget, don't touch it).
- Education never renders this page (redirect), so there is **no education regression surface here** — but still verify Mobilise/it_agency dashboards look sane (Total + stage-based cards).

---

## Workstream 2 — Email (Gmail unified inbox/compose) → `_shared`

**The feature has zero education hardcoding — it's a generic unified inbox.** Pure promote, no rename.

**Move:** `git mv src/industries/education-consultancy/features/email/ src/industries/_shared/features/email/`
Folder contents that move: `components/{compose-email-dialog,email-thread-card,from-account-picker,inbox-connector,tiptap-editor}.tsx`, `hooks/{use-connected-inboxes,use-email-threads}.ts`, `lib/{gmail-client,gmail-parser}.ts`, `meta.ts`.

**Update these consumer import paths** (`education-consultancy/features/email` → `_shared/features/email`):
- `src/app/api/internal/email/poll/lib.ts:6,7`
- `src/app/(main)/api/v1/email/inboxes/callback/route.ts:8`
- `src/app/(main)/api/v1/email/send/route.ts:20`
- `src/app/(main)/(dashboard)/settings/page.tsx:16`
- `src/components/dashboard/lead/lead-tabs.tsx:19`
- `src/components/dashboard/lead/activities/activities-panel.tsx:20,21` + the two dynamic imports at `:27,:36`

**Meta:** in `_shared/features/email/meta.ts`, set `industries: [INDUSTRIES.EDUCATION_CONSULTANCY, INDUSTRIES.TRAVEL_AGENCY]`.

**Manifests:**
- Education `manifest.ts`: update the `emailMeta` import path to `../_shared/features/email/meta`. Keep it in `features[]`.
- Travel `manifest.ts`: import `emailMeta` from `../_shared/features/email/meta`, push `{ meta: emailMeta }` onto `features[]`. **No sidebar entry needed** (education's email has no standalone sidebar item either — it surfaces in Settings▸Inbox connector and on lead detail Activities/lead-tabs). The Settings `InboxConnector` is gated by `getFeatureAccess(..., FEATURES.EMAIL)` at `settings/page.tsx:124` — that will now pass for travel automatically.

**Verify:** education email (settings inbox connector, lead-detail Activities email thread, compose) unchanged; travel tenant now shows the inbox connector in Settings and email composer on lead detail. Gmail OAuth callback URL unchanged.

---

## Workstream 3 — Check-in (walk-in capture) → `_shared` + light rename

**Concept:** walk-in trip inquiries at a travel office. No dedicated table — check-ins are stored as `[CHECK-IN]`-prefixed rows in `lead_notes` (fully generic). The 4 API routes import only from `_loader`/`_registry`, **not** the feature folder, so they don't need import-path edits — only the gate opens up once travel registers the feature.

**Move:** `git mv src/industries/education-consultancy/features/check-in/ src/industries/_shared/features/check-in/`
Contents: `ui.tsx`, `detail-ui.tsx`, `meta.ts`.

**Update consumer import paths:**
- `src/app/(main)/(dashboard)/check-in/page.tsx:4` (`CheckInPage` from `.../ui`)
- `src/app/(main)/(dashboard)/check-in/[id]/page.tsx:8` (`CheckInDetailPage` from `.../detail-ui`)

**Meta:** `industries: [EDUCATION_CONSULTANCY, TRAVEL_AGENCY]`.

**Manifests:**
- Education: update `checkInMeta` import path; keep sidebar item.
- Travel: import `checkInMeta` from `_shared`, push `{ meta: checkInMeta }`, add sidebar item:
  `{ featureId: FEATURES.CHECK_IN, href: "/check-in", label: "Check-In", icon: "UserCheck" }` (icon already registered).

**Rename education-coupling in `_shared/features/check-in/ui.tsx` (make it industry-aware, don't hardcode travel either):**
The component should read `industryId` (it's available via props/context — check how `ui.tsx` currently gets industry; if it doesn't, thread it from the page shell which has `tenantData.tenant.industry_id`). Then:
- **Counselor label** (`:596` "Assign Counselor", `:599` "Select counselor (optional)") → industry-aware: **education keeps the literal "Counselor"** (no change), **travel shows "Team member"**. One-liner: `industryId === "travel_agency" ? "Team member" : "Counselor"`. *(Future: this label should be driven by the account's configured positions, not industry — out of scope for the pitch, note as a follow-up.)*
- **Tag picker** (`:614`, `:873` hardcoded `["student","parent"]`) and **default tag** (`:171` `useState("student")`): make the tag set industry-aware. Education keeps `["student","parent"]` (default "student"). Travel → `["walk-in","repeat-client"]` (default "walk-in"), or simply **hide the tag picker for non-education** if a clean travel tag set isn't worth it for the pitch. Pick one and state it in handoff. **Education's tag set/default MUST remain exactly `["student","parent"]` / "student".**

**Verify:** education check-in unchanged (tags student/parent, "Counselor" or your neutral label — confirm with Sadin if changing the visible education label is acceptable; if unsure, keep education's label literally "Counselor" via the industry-aware branch and only change travel/neutral). Travel `/check-in` renders, can register a walk-in lead, logs a `[CHECK-IN]` note.

> Confirmed by Sadin: **education sees "Counselor" exactly as today; travel sees "Team member"** via `industryId === "travel_agency" ? "Team member" : "Counselor"`. This guarantees no education visual change. (Longer term the label should come from the account's positions config, not the industry — follow-up, not this PR.)

---

## Workstream 4 — Lead Lists (lifecycle buckets) for travel

**Important split — promote only the GENERIC lifecycle mechanism, NOT the study-abroad fields.**
The lead-lists feature bundles (a) a generic single-membership lifecycle-list mechanism (table, `list_id`, nav group, Settings manager, qualify-to-list, intake assignment) and (b) education-specific structured fields (Destinations/Field of study/Degree level from `taxonomies.ts`). **Travel gets (a) only. Leave (b) gated to education.**

### 4.1 Promote the feature meta to `_shared`
- `git mv src/industries/education-consultancy/features/lead-lists/ src/industries/_shared/features/lead-lists/` (moves `meta.ts` + `taxonomies.ts`).
- `taxonomies.ts` stays study-abroad content but now lives in `_shared`; it is rendered **only** for education (the UI gates below keep it that way). Update the 4 taxonomy consumers' import paths (`education-consultancy/features/lead-lists/taxonomies` → `_shared/features/lead-lists/taxonomies`):
  - `src/components/dashboard/add-lead-sheet.tsx:41`
  - `src/components/dashboard/leads/qualify-row-button.tsx:28`
  - `src/components/dashboard/lead/key-info-section.tsx:14`
  - `src/components/dashboard/lead/lead-detail-v2.tsx:34`
- `meta.ts`: `industries: [EDUCATION_CONSULTANCY, TRAVEL_AGENCY]`.
- Manifests: education updates the `leadListsMeta` import path (keep in `features[]`); travel imports `leadListsMeta` from `_shared` and pushes `{ meta: leadListsMeta }`.

### 4.2 Relax the generic-mechanism gates to feature-access (these currently block travel)
Replace the `isEducation` **string** gate with a feature-access check **only** for the generic lifecycle mechanism. Use `getFeatureAccess(industry_id, FEATURES.LEAD_LISTS)` (which is now true for both edu + travel):
- `src/app/(main)/(dashboard)/layout.tsx:40-41` — change `const hasLeadLists = isEducation && getFeatureAccess(...)` → `const hasLeadLists = getFeatureAccess(tenantData.tenant.industry_id, FEATURES.LEAD_LISTS)`. (Drop the `isEducation &&` prefix. `isEducation` may still be used elsewhere in the file — only change the lead-lists line.)
- `src/app/(main)/(dashboard)/leads/page.tsx:35` — same: the lead-lists loading guard switches from `isEducation && getFeatureAccess(...)` to just `getFeatureAccess(...)`.
- `src/app/(main)/api/v1/leads/route.ts:454` — the intake-list assignment (`!body.list_id && industry === "education_consultancy"` → assign to the tenant's `is_intake` list). Change to fire when the tenant **has** lead-lists (look up the tenant's intake list; if one exists, assign new leads to it) rather than gating on the education string. Keep the existing behavior for education identical.
- The Settings▸Lead Lists manager (`settings/page.tsx:114`) is already gated by `getFeatureAccess(..., FEATURES.LEAD_LISTS)` — it will light up for travel automatically. Verify it does.

**DO NOT touch** the education-only structured-field gates (these keep study-abroad fields out of travel — leave as `=== "education_consultancy"`):
- `add-lead-sheet.tsx:300,312,313,314,903,929,936` (Destinations/field_of_study/degree_level inputs)
- `key-info-section.tsx:165,220`, `lead-detail-v2.tsx:676` (study-abroad display)
- The Qualify dialog's study-abroad fields in `qualify-row-button.tsx` — the **qualify-to-list action** (PATCH `list_id`) is generic and should work for travel, but any **study-abroad form fields** inside the qualify dialog must stay education-gated. Review `qualify-row-button.tsx` carefully: keep the list-move generic, keep the taxonomy inputs education-only.

### 4.3 Seed travel lists + backfill (migration `062` — data only, additive)
Create `supabase/migrations/062_travel_lead_lists.sql` mirroring `059`'s seed/backfill shape but for `travel_agency`. **Do NOT apply it — Opus applies.** Header comment: `-- DO NOT APPLY manually — Opus applies after branch review.`

Seed 4 system lists for **all** `travel_agency` tenants (auto-covers Arya without hardcoding its UUID), `ON CONFLICT (tenant_id, slug) DO NOTHING`, `is_system=true`, `access='{"mode":"all"}'::jsonb`:

| name | slug | sort_order | is_intake | is_archive |
|---|---|---|---|---|
| Inquiries | inquiries | 1 | true | false |
| Qualified | qualified | 2 | false | false |
| Active Clients | active-clients | 3 | false | false |
| Archived | archived | 4 | false | true |

(Names are admin-renameable in Settings later — these are defaults. "Active Clients" avoids confusion with the pipeline "Booked" stage.)

Backfill: set `list_id` to the `inquiries` (intake) list for all travel leads where `list_id IS NULL` and `deleted_at IS NULL`, joined on `tenant_id`, gated `t.industry_id='travel_agency'`. (All 11 Arya leads → Inquiries. Staff/Sadin can qualify some live during the demo.)

### 4.4 Onboard script (future travel tenants)
`scripts/onboard-tenant.ts:259` — extend the `if (industry.id === "education_consultancy")` lead-lists seeding so `travel_agency` tenants get the travel list set above. Cleanest: a small per-industry default-lists map (`education_consultancy` → existing 4; `travel_agency` → the 4 above), seed whichever matches. Don't change education's rows.

---

## Migration summary
- **`062_travel_lead_lists.sql`** — data-only (INSERT 4 lists per travel tenant + UPDATE backfill 11 Arya leads to intake). Additive, idempotent. **Opus applies after review.**
- No other migrations. (Email/check-in/dashboard are code-only.)

---

## Final verification checklist (run before handoff; report actual numbers)

**Gates:**
- [ ] `npm run build` clean.
- [ ] `npx eslint --max-warnings 50` — report the *real* warning count.
- [ ] `grep -rn 'education-consultancy/features/\(email\|check-in\|lead-lists\)' src/` returns **zero** stragglers after the moves.

**Education (Admizz) — MUST be unchanged** (manual, as an education tenant):
- [ ] Email: Settings inbox connector + lead-detail Activities email compose work.
- [ ] Check-in: tags still `student/parent` (default student); label as before (or confirmed-OK neutral label).
- [ ] Lead Lists: "All Leads" + nested lists nav, Settings manager, Qualify flow with study-abroad fields all unchanged.
- [ ] Leads/Add-Lead: Destinations/Field of study/Degree level still present.

**Travel (Arya) — new behavior** (manual, as travel tenant — `travel@zunkireelabs.com`):
- [ ] `/dashboard`: clean industry-neutral StatsCards (Total + stage-based, no "ENROLLED"/grad-cap), "Leads by Team Member" chart.
- [ ] Email: inbox connector in Settings, compose on lead detail.
- [ ] `/check-in`: sidebar item present, page renders, can register a walk-in lead (logs `[CHECK-IN]` note), label = "Agent"/neutral.
- [ ] Lead Lists: "All Leads" + nested travel lists (Inquiries/Qualified/Active Clients/Archived) in nav, Settings manager works, **no** study-abroad fields anywhere, new leads land in Inquiries. *(This last item needs migration 062 applied — coordinate with Opus; you can verify nav/settings render even before seed, lists will just be empty.)*

**Hand back to Opus. Do not merge or apply 062.**

---

## Resolved decisions
- Workstream 3 label: **education keeps "Counselor"; travel shows "Team member"** (confirmed by Sadin). Future follow-up: make this label account-configurable via positions, not industry-hardcoded.
