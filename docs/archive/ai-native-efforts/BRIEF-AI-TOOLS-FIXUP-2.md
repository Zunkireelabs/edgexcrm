# Executor Brief — AI tools fixup 2 (search_leads junk filters + get_offering aggregates)

**For:** Sonnet executor session · **From:** Opus planner · **Date:** 2026-07-16
**Context:** RE tool pack v1 (471894d) Opus-verified and PASSES overall — this brief closes 4 issues found during the live review. Items 1–2 are functional bugs; 3–4 are consistency improvements. No migrations, no new deps, no UI.

---

## 1. (Universal, BUG) `search_leads` — model fills optional filters with `"all"` sentinels → false "not found"

Reproduced live (owner@cre-capital.local, "What has the investor Sarah Chen committed?"): gpt-4o-mini passed `{query:"Sarah", stage:"all", list:"all", createdAfter:"2020-01-01…", …}`. `list:"all"` short-circuits at the list lookup (`No stage/list named "all"` → total 0 **before the name filter ever runs**), and `stage:"all"` would silently `.eq("status","all")` → 0 rows. The model then told the user the investor doesn't exist. Same placeholder-junk family as the 1B fixup, but with plausible sentinel values `optionalString` (""/NIL-only) can't catch.

**Fix (boundary-level, like the 1B fixup):**
- In `src/lib/ai/tools/universal/lib/sanitize.ts`, add a sentinel-aware preprocess (or extend `optionalString`): treat case-insensitive `"all"`, `"any"`, `"none"`, `"*"` as absent. Apply to `search_leads`' `stage` and `list` (and audit the other universal tools' optional string filters for the same exposure — e.g. `search_offerings.status` is a z.enum so it's already safe).
- Tool description hardening: `stage`/`list` descriptions gain "Omit entirely to include all — never pass \"all\"." `createdAfter`/`createdBefore` descriptions gain "Only use when the user explicitly asks about a time window." (The model also invented a 2023 date range unprompted in one turn — descriptions are the only lever there; don't try to validate dates away.)
- Unit tests: sentinel values sanitize to absent; existing behavior for real slugs unchanged.

## 2. (real_estate pack, BUG) `get_offering` — funnel + raisedToDate computed from the LIMIT-25 rows

`src/industries/real-estate/ai/tools/get-offering.ts` selects commitments with `.limit(25)` and then computes `funnel` and `raisedToDate` (equityRaised) **from those ≤25 rows**. Any offering with >25 commitments under-reports every aggregate. The 25-cap was meant for the commitments *list* only (brief said "commitments list (≤25 …)").

**Fix:** fetch ALL commitment rows for the offering with a slim select (`status, amount`) for the aggregates (no limit — a single offering's commitments are bounded in practice; matches how `/api/v1/insights/real-estate/summary` aggregates), and keep a `.limit(25)` joined query (or slice) for the named commitments list. If the list is truncated, include `commitmentsTruncated: true` (no silent caps).
**Test:** fixture with 30 commitments → funnel counts/amounts cover all 30, list length 25, truncation flag set.

## 3. (Universal, IMPROVEMENT) `search_leads` full-name queries match nothing

`query:"Sarah Chen"` → `first_name.ilike.%Sarah Chen%` etc. — no single column contains the full name, so 0 rows. Line-faithful to REST `GET /api/v1/leads` (same limitation there), but an assistant gets asked by full name constantly.

**Fix in the AI tool only (REST stays untouched — flag divergence in a code comment):** split `query` on whitespace after the existing sanitize; for each token add one `.or(first_name.ilike.%t%,last_name.ilike.%t%,email.ilike.%t%,phone.ilike.%t%)` — chained `.or()` calls AND together in PostgREST, so every token must match somewhere. Single-token behavior is unchanged by construction. Cap at the first 4 tokens.
**Tests:** two-token query builds two or-groups; single-token unchanged.
**Live check:** "What has Sarah Chen committed?" now finds her AND proceeds to `get_investor_commitments` (this was the brief-check that failed).

## 4. (real_estate pack, CONSISTENCY) "raised" means different things in two tools

`search_offerings.raisedToDate` = `equityRaised` (subscribed+funded — the dashboard number). `capital_raise_summary.raised` = funded-only. Same word, different number for the same offering → the model will contradict itself across turns.

**Fix:** in `capital_raise_summary`, rename per-offering fields to `funded` and `committedNotYetFunded`, and add `equityRaised` (= funded + committedNotYetFunded, same as the dashboard); rank by `equityRaised` (identical ordering to today's `_rank`). Totals object gets the same three names. Update the fixture test's expected shape.

---

## Verification (report with evidence)

1. Build + lint + vitest green (heap flag `NODE_OPTIONS=--max-old-space-size=5632`; baseline 93 tests).
2. Diff scope: `src/lib/ai/tools/universal/lib/sanitize.ts`, `search-leads.ts`, `src/industries/real-estate/ai/tools/get-offering.ts`, `capital-raise-summary.ts`, their tests. Nothing else.
3. LIVE (flag true, cookie recipe as before), `owner@cre-capital.local`:
   - "What has Sarah Chen committed?" → finds the lead, calls `get_investor_commitments`, answers with IVAF-II $250k funded + SEFP-I $200k soft_commit, lifecycle Investor.
   - "which offering are investors most interested in?" → still correct, now with `equityRaised` $1.2M vs $850k named per offering.
   - `counselor@admizz.local` "List ALL leads in the system" → still exactly 1 (Aisha Khan).
4. Paste tool inputs+outputs from the streams.

No merge, no PR, no stage/prod. Opus reviews after.
