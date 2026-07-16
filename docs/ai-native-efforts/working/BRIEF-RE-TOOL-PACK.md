# Executor Brief — real_estate AI Tool Pack v1 (first industry pack)

**For:** Sonnet executor session · **From:** Opus planner · **Date:** 2026-07-16
**Context:** Phase 1 (1A–1C) all Opus-verified; the assistant answers lead questions but is blind to `offerings`/`investor_commitments` (Sadin hit this live). This slice = the FIRST industry tool pack — it also sets the pattern every future industry pack (education, it_agency, …) copies, so the *location and wiring conventions below matter more than usual*. Read `docs/REAL-ESTATE-AI-TOUCHPOINTS.md` §catalog for the domain framing.

**Prereq (Step 0):** commit the verified 1C work first:
`feat(ai): Phase 1C — assistant surfaces, conversations API, Langfuse seam` (everything currently uncommitted, including FEATURE-CATALOG + the 1C brief doc; `.env.local` stays out).

---

## What this is (and is NOT)

**Is:** 4 read-only real_estate tools + per-industry prompt context + the industry-pack wiring conventions (folder, registration aggregator, ESLint guard extension).
**Is NOT:** write tools, RAG, other industries' packs, manifest `AiConfig.toolIds` mechanics (Phase 3 formalizes that — leave a TODO), UI changes, migrations, new deps.

## Where industry-pack code lives (the pattern-setter)

```
src/industries/real-estate/ai/
  tools/
    index.ts                 # registers the pack (import side-effect), exports tools
    search-offerings.ts
    get-offering.ts
    capital-raise-summary.ts
    get-investor-commitments.ts
```

Per the two-homes rule, industry AI tools live in the INDUSTRY folder (parallel-work isolation), not under `src/lib/ai/`. Two pieces of shared wiring:

1. **Aggregator:** new `src/lib/ai/tools/packs.ts` — imports `"./universal"` plus each industry pack (`"@/industries/real-estate/ai/tools"`). The chat route swaps its `import "@/lib/ai/tools/universal"` for `import "@/lib/ai/tools/packs"`. Future packs = one line here, no route edit. (Cross-boundary import direction matches how `_loader.ts` imports manifests.)
2. **ESLint guard extension:** in `eslint.config.mjs`, extend the existing no-restricted-imports block's `files` glob to also cover `src/industries/*/ai/**/*.{ts,tsx}` — industry AI code gets the same `createServiceClient` ban as `src/lib/ai/`.

Every tool: `industries: ["real_estate"]` (registry auto-gates), `scope: "read"`, all queries via `ctx.db`, plus a `getFeatureAccess(ctx.auth.industryId, FEATURES.OFFERINGS)` check inside `execute` returning `{ error: "..." }` if false — defense-in-depth mirroring the offerings REST routes. **Mirror the REST offerings routes' access rules** (`GET /api/v1/offerings` etc.) — same visibility, no more, no less. Reuse the existing domain lib (`src/industries/real-estate/lib/commitments.ts` — `equityRaised`, `FUNNEL_COLUMNS`, `formatCurrency`) and the aggregation shape of `/api/v1/insights/real-estate/summary`; do NOT reimplement the math.

## The 4 tools

| id | Returns | Notes |
|---|---|---|
| `search_offerings` | offerings list (≤20): name, status, type/structure, target, raised-to-date, investor count, funded count, pref rate, `href: "/offerings/<id>"` | optional filters: status, free-text name; raised = `equityRaised` semantics (same number the dashboard shows) |
| `get_offering` | one offering: terms + funnel breakdown per `FUNNEL_COLUMNS` (count + amount per commitment status) + commitments list (≤25: investor name, amount, status, `href` to the lead) | input `offeringId` uuid (sanitized via the existing `optionalUuid`/NIL guards where optional) |
| `capital_raise_summary` | cross-offering aggregate: per offering {name, target, raised, committed-not-yet-funded, investor count} RANKED by raised+committed, plus tenant totals | this answers "which offering are investors most interested in" — description must say so explicitly |
| `get_investor_commitments` | one investor (lead): their commitments across offerings (offering name, amount, status, dates) + lifecycle-derived stage | input `leadId`; MUST apply the same lead-visibility check as `get_lead` (`canViewLead`) before returning anything |

Tool descriptions written for the model: concrete when-to-use, e.g. `capital_raise_summary`: "Use for questions about which offerings investors prefer, total capital raised, or raise progress across vehicles."

## Prompt context per industry

In `prompts/assistant.ts`: add an `INDUSTRY_CONTEXT: Record<string, string>` map appended to the system prompt when the industry matches. Only `real_estate` for now: 2–3 sentences — investors live on the leads spine ("leads" = investors/LPs), offerings are capital-raise vehicles, commitments move prospect → soft_commit → subscribed → funded, prefer the offering tools for raise/offering/commitment questions. `TODO(Phase 3): move into each industry manifest's AiConfig`. Education/it_agency get nothing yet (universal behavior unchanged).

## Tests

- Registry gating with the REAL pack: all 4 present for a real_estate auth, absent for education/it_agency/null (extend `index.test.ts` pattern).
- Aggregation math: unit-test `capital_raise_summary`'s aggregation against fixture commitment rows (mirror the known seed shape: 2 offerings, 7 investors, $850k + $1.2M funded) — mock `ctx.db`.
- `get_investor_commitments` refuses a lead the auth can't view (mock `canViewLead` false path).
- Prompt: real_estate auth → context line present; education → absent.
- All existing 80 stay green.

## Verification (report with evidence)

1. Build + lint + vitest green (heap flag). Lint proves the extended ESLint glob fires (scratch-import `createServiceClient` under `src/industries/real-estate/ai/`, show the error, delete).
2. Diff scope: `src/industries/real-estate/ai/**` (new), `src/lib/ai/tools/packs.ts` (new), chat route import swap (1 line), `prompts/assistant.ts` (+map), `eslint.config.mjs` (glob extension), tests, FEATURE-CATALOG note on the ai-assistant row. Nothing else — no migrations, no package.json, no UI.
3. LIVE (flag true, cookie recipe as before), `owner@cre-capital.local`:
   - "what offering are investors most interested in?" → calls `capital_raise_summary`, answer names the actual offerings with real numbers (Industrial Value-Add Fund II $1.2M/$25M vs Southeast Flex Portfolio I $850k/$10M — cross-check against the Offerings page/seed).
   - "show me Industrial Value-Add Fund II" → `get_offering` with funnel breakdown.
   - "what has Sarah Chen committed?" → `get_investor_commitments`.
4. LIVE cross-industry: `admin@edgex.local` (it_agency) asks the same offering question → toolset lacks the pack (model says it can't / falls back gracefully); `counselor@admizz.local` unchanged (1 lead only).
5. Paste tool inputs+outputs from the streams, as before.

## Report format
Same as prior slices. No merge, no PR, no stage/prod DB. Opus reviews; loose ends (Langfuse keys) and Phase 2 planning continue in parallel.

## Tenant-isolation reminders
- Everything through `ctx.db`; the ESLint ban now covers industry AI folders too.
- `get_investor_commitments` inherits lead visibility (`canViewLead`) — an own-scope user must not see another counselor's investor via the commitments side-door.
- Offering ids from the model are untrusted: existence-check within the tenant (scoped select), same pattern as `pipeline_summary`'s fix.
