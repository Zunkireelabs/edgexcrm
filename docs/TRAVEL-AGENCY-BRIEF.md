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
