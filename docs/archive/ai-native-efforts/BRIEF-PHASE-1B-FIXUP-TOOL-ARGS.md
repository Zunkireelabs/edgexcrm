# Executor Brief — Phase 1B fixup: placeholder tool-args make every lead query return 0

**For:** Sonnet executor session · **From:** Opus planner · **Date:** 2026-07-16
**Context:** Phase 1B passed Opus review; Opus then ran the LIVE verification (key now present) and found one functional bug that must be fixed before 1C. Everything else works: streaming, multi-tool calls, persistence (messages/usage/title), budget, scoping.

---

## The bug (reproduced live, twice)

`gpt-4o-mini` fills **every optional tool parameter with placeholder junk** instead of omitting it. Observed inputs on both a complex and a trivial prompt ("List our leads"):

```json
{"query":"","stage":"","list":"","assignedToUserId":"00000000-0000-0000-0000-000000000000",
 "createdAfter":"2023-01-01T00:00:00Z","createdBefore":"2026-07-16T00:00:00Z","limit":20}
```

- `search_leads` applies `assigned_to = 00000000-…` for all-scope callers → **always 0 rows** (DB truth: 7 clean leads in the tenant). Empty-string `stage`/`list`/`query` happen to be falsy-guarded, but that's luck, not design.
- `pipeline_summary` **requires** `pipelineId` — the model can't know one, so it invents an all-zeros UUID → 0 rows.

Likely root cause to check first: **OpenAI strict/structured tool-calling marks all properties required**, so `.optional()` zod fields still get emitted with filler values. Look at how installed `ai@7` + `@ai-sdk/openai` translate optional zod fields (nullable vs omitted) — if there's a supported way to make optionals truly omittable in strict mode, use it. **Regardless of the outcome, also do the boundary sanitization below** — tool inputs are untrusted model output and must be robust for ANY provider.

## Fix (three layers, all in `src/lib/ai/`)

1. **Sanitize at the schema/tool boundary** (all 8 tools, shared helper in `tools/universal/lib/`): treat as **absent** — empty/whitespace-only strings, the NIL UUID `00000000-0000-0000-0000-000000000000` on any uuid field, and (for `assignedToUserId` specifically) a value equal to the NIL uuid. Prefer `z.preprocess`/`.transform` in the schemas so `execute()` bodies stay clean. A junk value must never silently become a filter.
2. **`pipeline_summary`: make `pipelineId` optional.** Absent → resolve the tenant's default pipeline (see how the REST/dashboard code picks it — `src/lib/leads/pipeline-resolution.ts`); if multiple pipelines and no default, aggregate the tenant's pipelines and say so in the output, or return the pipeline list with a note asking the model to pick. No required id the model cannot know.
3. **System prompt** (`prompts/assistant.ts`): add an explicit line: *"When calling tools, omit optional parameters you don't have real values for. Never pass placeholder values such as empty strings or all-zero UUIDs."* (belt-and-suspenders; keep the injection rule intact).

## Tests

- Unit: schema-level — `""` and NIL-uuid inputs parse to `undefined` (per tool where relevant, or the shared helper's own test).
- Unit: `pipeline_summary` with no `pipelineId` resolves the default pipeline path.
- Existing 49 stay green.

## Verification (report with evidence)

1. Build + lint + vitest green (heap flag as usual).
2. Diff confined to `src/lib/ai/**` + tests.
3. LIVE (key is in `.env.local`; set `AI_ASSISTANT_ENABLED=true` while testing, back to `false` after): as `owner@cre-capital.local` (cookie recipe: sign in via supabase-js against `127.0.0.1:54321`, cookie `sb-127-auth-token=base64-<base64url(JSON session)>`), POST "List our leads" → `search_leads` returns the **7** seeded leads and the reply names them; "how many leads per stage" → `pipeline_summary` returns non-zero counts without the model inventing a pipelineId. Paste tool inputs + outputs from the stream.
4. Confirm no regression on the own-scope counselor account (`counselor@admizz.local` / `counselor123456`): still exactly 1 lead visible.

**Do not** touch UI, migrations, package.json, or anything outside `src/lib/ai/` + its tests. No merge, no PR. Opus reviews, then 1C.
