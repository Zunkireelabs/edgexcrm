# Executor Brief — Phase 3A: Industry AI packs formalized via manifest `AiConfig`

**For:** Sonnet executor session · **From:** Opus planner · **Date:** 2026-07-17

## Context

Phase 1 (assistant) + Phase 2 (knowledge layer) are committed and verified on
`feature/ai-assistant-foundation` (2C = `58f1823`, tree clean). The RE tool pack proved the
per-industry pattern, but two pieces of industry AI expertise still live OUTSIDE the industry
modules, each with a `TODO(Phase 3)` marker:

1. `src/lib/ai/prompts/assistant.ts` — hardcoded `INDUSTRY_CONTEXT` map (real_estate only).
2. `src/lib/ai/tools/packs.ts` — hardcoded pack import list, with no declared link between a
   manifest and the tools its industry registers.

Phase 3A closes both TODOs: the manifest's `AiConfig` becomes the single place an industry
declares its AI expertise (prompt addendum + tool ids), consistent with the two-homes rule from
`docs/reference/01-ARCHITECTURE-INDUSTRY-MODULES.md`. This is a **small, purely structural**
slice: NO new tools, NO behavior change for any tenant, NO migration, NO new deps.

## Non-goals (do NOT do these)

- No education/it_agency tool packs (that's 3B, separate brief).
- No changes to tool registration mechanics (`registry.ts` industry gating already works).
- No dynamic `import()` of packs — Next.js bundling needs static imports; `packs.ts` keeps its
  static import list. The manifest declares *what* an industry exposes; `packs.ts` remains the
  one-line-per-pack *loading* mechanism. A test (Step 5) keeps the two in sync.
- Don't touch `src/industries/real-estate/features/**`, universal tools' logic, or the chat UI.

## Steps

### 1. Sharpen the `AiConfig` contract — `src/industries/_types.ts`

Rename `systemPrompt` → `promptAddendum` (nothing populates the old field; rename is free):

```ts
/**
 * Per-industry AI configuration, declared in the industry's manifest.
 * MUST stay JSON-serializable (strings/arrays only — manifests may cross
 * the RSC boundary; same rule as sidebar icon names).
 */
export interface AiConfig {
  /**
   * Appended verbatim to the END of the universal assistant system prompt.
   * Domain context + tool-routing hints for this industry. NOT a replacement
   * prompt — the universal prompt (role awareness, tool rules, injection
   * rule) always applies.
   */
  promptAddendum?: string;
  /**
   * Tool ids this industry's pack registers (beyond universal tools).
   * Kept in sync with the actual registrations by a consistency test.
   */
  toolIds?: readonly string[];
}
```

### 2. Populate the real_estate `AiConfig` — `src/industries/real-estate/ai/agent.ts`

Move the `INDUSTRY_CONTEXT.real_estate` string from `prompts/assistant.ts` **verbatim** (it is
live-tuned wording — do not rephrase a single word) into:

```ts
export const aiConfig: AiConfig = {
  promptAddendum: "<the exact real_estate string from INDUSTRY_CONTEXT>",
  toolIds: [
    "search_offerings",
    "get_offering",
    "capital_raise_summary",
    "get_investor_commitments",
  ],
};
```

Update the stub docstring (no longer "Phase 1 stub — nothing wired").

### 3. Make the prompt builder pure on industry context — `src/lib/ai/prompts/assistant.ts`

- Delete the `INDUSTRY_CONTEXT` map and its TODO comment.
- `AssistantPromptInput`: replace nothing else; add `industryContext?: string`. The function no
  longer looks anything up by `industryId` — it renders `industryContext` exactly where the map
  lookup's result was rendered before (same `\n\n` separator, same position at the end).
- Keep `industryId` in the input — it still renders in the `Context:` block.
- Update `assistant.test.ts`: same assertions, but pass the addendum in explicitly. Add one test:
  addendum absent ⇒ prompt ends exactly as today's no-industry case (byte-stable universal prompt).

### 4. Loader accessor + chat route wiring

- `src/industries/_loader.ts`: add
  ```ts
  export function getIndustryAiConfig(industryId: string | null | undefined): AiConfig | undefined
  ```
  via the existing `getManifest()` (mirror `getFeatureAccess`'s null-handling style). Add loader
  test cases: real_estate returns the populated config; education/it_agency return the empty
  object config; unknown/null → undefined (or the general manifest's — match `getManifest`'s
  existing fallback semantics and assert whatever that is).
- `src/app/(main)/api/v1/ai/chat/route.ts`: at the `buildSystemPrompt({...})` call site (~line
  120), fetch `getIndustryAiConfig(auth.industryId)?.promptAddendum` and pass it as
  `industryContext`. This is the ONLY route change.

### 5. Sync test between manifests and the tool registry (new test file)

`src/lib/ai/tools/packs.test.ts`:

- `import "./packs"` (loads universal + all packs by side effect).
- For EVERY industry manifest: collect the registry's tools whose `industries` gate includes that
  industry (read the registered tool objects — there is already a registry accessor or export the
  minimal one needed).
- Assert set-equality with `manifest.ai?.toolIds ?? []` in BOTH directions, with failure messages
  naming the drift: "tool registered but not declared in manifest" / "declared in manifest but
  never registered (missing packs.ts import?)".
- Assert every manifest's `ai` config is JSON-serializable (`structuredClone`/JSON round-trip).

Update `packs.ts`'s TODO comment to describe the now-real invariant: adding a pack = (a) one
import line here, (b) `toolIds` + `promptAddendum` in that industry's manifest — the test fails
if you do one without the other.

### 6. Grep sweep

`grep -rn "INDUSTRY_CONTEXT\|systemPrompt" src/industries src/lib/ai` — the map must be gone and
no reference to the old `AiConfig.systemPrompt` field name may remain.

## Verify (Opus re-runs these independently — report actual outputs)

1. `npm run build` exit 0; `npm run lint` 0 errors; vitest all green (report the new total).
2. **Prompt byte-stability:** unit test proving `buildSystemPrompt` output for a real_estate
   tenant (addendum passed in) is IDENTICAL to the pre-change output (capture the old string in
   the test as a fixture before refactoring — cheap insurance the move didn't drop a character).
3. Live smoke (local prod-mode server is running; cookie recipe in memory):
   `owner@cre-capital.local` asks "which offering has the most interest?" → still routes to
   `capital_raise_summary` with sane numbers ($1.2M/$25M IVAF-II vs $850k/$10M SEFP-I).
   `admin@edgex.local` (it_agency) same question → no RE tools, graceful answer (unchanged).
4. Diff scope: exactly `_types.ts`, `_loader.ts` (+test), `real-estate/ai/agent.ts`,
   `prompts/assistant.ts` (+test), chat `route.ts` (one wiring change), `packs.ts` (comment),
   new `packs.test.ts`. NO migrations, NO package.json, NO src/components.

## Report back

Standard executor report: what was done per step, deviations flagged (never silently), gate
outputs pasted verbatim, anything discovered mid-build.
