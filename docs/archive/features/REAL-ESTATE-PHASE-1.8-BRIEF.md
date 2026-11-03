# BRIEF: `real_estate` Phase 1.8 — "Draft with AI" investor comms (MOCK)

**For:** Sonnet executor · **From:** Opus (planner) + `/coo-real-estate`
**Branch:** `feature/real-estate-vertical` (continue; HEAD `2a90b3e`)
**Date:** 2026-07-15 · **Scope:** A MOCK AI touchpoint for the demo. **No LLM. No AI deps. No API key.
No migration.**

> Context: `docs/REAL-ESTATE-AI-TOUCHPOINTS.md` (the catalog) — this mocks **touchpoint #1**. The REAL
> AI is a separate, production, platform-wide effort (`docs/ai-native-efforts/01-PHASE-1-…`); do NOT
> build any real LLM path here. This is a **deterministic, data-merged draft** on the same UI seam the
> real tool will later feed — a forward-compatible shell, not throwaway.

---

> ## ⛔ GUARDRAILS
> **1. Do not break other tenants.** The one shared-file edit is `lead-detail-v2.tsx`, and only as an
> additive line inside the **existing `isRealEstate` branch** (beside `ConsentCard`). Everything else is
> industry-owned (`src/industries/real-estate/`) or a new gated API route. Confirm it_agency/education
> lead detail unchanged.
> **2. No AI dependency of any kind.** Do NOT `npm i ai`/`@ai-sdk`/`anthropic`/`langfuse`. No
> `ANTHROPIC_API_KEY`. The draft is produced by **string templates + the real seed numbers**. It must be
> clearly labeled an AI-generated draft for review — but there is zero model behind it.
> **3. No DB work.** No migration, no new table. The seam route only READS via `scopedClient`.

---

## 1. What it is

On an **investor** (real_estate lead detail), a **"Draft with AI ✨"** affordance that opens a dialog:
pick a notice type — **Distribution · Capital Call · Quarterly Update** — and it generates a realistic,
**personalized** notice with the investor's *real* commitment numbers merged in, in an **editable**
textarea. The user edits and **Copies** (no real send). Labeled "AI-generated draft · review before
sending" with a **Beta** tag, styled to match the existing `ai-insights-tab.tsx` (`✨` + Beta).

Why this one: highest demo wow, lowest dependency (catalog §1 #1). It shows EdgeX turning owned data into
IR work — the wedge vs SponsorCloud — without standing up real infra.

## 2. Files

**2.1 Seam endpoint (mock generator — the forward-compatible seam)**
`src/app/(main)/api/v1/real-estate/comms/draft/route.ts` — `POST { leadId, type }`.
- Gate exactly like the documents route: `authenticateRequest → (getFeatureAccess(OFFERINGS) && industryId === "real_estate") ? … : apiForbidden → scopedClient(auth)`.
- Read (scoped): the `lead` (investor name/entity from `custom_fields`), its `investor_commitments`
  (+ joined `offerings` for name/pref/terms).
- Produce a **deterministic** draft string from a template per `type`, merging real numbers. Example
  derivations (clearly illustrative, comment them as demo math):
  - Distribution: quarterly pref ≈ `funded_amount × pref_return% ÷ 4` per funded commitment.
  - Capital Call: the investor's soft-commit/subscribed amount not yet funded.
  - Quarterly Update: offering raise progress (raised/target, funnel) + the investor's position.
- Return `apiSuccess({ draft, subject, meta })`. Add a top comment: **"MOCK — deterministic template.
  The real `draft_investor_notice` tool (ADR-001 Phase 1) will replace the body of this handler with an
  AI SDK generateText call; the route contract stays the same."** No `.update()/.delete()`.

**2.2 UI card (industry-owned)**
`src/industries/real-estate/features/investors/components/investor-comms-card.tsx` — a `WidgetCard`-style
card "Investor Comms" with the **Draft with AI ✨** button → a dialog (`@/components/ui/dialog`) with a
type selector (3 options), a **Generate** action calling the seam route, an editable `<textarea>` bound
to the returned draft, a **Copy** button, and the "AI-generated draft · review before sending" + Beta
label. Loading + error states. No send.

**2.3 Mount (additive, shared file)**
`src/components/dashboard/lead/lead-detail-v2.tsx` — inside the **existing `isRealEstate` branch**, add
`<InvestorCommsCard leadId={currentLead.id} canManage={isAdmin} />` beside `ConsentCard`. One additive
block; touch nothing else.

## 3. What NOT to do
- No AI/LLM deps, no key, no `src/lib/ai/` changes, no Inngest/Langfuse/pgvector.
- No migration/table. No edits outside `src/industries/real-estate/`, the new route folder, and the one
  additive `lead-detail-v2.tsx` block.
- Do not wire a real "Send" — Copy only (a disabled/"coming soon" Send is fine if labeled).

## 4. Tenant isolation
- Seam route: gated `getFeatureAccess(OFFERINGS) && real_estate` + `scopedClient` → **403** for
  it_agency/education. Read-only.
- UI: additive inside the `isRealEstate` branch only; other industries' lead detail byte-identical.
- `grep -rn "it-agency\|education-consultancy" src/industries/real-estate/` → none.

## 5. Verification (local, `:3001`)
1. `NODE_OPTIONS=--max-old-space-size=5632 npm run build` clean.
2. As `owner@cre-capital.local`: open **Sarah Chen** → **Draft with AI ✨** → **Distribution** → draft
   shows her real numbers (Fund II, funded $250k, 8% pref → ~$5,000 quarterly) in an editable box → edit
   → Copy. Try Capital Call / Quarterly Update. Confirm it reads real commitments (different investors →
   different numbers).
3. Isolation: `admin@edgex.local` + `owner@admizz.local` → lead detail unchanged; `POST /api/v1/real-estate/comms/draft` → **403**.

## 6. Build order
1. Seam route (verify JSON in browser as CRE). 2. `investor-comms-card.tsx`. 3. Additive mount in
`lead-detail-v2.tsx`. 4. Isolation + verification. 5. `docs/FEATURE-CATALOG.md` note (mark **mock**).
6. Build, **push, stop for Opus review. No merge, no PR, no stage/prod DB.**
