# Travel Agency Industry — Sonnet Build Brief

**Author:** Opus (planning brain). **Executor:** Sonnet, separate session, OWN branch.
**Date:** 2026-06-10. **Context:** 4-hour clock — there's a live pitch to a travel-agency / tour-operator / DMC prospect.
**Reference:** CRM-expert analysis of LeadSquared Travel CRM + 2026 travel-CRM landscape. The differentiator is that the "deal" is a structured **trip**, and the **itinerary/quote** is a first-class artifact.

---

## ⛔ HARD GUARDRAILS — read first

1. **Work on your OWN branch.** First action: `git checkout stage && git pull && git checkout -b feature/travel-agency-industry`. The working dir is Sadin's LIVE local dev tree — **commit frequently** so nothing is lost on a branch switch.
2. **Commit Phase A as a working checkpoint BEFORE starting Phase B.** Phase A must be demo-safe on its own.
3. **DO NOT apply the migration to Supabase.** Write the `.sql` file only. Opus reviews + applies it (dev+prod share ONE DB — gated operation).
4. **DO NOT create/seed the demo tenant, leads, or pipeline.** Opus owns all DB/data setup.
5. **DO NOT merge to stage. STOP at review.** Opus re-runs gates and merges.
6. **Gates before every checkpoint commit:** `npm run build` clean **AND** `npx eslint --max-warnings 50 .` → 0 errors.
7. **Gate every new UI** with `industryId === "travel_agency"`. Do not change universal behavior for other industries. Sidebar icons are **string names**, not component imports.
8. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` (the repo commit-msg hook rewrites the co-author line — expected).

---

## PHASE A — Trip-native baseline (MUST SHIP, demo-safe checkpoint)

Goal: a tenant in the `travel_agency` industry whose leads, pipeline, and labels feel purpose-built for travel — **zero DB-schema changes** (trip fields live in `leads.custom_fields` JSONB).

### A1. Register the industry

- **`src/industries/_registry.ts`** — add `TRAVEL_AGENCY: "travel_agency"` to `INDUSTRIES` (after `GENERAL`). Update the `IndustryId` union type. Add new feature IDs to `FEATURES`: `TRIP_INQUIRY: "trip-inquiry"`, `ITINERARY: "itinerary"`.
- **`src/industries/travel-agency/manifest.ts`** — create. Shape mirrors `src/industries/it-agency/manifest.ts`. `id: INDUSTRIES.TRAVEL_AGENCY`. For Phase A, `features: []` is acceptable if no top-level page yet; add the itinerary sidebar item in Phase B. `ai`: optional — copy a minimal `ai/agent.ts` stub from it-agency or omit.
- **`src/industries/_loader.ts`** — import the new manifest and register it in the `MANIFESTS` map (same place it-agency/education are registered).
- **`supabase/migrations/043_travel_agency_industry.sql`** — create (DO NOT APPLY). Pattern (VARCHAR FK to `industries` seed table, additive, `ON CONFLICT DO NOTHING`):
  ```sql
  INSERT INTO industries (id, name, description, entity_type_label, entity_type_singular, icon, default_pipeline_stages)
  VALUES (
    'travel_agency',
    'Travel Agency',
    'Travel agencies, tour operators, and destination management companies',
    'Destinations', 'Destination', 'Plane',
    '[
      {"name":"New Inquiry","slug":"new-inquiry","position":0,"color":"#3b82f6","is_default":true,"is_terminal":false},
      {"name":"Qualifying","slug":"qualifying","position":1,"color":"#06b6d4","is_default":false,"is_terminal":false},
      {"name":"Itinerary Sent","slug":"itinerary-sent","position":2,"color":"#a855f7","is_default":false,"is_terminal":false},
      {"name":"Revising","slug":"revising","position":3,"color":"#f97316","is_default":false,"is_terminal":false},
      {"name":"Booked","slug":"booked","position":4,"color":"#22c55e","is_default":false,"is_terminal":true},
      {"name":"Lost","slug":"lost","position":5,"color":"#ef4444","is_default":false,"is_terminal":true}
    ]'::jsonb
  ) ON CONFLICT (id) DO NOTHING;
  ```
- **`src/components/dashboard/shell.tsx`** — add `Plane` (and `MapPin` if used) to the lucide imports and the `INDUSTRY_ICONS` map.
- **`src/components/dashboard/settings/industry-info-card.tsx`** — add a color badge mapping for `travel_agency` (e.g. sky/cyan) in `industryColors`, and an icon entry in the local `industryIcons` map.

### A2. Trip-type dropdown enum

- **`src/industries/travel-agency/leads/trip-types.ts`** — mirror `it-agency/leads/prospect-industries.ts` exactly (array of `{value,label}` + `TRIP_TYPE_VALUES` + `tripTypeLabel()`). Values:
  `honeymoon`, `family`, `adventure`, `group_tour`, `corporate`, `pilgrimage`, `leisure`, `business`, `cruise`, `mice`.

### A3. Trip Inquiry panel on lead detail

- **`src/components/dashboard/lead/key-info-section.tsx`** — add an `industryId === "travel_agency"` branch (mirror the existing `education_consultancy` branch) rendering an editable **Trip Inquiry** card. All fields persist into `leads.custom_fields` via the existing lead-update path (the same mechanism other custom fields already use — DO NOT add a migration or new columns). Fields:
  | Field | `custom_fields` key | Input |
  |---|---|---|
  | Destination | `trip_destination` | text (e.g. "Bali, Indonesia") |
  | Departure city | `trip_departure_city` | text |
  | Travel start | `trip_start_date` | date |
  | Travel end | `trip_end_date` | date (show computed nights) |
  | Adults | `trip_pax_adults` | number |
  | Children | `trip_pax_children` | number |
  | Infants | `trip_pax_infants` | number |
  | Budget | `trip_budget_amount` | number, prefixed with currency (see A4) |
  | Trip type | `trip_type` | select from `trip-types.ts` |
  | Date flexibility | `trip_flexibility` | select: `exact` / `flexible` |
- Keep it read-friendly when empty (placeholders, not errors). Reuse the existing edit/save pattern in this component — don't invent a new save flow.

### A4. Currency helper (NPR default, configurable later)

- **`src/lib/travel/currency.ts`** (new) — `formatMoney(amount: number, currency = "NPR")` returning e.g. `Rs. 120,000`. Back it with a small `CURRENCIES` map (`NPR → "Rs."`, `USD → "$"`, `INR → "₹"`, `EUR → "€"`) so multi-currency is a one-line add later. Default everywhere to `NPR`. **No hardcoded "Rs." string literals** outside this map.

### A5. Leads table column (optional, only if cheap)

- If the leads column registry (`src/components/dashboard/leads/columns-registry.tsx`) makes it trivial, add a `travel_agency`-grouped optional column for **Destination** and **Trip Type** (`defaultVisible: false`). Skip if it adds risk — Phase A must stay safe.

**✅ Phase A acceptance:** as a `travel_agency` tenant — Trip Inquiry panel renders + saves on a lead; trip-type dropdown works; currency shows `Rs.`; settings shows "Travel Agency". As a non-travel tenant — nothing changes. Build + lint clean. **COMMIT THIS CHECKPOINT.**

---

## PHASE B — Itinerary / Quote builder (the centerpiece; build after A is committed)

Goal: from a lead, build a day-by-day itinerary with line-item pricing → a clean, **printable** branded proposal. **Persist in `leads.custom_fields.itinerary` (JSON) — no new table, no new migration.** Reuse the existing lead-update (PATCH custom_fields) path — do NOT add a new API route unless genuinely unavoidable (and if so, `scopedClient(auth)` + industry gate).

### B1. Data shape (`custom_fields.itinerary`)
```ts
{
  title: string,           // default: `${destination} — ${nights}N trip`
  currency: string,        // default "NPR"
  days: { id, title, description }[],
  lineItems: { id, category, label, qty, unitPrice }[],  // category: hotel|flight|transfer|activity|meal|other
  notes: string,           // terms / inclusions-exclusions
  updatedAt: string
}
```

### B2. Builder UI — `src/industries/travel-agency/features/itinerary/`
- Launch from the lead detail (a **"Build Itinerary"** button/tab on or beside the Trip Inquiry panel). A full sidebar "Itineraries" list page is **optional polish — skip if short on time.**
- Header auto-filled from the trip fields (destination, dates, pax), editable title.
- **Days:** add / remove / reorder (you may reuse `@dnd-kit` already in the project, or simple up/down buttons — reorder is optional, add/remove is required).
- **Line items table:** category select, label, qty, unit price → row total + grand total via `formatMoney`.
- **Notes/terms** textarea.
- Save → PATCH lead `custom_fields.itinerary`. Autosave-on-blur or an explicit Save button — explicit Save is fine and lower-risk.
- `meta.ts` for the feature + register in the travel-agency manifest (+ sidebar item if you add the list page).

### B3. Proposal view (print-optimized)
- A clean read-only render: branded header (tenant name/logo), trip summary, day-by-day, price summary table, grand total, notes. A **"Print / Save as PDF"** button calling `window.print()` with print CSS is sufficient — **do NOT build PDF generation or public share links** (scope creep for today).

**✅ Phase B acceptance:** create an itinerary on a lead, add days + priced line items, total computes in `Rs.`, save persists across reload, proposal view prints cleanly. Industry-gated (non-travel tenants never see it). Build + lint clean. **COMMIT. STOP. Hand to Opus for review.**

---

## OUT OF SCOPE TODAY (name in pitch, don't build)
Supplier/vendor booking, live availability/GDS, payments/deposits/installments, multi-currency switching UI, WhatsApp integration, AI lead scoring, public shareable proposal links, PDF generation service.

## What Opus owns (do not touch)
- Applying migration 043 to Supabase.
- Creating the demo tenant (prospect's real company) + assigning `industry_id = travel_agency`.
- Creating the tenant's pipeline from the travel stages + seeding realistic sample travel leads (with populated trip fields).
- Re-running gates, reviewing the diff, merging to stage, deploy.

---

## ADDENDUM (2026-06-10) — Package-of-interest on leads

**Continue on the SAME branch `feature/travel-agency-industry`.** Same guardrails as above (commit frequently, gates before commit, gate UI to `industryId === "travel_agency"`, DO NOT touch DB/seed — Opus already back-filled `entity_id` on Arya's leads, DO NOT merge, stop at review).

**Goal:** surface the existing `lead.entity_id` link so an agent can set/see which **Package** a lead is interested in, and so it shows on the leads table. The catalog (`tenant_entities`, labelled "Packages") and the 8 package rows already exist; Opus has back-filled `entity_id` on the seeded leads. This is purely UI + one API line — **no DB migration, no new table.**

Concept: **Destination** = the per-lead free-text field (already in the Trip Inquiry panel). **Package** = the sellable catalog product the lead maps to (`entity_id`). They are different — keep both.

### Tasks

1. **API — add `entity_id` to the PATCH whitelist.** In `src/app/(main)/api/v1/leads/[id]/route.ts`, the allowed-fields array (the one already containing `custom_fields`, `status`, `stage_id`, `assigned_to`, `lead_type`, `tags`) is **missing `entity_id`**. Add it; validate as a non-empty string OR `null` (null = clear the package). The POST/create route already accepts `entity_id`, so the validation shape is established there.

2. **Trip Inquiry panel — Package selector.** In `src/components/dashboard/lead/key-info-section.tsx`, inside the existing `industryId === "travel_agency"` branch, add a **"Package"** selector at the top of the Trip Inquiry card:
   - Options = the tenant's active packages from **`GET /api/v1/entities`** (fetch client-side, like other inline editors fetch their options). Include a **"— Custom trip (no package) —"** option that sets `entity_id` to `null`.
   - Current value = `lead.entity_id`. On change, PATCH `/api/v1/leads/{id}` with `{ entity_id }` (mirror the existing inline-save pattern, e.g. `onLeadTypeChange` in `lead-detail-v2.tsx` — add a parallel `onPackageChange` callback, or do the fetch inline in the panel; either is fine).
   - Read mode: show the selected package name (or "Custom trip" when null).
   - Reuse `src/components/form/entity-select-field.tsx` if it fits cleanly; otherwise a plain shadcn `Select` is fine.

3. **Leads table — "Package" column.** Add a Package column to the leads table via the column registry (`src/components/dashboard/leads/columns-registry.tsx`) as an **industry column for `travel_agency`** (group it with other industry columns; `defaultVisible: true` for travel). It shows the lead's package name.
   - **First check the data path:** does the leads-list query (`queries.ts` `getLeads` / whatever feeds `leads-table.tsx`) already carry the entity/package name? If not, join `tenant_entities` (lead `entity_id` → name) into that query — minimal, tenant-scoped. Don't N+1 per row.

4. **Verify + gates.** As a travel tenant: Package selector sets/clears and persists; leads table shows the Package column with the back-filled values; non-travel tenants unaffected (no Package selector, no column). `npm run build` clean + `npx eslint --max-warnings 50 .` 0 errors. Commit. **Stop at review.**

### Out of scope (roadmap — see FEATURE-ROADMAP.md `travel_agency`)
Package **templates** that auto-fill the itinerary, margin (cost vs sell), booking/payments back office, post-trip automation. Do NOT build these now.

### Opus owns
`entity_id` back-fill on Arya's seeded leads (DONE), review, gates, merge, deploy.

---

## ADDENDUM 2 (2026-06-10) — Form Builder for travel_agency

**Continue on the SAME branch `feature/travel-agency-industry`.** Same guardrails (commit; gates before commit; don't touch DB/seed — Opus seeds a sample form; don't merge; stop at review).

**Goal:** opt `travel_agency` into the **existing `_shared` form-builder** (education + construction already use it) so Arya Travels can build public lead-capture forms — and add a **Trip Enquiry** template so web submissions land as rich travel leads (trip fields populate the Trip Inquiry panel; Package sets `entity_id`). **This is "promote, don't copy" — do NOT duplicate the form-builder folder.** No DB migration (`form_configs` already exists). The page routes (`/forms`, `/forms/new`, `/forms/[id]`) and API routes are shared and already gate on `FEATURES.FORM_BUILDER` via `getFeatureAccess`; opting travel into the feature meta opens all of them automatically.

**Precedent to mirror: `src/industries/construction/manifest.ts`** (it registered form-builder with one feature entry + one sidebar item).

### Tasks

1. **Open the gate.** `src/industries/_shared/features/form-builder/meta.ts` — add `INDUSTRIES.TRAVEL_AGENCY` to `formBuilderMeta.industries`.

2. **Manifest + sidebar.** `src/industries/travel-agency/manifest.ts` — import `formBuilderMeta` from `../_shared/features/form-builder/meta`; add `{ meta: formBuilderMeta }` to `features`; add a sidebar item `{ featureId: FEATURES.FORM_BUILDER, href: "/forms", label: "Forms", icon: "FileText" }` (FileText is already in `INDUSTRY_ICONS`). Place it after the Itineraries item.

3. **Trip Enquiry template.** New file `src/industries/_shared/features/form-builder/templates/trip-enquiry.ts` exporting `tripEnquiryTemplate: TemplateDefinition`. **Mirror the shape of `admission-inquiry.ts`.** First check the `FieldType` union in `../types.ts` and only use **supported** field types (admission uses `text`/`email`/`tel`/`select`/`entity_select`; if `date`/`number`/`textarea` are NOT in the union, fall back to `text` for dates/pax/budget and `text` for message). Fields:
   - **Step "Contact":** `first_name`, `last_name`, `email`, `phone` (standard keys → lead columns).
   - **Step "Your Trip":**
     - `{ name: "package", label: "Package of Interest", type: "entity_select", required: false }` — `entity_select` binds to `lead.entity_id` (the Package), regardless of the field `name`.
     - **These field `name`s MUST be exactly the trip_* keys** so submissions flow into `leads.custom_fields` and render in the Trip Inquiry panel: `trip_destination`, `trip_departure_city`, `trip_start_date`, `trip_end_date`, `trip_pax_adults`, `trip_pax_children`, `trip_type` (a `select` whose options are the values from `src/industries/travel-agency/leads/trip-types.ts`), `trip_budget_amount`. Add an optional `message` field last.
   - Branding: title "Plan Your Trip", a friendly subtitle, button "Get My Quote", thank-you "We'll send your custom quote shortly."

4. **Register the template.** `src/industries/_shared/features/form-builder/templates/index.ts` — import `tripEnquiryTemplate`; add a `case "travel_agency": return [tripEnquiryTemplate, generalContactTemplate, BLANK_TEMPLATE];` to `getTemplatesForIndustry`; and make `getTemplateById` resolve `trip-enquiry` (it currently only searches the education array + blank — add trip-enquiry to its lookup so `/forms/new?template=trip-enquiry` works).

5. **Verify + gates.** As Arya (travel): `/forms` is in the sidebar and loads; `/forms/new` shows **Trip Enquiry + General Contact + Blank**; building from Trip Enquiry renders all fields incl. the Package (entity_select) dropdown of real packages; the live preview works. **Education + construction template sets are UNCHANGED.** Non-form industries (it_agency) still have no Forms item / 404. `npm run build` clean + `npx eslint --max-warnings 50 .` 0 errors. Commit. **Stop at review.**

### Out of scope
No changes to the form renderer, public submit API, or API-key flows (all shared + already work). No DB migration.

### Opus owns
Reviewing + gates + merge; seeding one **published sample "Trip Enquiry" form** (+ form API key) for Arya so `/forms` isn't empty in the pitch.
